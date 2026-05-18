# NetForge - MikroTik Router Management Platform

Complete setup and deployment guide for Alpine Linux and other systems.

## Prerequisites

### System Requirements
- **Node.js**: v16.0 or higher
- **npm**: v7.0 or higher  
- **RAM**: Minimum 256MB
- **Disk**: Minimum 100MB
- **Network**: SSH access to MikroTik router (default port 22)

### Supported Platforms
- Alpine Linux 3.13+
- Ubuntu/Debian 18.04+
- macOS 10.15+
- Windows 10+ (with WSL2 recommended)

---

## Installation on Alpine Linux

### Step 1: Install Node.js and npm

```bash
# Update package manager
apk update

# Install Node.js and npm
apk add nodejs npm

# Verify installation
node --version
npm --version
```

### Step 2: Clone Repository

```bash
# Clone the repository
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik

# Or download and extract ZIP if git is not available
# wget https://github.com/mubashiribstec/Mikrotik/archive/refs/heads/main.zip
# unzip main.zip
# cd Mikrotik-main
```

### Step 3: Install Dependencies

```bash
# Install all required npm packages
npm install

# This will install:
# - express (web framework)
# - ssh2 (SSH client for MikroTik)
# - cors (cross-origin resource sharing)
# - ws (WebSocket support)
# - express-rate-limit (API rate limiting)
```

### Step 4: Start the Application

```bash
# Start the server
npm start

# You should see:
# NetForge API server running on http://localhost:4444
# WebSocket available at ws://localhost:4444/ws?sessionId=<sessionId>
```

---

## Accessing the Application

### Local Access
1. Open your browser: `http://localhost:4444`
2. You'll see the NetForge login screen

### Remote Access (if running on server/VM)
1. Find your server's IP: `ip addr show` (or `ifconfig`)
2. Access from another machine: `http://<SERVER_IP>:4444`

**Note**: For production, consider using a reverse proxy (nginx) with SSL/TLS

---

## Connecting to MikroTik Router

### Prerequisites for MikroTik
1. **Router OS v6.40+** (recommended: v7.0+)
2. **SSH Access Enabled** (default port 22)
3. **Valid Admin Credentials**
4. **Router Reachable** from your network

### Connection Steps

1. **Start NetForge** (see "Start the Application" above)
2. **Open Web Interface**: `http://localhost:4444`
3. **Login Form**:
   - **Host**: Your router's IP (e.g., `192.168.88.1`)
   - **Port**: `22` (SSH port, default)
   - **Username**: `admin` (or your MikroTik user)
   - **Password**: Your router's password
4. **Click "Connect"**

### Example
```
Host: 192.168.88.1
Port: 22
Username: admin
Password: (your-router-password)
```

Once connected, you'll see:
- Dashboard with system metrics
- Network interfaces status
- Connected clients (DHCP)
- Firewall rules
- Routes and NAT configuration
- VPN status
- System logs
- And more!

---

## Project Structure

```
Mikrotik/
├── netforge-api-integrated.html    # Frontend (React + Babel)
├── server-enhanced.js              # Backend (Express + SSH2)
├── package.json                    # Dependencies
├── package-lock.json               # Dependency locks
├── test-endpoints.js               # Authentication tests
├── SETUP.md                        # This file
└── .gitignore                      # Git settings
```

---

## API Endpoints Reference

All endpoints require `x-session-id` header (provided automatically by frontend).

### Authentication
- `POST /api/login` - Create new session with router credentials

### Dashboard & Status
- `GET /api/system-stats` - CPU, memory, uptime
- `GET /api/interfaces` - Network interface status
- `GET /api/wan-status` - WAN interface details
- `GET /api/bandwidth` - Queue/bandwidth info
- `GET /api/clients` - Top bandwidth users

### Configuration
- `GET /api/routes` - IP routes
- `GET /api/nat` - NAT rules
- `GET /api/firewall` - Firewall rules
- `GET /api/ip-addresses` - IP configuration
- `GET /api/dns` - DNS settings
- `GET /api/wireless` - Wireless interfaces

### Management
- `GET /api/dhcp-clients` - Connected DHCP clients
- `GET /api/hotspot` - Hotspot users
- `GET /api/vpn` - VPN connections
- `GET /api/backups` - System backups
- `GET /api/logs` - System logs
- `GET /api/scripts` - System scripts

### WebSocket (Real-time Updates)
- `ws://localhost:4444/ws?sessionId=<sessionId>`

---

## Features

### Dashboard
- Real-time system metrics (CPU, memory, disk)
- Network uptime tracking
- Quick health status

### Network Management
- View all interfaces and their status
- Monitor WAN connections
- Bandwidth utilization tracking
- Top talkers detection

### Client Management
- DHCP client list with lease info
- Vendor identification
- Traffic statistics per client
- Hotspot user management

### Firewall & Security
- Active firewall rules
- Connection tracking
- Dropped packet statistics
- Blocked domain management

### Advanced Features
- Route management (add/delete)
- NAT rule configuration (add/delete)
- VPN connection monitoring
- DNS server configuration
- System script execution (15 templates included)
- Real-time log streaming
- Automatic backups list

### UI Features
- Dark mode (default)
- Responsive design
- Pagination for large lists
- Real-time WebSocket updates (with polling fallback)
- Smart alert system with history
- Settings/reconnection capability

---

## Running in Background (Production)

### Using nohup
```bash
nohup npm start > netforge.log 2>&1 &
echo $! > netforge.pid
```

### Using screen
```bash
screen -S netforge
npm start

# Detach: Ctrl+A, then D
# Reattach: screen -r netforge
```

### Using supervisor (Recommended)
```bash
# Install supervisor
apk add supervisor

# Create config: /etc/supervisor/conf.d/netforge.conf
[program:netforge]
directory=/path/to/Mikrotik
command=npm start
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/netforge.log

# Start
supervisorctl reread
supervisorctl update
supervisorctl start netforge
```

### Using systemd (Ubuntu/Debian)
```bash
# Create: /etc/systemd/system/netforge.service
[Unit]
Description=NetForge MikroTik Manager
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/path/to/Mikrotik
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target

# Enable and start
sudo systemctl enable netforge
sudo systemctl start netforge
```

---

## Troubleshooting

### Port 3001 Already in Use
```bash
# Find process using port 3001
lsof -i :4444
# Or on Alpine: netstat -tulpn | grep 3001

# Kill the process
kill -9 <PID>

# Or use different port (modify server-enhanced.js line ~1400)
# Change: const PORT = 3001;
# To: const PORT = 3000;
```

### Cannot Connect to MikroTik
1. **Verify SSH Access**:
   ```bash
   ssh admin@192.168.88.1
   # Should prompt for password
   ```

2. **Check Router IP**: Ensure you're using correct IP address

3. **Firewall**: Ensure port 22 is open on router
   - MikroTik menu: IP → Services
   - Verify SSH service is enabled

4. **Credentials**: Double-check username and password

### Dependencies Missing
```bash
# Reinstall all dependencies
rm -rf node_modules package-lock.json
npm install
```

### High CPU Usage
- Check number of simultaneous connections
- Reduce polling interval in frontend (default: 5000ms)
- Use WebSocket instead of polling for real-time updates

### Memory Issues on Low-RAM Systems
- Reduce data retention (logs, history)
- Close unused browser tabs/windows
- Use lightweight browser (e.g., Firefox)

---

## Security Recommendations

### For Production Deployment

1. **Use HTTPS/SSL**:
   ```bash
   # Install nginx as reverse proxy
   # Configure with Let's Encrypt SSL certificate
   ```

2. **Authentication**:
   - Use strong MikroTik credentials
   - Change default admin password on router
   - Use API tokens if available

3. **Network Security**:
   - Deploy on internal network only
   - Use firewall rules
   - Restrict SSH access on router
   - Enable IP-based access control

4. **Rate Limiting**:
   - Already enabled (100 requests/minute per client)
   - Adjust in server-enhanced.js if needed

5. **Regular Updates**:
   - Keep Node.js updated
   - Monitor npm dependencies for vulnerabilities
   ```bash
   npm audit
   npm audit fix
   ```

---

## Testing

### Run Endpoint Tests
```bash
# Start server first
npm start &

# In another terminal
node test-endpoints.js

# Should show: 18 passed, 0 failed
```

### Manual API Testing
```bash
# Login and get session
curl -X POST http://localhost:4444/api/login \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.88.1","port":22,"username":"admin","password":"password"}'

# Use returned sessionId in subsequent requests
curl -H "x-session-id: <sessionId>" http://localhost:4444/api/system-stats
```

---

## Performance Tips

1. **Optimize Update Intervals**:
   - Dashboard: 5-10 seconds
   - Logs: 5 seconds
   - Bandwidth: 2 seconds

2. **Pagination Settings**:
   - Logs: 15 items per page
   - Routes/NAT: 12 items per page
   - Adjust in netforge-api-integrated.html if needed

3. **WebSocket vs Polling**:
   - WebSocket: Lower latency, better for real-time
   - Polling: Better compatibility, higher bandwidth
   - Auto-fallback when WebSocket unavailable

4. **Connection Pooling**:
   - Backend maintains persistent SSH connections
   - Reduces connection overhead
   - Auto-cleanup of idle sessions

---

## Logs & Debugging

### Application Logs
```bash
# When running with nohup
tail -f netforge.log

# When running with supervisor
tail -f /var/log/netforge.log

# Enable debug mode (modify server-enhanced.js)
# Add: console.log() statements as needed
```

### Browser Console
- Press F12 to open developer tools
- Go to Console tab
- Check for JavaScript errors
- Monitor Network tab for API calls

### API Response Codes
- `200`: Success
- `400`: Bad request (invalid input)
- `401`: Unauthorized (invalid/missing session)
- `500`: Server error

---

## Updating

### Update to Latest Version
```bash
# Pull latest changes
git pull origin main

# Reinstall dependencies
npm install

# Restart server
npm start
```

### Check Version History
```bash
git log --oneline -10
```

---

## Support & Documentation

### Project Files
- **Frontend**: `netforge-api-integrated.html` - React-based UI
- **Backend**: `server-enhanced.js` - Express + SSH2 server
- **Tests**: `test-endpoints.js` - Endpoint authentication tests

### MikroTik Documentation
- Official: https://wiki.mikrotik.com
- SSH API: https://wiki.mikrotik.com/wiki/Manual:API
- RouterOS Commands: https://wiki.mikrotik.com/wiki/Manual

### Troubleshooting Resources
- Check server logs for error details
- Review network connectivity
- Verify MikroTik router configuration
- Test SSH access independently

---

## Performance Specifications

- **Endpoints**: 18 core API endpoints
- **Screen Updates**: Real-time via WebSocket (fallback to polling)
- **Data Points**: System stats, interfaces, clients, firewall, routes, NAT, VPN, backups, logs
- **Pagination**: Enabled for long lists (logs, routes, NAT)
- **Session Management**: Automatic cleanup of idle sessions
- **Rate Limiting**: 100 requests/minute, 5 login attempts/15min

---

## License

MIT License - See repository for details

---

## Getting Help

1. Check this SETUP.md guide
2. Review server logs for error messages
3. Test SSH connection to router independently
4. Verify network connectivity and firewall rules
5. Check GitHub issues: https://github.com/mubashiribstec/Mikrotik/issues

---

**Happy monitoring! 🚀**
