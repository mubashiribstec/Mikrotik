#!/bin/bash

################################################################################
# NetForge - Automated Installation & Startup Script
#
# Supports: Alpine Linux, Ubuntu, Debian, CentOS, macOS
# Error Handling: Graceful fallbacks - continues even if some steps fail
################################################################################

# Don't exit on first error - handle them gracefully
trap 'print_error "Script interrupted"' INT TERM

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT=4444
LOG_FILE="${SCRIPT_DIR}/netforge.log"
CONFIG_DIR="$HOME/.netforge"
CONFIG_FILE="$CONFIG_DIR/config"

################################################################################
# Utility Functions
################################################################################

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_step() {
    echo -e "\n${BLUE}→ $1${NC}"
}

################################################################################
# System Detection
################################################################################

detect_os() {
    print_step "Detecting operating system..."

    # Check for Debian/Ubuntu
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME="$ID"
        OS_VERSION="$VERSION_ID"
    fi

    # Detect based on OSTYPE and /etc/os-release
    if [[ "$OSTYPE" == "linux-musl" ]] || [[ "$OSTYPE" == "linux-alpine" ]]; then
        OS="alpine"
        DISTRO="alpine"
        print_success "Detected: Alpine Linux"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        if [[ "$OS_NAME" == "debian" ]] || [[ "$OS_NAME" == "ubuntu" ]]; then
            DISTRO="debian"
            print_success "Detected: Debian/Ubuntu ($OS_NAME $OS_VERSION)"
        elif [[ "$OS_NAME" == "centos" ]] || [[ "$OS_NAME" == "rhel" ]] || [[ "$OS_NAME" == "fedora" ]]; then
            DISTRO="redhat"
            print_success "Detected: CentOS/RHEL ($OS_NAME $OS_VERSION)"
        else
            DISTRO="unknown"
            print_warning "Detected: Linux ($OS_NAME) - some features may not work"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        DISTRO="macos"
        print_success "Detected: macOS"
    else
        print_warning "Unknown OS: $OSTYPE - attempting generic Linux installation"
        OS="linux"
        DISTRO="unknown"
    fi
}

################################################################################
# System Checks
################################################################################

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        print_success "Node.js found: $NODE_VERSION"
        return 0
    else
        print_warning "Node.js not found"
        return 1
    fi
}

check_npm() {
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        print_success "npm found: $NPM_VERSION"
        return 0
    else
        print_warning "npm not found"
        return 1
    fi
}

check_git() {
    if command -v git &> /dev/null; then
        print_success "git found"
        return 0
    else
        print_warning "git not found (optional)"
        return 1
    fi
}

################################################################################
# Node.js Installation
################################################################################

install_nodejs_alpine() {
    print_step "Installing Node.js on Alpine Linux..."

    if ! command -v sudo &> /dev/null; then
        apk update || print_warning "Failed to update apk"
        apk add --no-cache nodejs npm curl || {
            print_error "Failed to install Node.js via apk"
            return 1
        }
    else
        sudo apk update || print_warning "Failed to update apk"
        sudo apk add --no-cache nodejs npm curl || {
            print_error "Failed to install Node.js via apk"
            return 1
        }
    fi

    print_success "Node.js installed: $(node -v)"
    return 0
}

install_nodejs_debian() {
    print_step "Installing Node.js on Debian/Ubuntu..."

    # Try using NodeSource repository first (recommended)
    if command -v curl &> /dev/null; then
        print_info "Using NodeSource repository..."
        curl -fsSL https://deb.nodesource.com/setup_18.x 2>/dev/null | sudo -E bash - || {
            print_warning "NodeSource setup failed, falling back to apt"
        }
    fi

    sudo apt-get update || print_warning "Failed to update apt"

    # Try to install nodejs, fallback to node if needed
    sudo apt-get install -y nodejs npm 2>/dev/null || {
        print_info "Installing node and npm separately..."
        sudo apt-get install -y node npm 2>/dev/null || {
            print_error "Failed to install Node.js"
            return 1
        }
    }

    print_success "Node.js installed: $(node -v)"
    return 0
}

install_nodejs_redhat() {
    print_step "Installing Node.js on CentOS/RHEL..."

    sudo yum update -y || print_warning "Failed to update yum"
    sudo yum install -y nodejs npm || {
        print_error "Failed to install Node.js"
        return 1
    }

    print_success "Node.js installed: $(node -v)"
    return 0
}

install_nodejs_macos() {
    print_step "Installing Node.js on macOS..."

    if ! command -v brew &> /dev/null; then
        print_error "Homebrew not installed"
        print_info "Install from: https://brew.sh"
        return 1
    fi

    brew install node || {
        print_error "Failed to install Node.js"
        return 1
    }

    print_success "Node.js installed: $(node -v)"
    return 0
}

install_nodejs() {
    print_step "Checking Node.js installation..."

    if check_node && check_npm; then
        print_success "Node.js already installed"
        return 0
    fi

    print_warning "Node.js/npm not found - attempting installation"

    case "$DISTRO" in
        alpine)
            install_nodejs_alpine || return 1
            ;;
        debian)
            install_nodejs_debian || return 1
            ;;
        redhat)
            install_nodejs_redhat || return 1
            ;;
        macos)
            install_nodejs_macos || return 1
            ;;
        *)
            print_error "Automatic installation not supported for $DISTRO"
            print_info "Please install Node.js manually from https://nodejs.org/"
            return 1
            ;;
    esac

    # Verify installation
    if ! check_node || ! check_npm; then
        print_error "Node.js/npm installation verification failed"
        return 1
    fi

    return 0
}

################################################################################
# Dependencies Installation
################################################################################

install_dependencies() {
    print_step "Installing npm dependencies..."

    cd "$SCRIPT_DIR" || {
        print_error "Cannot change to script directory"
        return 1
    }

    if [ -d "node_modules" ]; then
        print_info "Dependencies already installed"
        return 0
    fi

    npm install || {
        print_error "npm install failed"
        print_info "Attempting to retry..."
        npm install --no-audit --no-fund || {
            print_error "Failed to install dependencies after retry"
            return 1
        }
    }

    print_success "Dependencies installed"
    return 0
}

################################################################################
# Configuration
################################################################################

load_or_create_config() {
    print_header "MikroTik Router Configuration"

    mkdir -p "$CONFIG_DIR" 2>/dev/null || {
        print_warning "Could not create config directory: $CONFIG_DIR"
    }

    if [ -f "$CONFIG_FILE" ]; then
        . "$CONFIG_FILE"
        echo "Found saved configuration:"
        echo "  Router: ${ROUTER_NAME:-Unknown}"
        echo "  Host: ${ROUTER_HOST:-N/A}"
        echo "  User: ${ROUTER_USER:-N/A}"
        echo ""
        read -r -p "Use this configuration? (y/n): " USE_SAVED
        if [[ $USE_SAVED == "y" || $USE_SAVED == "Y" ]]; then
            print_success "Using saved configuration"
            return 0
        fi
    fi

    prompt_for_config
}

prompt_for_config() {
    echo "Enter your MikroTik router connection details:"
    echo "(You can change these later by removing ~/.netforge/config)"
    echo ""

    read -r -p "Router IP Address (default: 192.168.88.1): " ROUTER_HOST
    ROUTER_HOST=${ROUTER_HOST:-192.168.88.1}

    read -r -p "SSH Port (default: 22): " ROUTER_PORT
    ROUTER_PORT=${ROUTER_PORT:-22}

    read -r -p "Username (default: admin): " ROUTER_USER
    ROUTER_USER=${ROUTER_USER:-admin}

    read -r -sp "Password: " ROUTER_PASS
    echo ""

    if [ -z "$ROUTER_PASS" ]; then
        print_error "Password cannot be empty"
        prompt_for_config
        return $?
    fi

    read -r -p "Router name (default: Main Router): " ROUTER_NAME
    ROUTER_NAME=${ROUTER_NAME:-"Main Router"}

    # Save configuration
    mkdir -p "$CONFIG_DIR" 2>/dev/null || {
        print_warning "Could not create config directory"
        return 1
    }

    cat > "$CONFIG_FILE" << EOF
# NetForge Configuration - $(date)
ROUTER_HOST="$ROUTER_HOST"
ROUTER_PORT="$ROUTER_PORT"
ROUTER_USER="$ROUTER_USER"
ROUTER_PASS="$ROUTER_PASS"
ROUTER_NAME="$ROUTER_NAME"
EOF

    chmod 600 "$CONFIG_FILE" 2>/dev/null || {
        print_warning "Could not restrict config file permissions"
    }

    print_success "Configuration saved to $CONFIG_FILE"
}

################################################################################
# Server Management
################################################################################

start_server() {
    print_header "Starting NetForge Server"

    cd "$SCRIPT_DIR" || {
        print_error "Cannot change to script directory"
        return 1
    }

    # Check if port is available
    if command -v lsof &> /dev/null; then
        if lsof -Pi :$APP_PORT -sTCP:LISTEN -t &>/dev/null 2>&1; then
            print_error "Port $APP_PORT is already in use"
            read -r -p "Use different port? (example: 5555): " NEW_PORT
            if [ -n "$NEW_PORT" ]; then
                APP_PORT="$NEW_PORT"
                export PORT="$NEW_PORT"
            else
                print_error "Cannot start server - port unavailable"
                return 1
            fi
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$APP_PORT "; then
            print_error "Port $APP_PORT appears to be in use"
            read -r -p "Use different port? (example: 5555): " NEW_PORT
            if [ -n "$NEW_PORT" ]; then
                APP_PORT="$NEW_PORT"
                export PORT="$NEW_PORT"
            fi
        fi
    fi

    print_step "Starting server on port $APP_PORT..."

    # Clear old log
    > "$LOG_FILE"

    # Start server in background
    npm start > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "${SCRIPT_DIR}/.server.pid" 2>/dev/null || true

    # Wait and verify
    sleep 3

    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        print_error "Server failed to start"
        print_info "Check logs: tail -f $LOG_FILE"
        return 1
    fi

    print_success "Server started (PID: $SERVER_PID)"
    print_success "Logs: $LOG_FILE"
    return 0
}

test_server() {
    print_step "Testing server..."

    for i in {1..15}; do
        if curl -s "http://localhost:$APP_PORT" > /dev/null 2>&1; then
            print_success "Server is responding"
            return 0
        fi
        if [ $i -lt 15 ]; then
            sleep 1
        fi
    done

    print_warning "Server is not responding yet"
    print_info "Check logs: tail -f $LOG_FILE"
    return 1
}

test_endpoints() {
    print_step "Testing endpoints..."

    if [ ! -f "test-endpoints.js" ]; then
        print_info "Test file not found, skipping"
        return 0
    fi

    if node test-endpoints.js 2>/dev/null; then
        print_success "All endpoint tests passed"
        return 0
    else
        print_warning "Some endpoint tests failed (server may still work)"
        return 0
    fi
}

################################################################################
# Browser & Info
################################################################################

open_browser() {
    print_step "Opening browser..."

    case "$OS" in
        linux)
            if command -v xdg-open &> /dev/null; then
                xdg-open "http://localhost:$APP_PORT" &>/dev/null || true
                print_success "Browser opened"
            else
                print_info "Open browser to: http://localhost:$APP_PORT"
            fi
            ;;
        macos)
            open "http://localhost:$APP_PORT" &>/dev/null || true
            print_success "Browser opened"
            ;;
        *)
            print_info "Open browser to: http://localhost:$APP_PORT"
            ;;
    esac
}

print_startup_info() {
    print_header "🚀 NetForge is Running!"

    echo ""
    echo "  Web Interface:  http://localhost:$APP_PORT"
    echo "  API Server:     http://localhost:$APP_PORT"
    echo "  WebSocket:      ws://localhost:$APP_PORT/ws"
    echo ""
    echo "  Router:         ${ROUTER_NAME:-Unknown}"
    echo "  Host:           $ROUTER_HOST:$ROUTER_PORT"
    echo "  Username:       $ROUTER_USER"
    echo ""
    echo "  Server PID:     $SERVER_PID"
    echo "  Log File:       $LOG_FILE"
    echo ""
}

print_next_steps() {
    print_header "Next Steps"

    echo "1. Open your browser:"
    echo "   ${BLUE}http://localhost:$APP_PORT${NC}"
    echo ""
    echo "2. You should see the NetForge login screen"
    echo ""
    echo "3. Your router credentials should be pre-filled"
    echo "   If not, use:"
    echo "   Host:     $ROUTER_HOST"
    echo "   Port:     $ROUTER_PORT"
    echo "   Username: $ROUTER_USER"
    echo ""
    echo "4. Click 'Connect' to start monitoring"
    echo ""
    echo "Features available:"
    echo "  ✓ Real-time system monitoring"
    echo "  ✓ Network interface management"
    echo "  ✓ Firewall & routing configuration"
    echo "  ✓ DHCP client tracking"
    echo "  ✓ System logs and backups"
    echo "  ✓ VPN monitoring"
    echo ""
    echo "View logs:"
    echo "   ${BLUE}tail -f $LOG_FILE${NC}"
    echo ""
    echo "Stop server:"
    echo "   ${BLUE}kill $SERVER_PID${NC}"
    echo ""
}

print_troubleshooting() {
    print_header "Troubleshooting"

    echo "Cannot connect to router?"
    echo "  1. Verify SSH works:"
    echo "     ${BLUE}ssh $ROUTER_USER@$ROUTER_HOST -p $ROUTER_PORT${NC}"
    echo ""
    echo "  2. Check firewall:"
    echo "     Enable SSH on port $ROUTER_PORT in router settings"
    echo ""
    echo "  3. View server logs:"
    echo "     ${BLUE}tail -f $LOG_FILE${NC}"
    echo ""
    echo "Need to change port?"
    echo "  ${BLUE}export PORT=5555${NC}"
    echo "  ${BLUE}npm start${NC}"
    echo ""
}

################################################################################
# Main Execution
################################################################################

main() {
    print_header "NetForge - Automated Installation"

    # Detect OS
    detect_os

    # Install Node.js if needed (continue even if fails)
    if ! check_node || ! check_npm; then
        print_step "Installing Node.js..."
        if ! install_nodejs; then
            print_error "Could not install Node.js automatically"
            print_info "Please install Node.js manually: https://nodejs.org/"
            exit 1
        fi
    fi

    # Check final Node.js/npm
    if ! check_node || ! check_npm; then
        print_error "Node.js/npm still not available"
        exit 1
    fi

    # Change to script directory
    cd "$SCRIPT_DIR" || exit 1

    # Install dependencies (continue even if some issues)
    print_step "Installing dependencies..."
    if ! install_dependencies; then
        print_error "Failed to install dependencies"
        exit 1
    fi

    # Get router config
    if [ -z "$ROUTER_HOST" ]; then
        load_or_create_config
    fi

    # Test endpoints
    test_endpoints || true

    # Start server
    if ! start_server; then
        print_error "Failed to start server"
        exit 1
    fi

    # Test server response
    if test_server; then
        open_browser
    fi

    # Show information
    print_startup_info
    print_next_steps
    print_troubleshooting

    # Show live logs
    print_header "Showing Live Logs (Press Ctrl+C to stop)"
    echo ""
    tail -f "$LOG_FILE"
}

################################################################################
# Run
################################################################################

main
