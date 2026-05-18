#!/bin/bash

################################################################################
# NetForge - Automated Installation & Startup Script
#
# This script automatically:
# - Checks system requirements
# - Installs Node.js (if needed)
# - Installs dependencies
# - Configures the application
# - Starts the server
# - Provides access instructions
#
# Compatible with: Alpine Linux, Ubuntu, Debian, macOS
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT=3001
LOG_FILE="${SCRIPT_DIR}/netforge.log"
CONFIG_FILE="${SCRIPT_DIR}/.netforge-config"

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

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_step() {
    echo -e "\n${BLUE}→ $1${NC}"
}

################################################################################
# System Checks
################################################################################

check_os() {
    print_step "Detecting operating system..."

    if [[ "$OSTYPE" == "linux-alpine" ]] || [[ "$OSTYPE" == "linux-musl" ]]; then
        OS="alpine"
        print_success "Detected: Alpine Linux"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        if command -v apt-get &> /dev/null; then
            DISTRO="debian"
            print_success "Detected: Ubuntu/Debian Linux"
        else
            DISTRO="unknown"
            print_success "Detected: Linux (unknown distribution)"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        print_success "Detected: macOS"
    else
        print_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
}

check_node() {
    print_step "Checking Node.js installation..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        print_success "Node.js is installed: $NODE_VERSION"
        return 0
    else
        print_info "Node.js not found"
        return 1
    fi
}

check_npm() {
    print_step "Checking npm installation..."

    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        print_success "npm is installed: $NPM_VERSION"
        return 0
    else
        print_info "npm not found"
        return 1
    fi
}

################################################################################
# Installation Functions
################################################################################

install_nodejs_alpine() {
    print_step "Installing Node.js on Alpine Linux..."

    if ! command -v sudo &> /dev/null; then
        print_info "Installing as root (no sudo available)"
        apk update
        apk add nodejs npm
    else
        print_info "Installing with sudo"
        sudo apk update
        sudo apk add nodejs npm
    fi

    print_success "Node.js installed: $(node -v)"
    print_success "npm installed: $(npm -v)"
}

install_nodejs_debian() {
    print_step "Installing Node.js on Ubuntu/Debian..."

    sudo apt-get update
    sudo apt-get install -y nodejs npm

    print_success "Node.js installed: $(node -v)"
    print_success "npm installed: $(npm -v)"
}

install_nodejs_macos() {
    print_step "Installing Node.js on macOS..."

    if ! command -v brew &> /dev/null; then
        print_error "Homebrew not installed. Please install it first:"
        print_error "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi

    brew install node

    print_success "Node.js installed: $(node -v)"
    print_success "npm installed: $(npm -v)"
}

install_nodejs() {
    if check_node && check_npm; then
        return 0
    fi

    print_info "Node.js installation required"
    echo -e "\nInstall Node.js now? (y/n)"
    read -r -p "> " INSTALL_NODE

    if [[ $INSTALL_NODE != "y" ]]; then
        print_error "Node.js is required to run NetForge"
        exit 1
    fi

    case "$OS" in
        alpine)
            install_nodejs_alpine
            ;;
        linux)
            install_nodejs_debian
            ;;
        macos)
            install_nodejs_macos
            ;;
    esac
}

install_dependencies() {
    print_step "Installing application dependencies..."

    cd "$SCRIPT_DIR"

    if [ -d "node_modules" ]; then
        print_info "Dependencies already installed, skipping..."
        return 0
    fi

    npm install
    print_success "Dependencies installed successfully"
}

################################################################################
# Configuration Functions
################################################################################

prompt_mikrotik_config() {
    print_header "MikroTik Router Configuration"

    echo "Enter your MikroTik router connection details:"
    echo "(These will be stored locally for convenience)"
    echo ""

    read -r -p "Router IP Address (default: 192.168.88.1): " ROUTER_HOST
    ROUTER_HOST=${ROUTER_HOST:-192.168.88.1}

    read -r -p "SSH Port (default: 22): " ROUTER_PORT
    ROUTER_PORT=${ROUTER_PORT:-22}

    read -r -p "Username (default: admin): " ROUTER_USER
    ROUTER_USER=${ROUTER_USER:-admin}

    read -r -sp "Password: " ROUTER_PASS
    echo ""

    read -r -p "Display name for this router (default: Main Router): " ROUTER_NAME
    ROUTER_NAME=${ROUTER_NAME:-"Main Router"}

    # Save configuration (in user's home, not tracked by git)
    CONFIG_DIR="$HOME/.netforge"
    mkdir -p "$CONFIG_DIR"
    CONFIG_FILE="$CONFIG_DIR/config"

    cat > "$CONFIG_FILE" << EOF
# NetForge Configuration
ROUTER_HOST="$ROUTER_HOST"
ROUTER_PORT="$ROUTER_PORT"
ROUTER_USER="$ROUTER_USER"
ROUTER_PASS="$ROUTER_PASS"
ROUTER_NAME="$ROUTER_NAME"
EOF

    chmod 600 "$CONFIG_FILE"
    print_success "Configuration saved to $CONFIG_FILE"
}

load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        # shellcheck source=/dev/null
        source "$CONFIG_FILE"
        print_success "Loaded existing configuration for: $ROUTER_NAME"

        read -r -p "Use this configuration? (y/n): " USE_SAVED
        if [[ $USE_SAVED == "y" ]]; then
            return 0
        fi
    fi

    prompt_mikrotik_config
}

################################################################################
# Server Functions
################################################################################

start_server() {
    print_header "Starting NetForge Server"

    cd "$SCRIPT_DIR"

    # Check if port is in use
    if command -v lsof &> /dev/null; then
        if lsof -Pi :$APP_PORT -sTCP:LISTEN -t &>/dev/null; then
            print_error "Port $APP_PORT is already in use"
            print_info "Kill the existing process and try again:"
            print_info "  lsof -i :$APP_PORT"
            print_info "  kill -9 <PID>"
            exit 1
        fi
    fi

    # Start server
    print_step "Starting server on port $APP_PORT..."
    npm start > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "${SCRIPT_DIR}/.server.pid"

    # Wait for server to start
    sleep 3

    # Check if server started successfully
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        print_error "Server failed to start"
        print_error "Check logs: cat $LOG_FILE"
        exit 1
    fi

    print_success "Server started (PID: $SERVER_PID)"
    print_success "Logging to: $LOG_FILE"
}

################################################################################
# Verification Functions
################################################################################

test_server() {
    print_step "Testing server endpoints..."

    # Wait for server to be ready
    for i in {1..10}; do
        if curl -s http://localhost:$APP_PORT > /dev/null 2>&1; then
            print_success "Server is responding"
            return 0
        fi
        sleep 1
    done

    print_error "Server is not responding"
    print_error "Check logs: cat $LOG_FILE"
    return 1
}

open_browser() {
    print_step "Opening browser..."

    case "$OS" in
        linux)
            if command -v xdg-open &> /dev/null; then
                xdg-open "http://localhost:$APP_PORT" &
                print_success "Browser opened"
            else
                print_info "Cannot auto-open browser on this system"
            fi
            ;;
        macos)
            open "http://localhost:$APP_PORT" &
            print_success "Browser opened"
            ;;
        alpine)
            print_info "Cannot auto-open browser on Alpine Linux"
            ;;
    esac
}

################################################################################
# Information Functions
################################################################################

print_startup_info() {
    print_header "🚀 NetForge is Running!"

    echo ""
    echo "  Web Interface:  http://localhost:$APP_PORT"
    echo "  API Server:     http://localhost:$APP_PORT"
    echo "  WebSocket:      ws://localhost:$APP_PORT/ws"
    echo ""
    echo "  Router:         $ROUTER_NAME"
    echo "  Host:           $ROUTER_HOST:$ROUTER_PORT"
    echo "  Username:       $ROUTER_USER"
    echo ""
    echo "  Log File:       $LOG_FILE"
    echo "  Server PID:     $SERVER_PID"
    echo ""
}

print_next_steps() {
    print_header "Next Steps"

    echo "1. Open your browser:"
    echo "   ${BLUE}http://localhost:$APP_PORT${NC}"
    echo ""
    echo "2. Login credentials should be pre-filled from your input"
    echo "   If not, use:"
    echo "   Host:     $ROUTER_HOST"
    echo "   Port:     $ROUTER_PORT"
    echo "   Username: $ROUTER_USER"
    echo ""
    echo "3. Click ${GREEN}'Connect'${NC} to start monitoring"
    echo ""
    echo "Features:"
    echo "  • Real-time system monitoring"
    echo "  • Network interface management"
    echo "  • Firewall & routing configuration"
    echo "  • DHCP client tracking"
    echo "  • System logs and backups"
    echo "  • VPN monitoring"
    echo ""
    echo "View logs:"
    echo "   ${BLUE}tail -f $LOG_FILE${NC}"
    echo ""
    echo "Stop server:"
    echo "   ${BLUE}kill $(cat ${SCRIPT_DIR}/.server.pid)${NC}"
    echo ""
}

print_access_from_remote() {
    local IP
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_IP")

    print_header "Access from Another Computer"

    echo "To access NetForge from another machine:"
    echo ""
    echo "  ${BLUE}http://$IP:$APP_PORT${NC}"
    echo ""
    echo "Note: Make sure your firewall allows port $APP_PORT"
    echo ""
}

print_troubleshooting() {
    print_header "Troubleshooting"

    echo "Connection issues?"
    echo ""
    echo "1. Test SSH connection to router:"
    echo "   ${BLUE}ssh $ROUTER_USER@$ROUTER_HOST -p $ROUTER_PORT${NC}"
    echo ""
    echo "2. View server logs:"
    echo "   ${BLUE}tail -f $LOG_FILE${NC}"
    echo ""
    echo "3. Check port availability:"
    echo "   ${BLUE}lsof -i :$APP_PORT${NC}"
    echo ""
    echo "For more help, see SETUP.md or QUICKSTART.md"
    echo ""
}

################################################################################
# Main Execution
################################################################################

main() {
    print_header "NetForge - Automated Installation"

    # Check system
    check_os

    # Install Node.js if needed
    install_nodejs

    # Navigate to script directory
    cd "$SCRIPT_DIR"

    # Install dependencies
    install_dependencies

    # Get MikroTik configuration
    load_config

    # Run tests
    print_step "Running endpoint tests..."
    if node test-endpoints.js; then
        print_success "All tests passed!"
    else
        print_info "Some tests failed, but server may still work"
    fi

    # Start server
    start_server

    # Test server
    if ! test_server; then
        exit 1
    fi

    # Try to open browser
    open_browser

    # Print information
    print_startup_info
    print_next_steps
    print_access_from_remote
    print_troubleshooting

    # Keep script running to show logs
    print_header "Showing Live Logs (Ctrl+C to exit)"
    echo ""
    tail -f "$LOG_FILE"
}

################################################################################
# Error Handling
################################################################################

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        print_info "Shutting down server (PID: $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

################################################################################
# Run Main
################################################################################

main
