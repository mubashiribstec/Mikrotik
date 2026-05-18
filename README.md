# NetForge - MikroTik Router Management Platform

A modern web-based management interface for MikroTik routers with real-time monitoring, configuration, and control.

![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)
![Node Version](https://img.shields.io/badge/node-%3E%3D16.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

✨ **Real-time Monitoring**
- Live system metrics (CPU, memory, storage)
- Network interface status
- Bandwidth utilization tracking
- Connected clients monitoring

🔐 **Network Management**
- Route configuration (add/delete)
- NAT rule management
- Firewall rules overview
- IP address configuration
- DNS settings

🌐 **Advanced Features**
- DHCP client management
- Hotspot user management
- VPN connection monitoring
- System backups list
- Real-time log streaming
- Script execution (15 templates)

🎨 **User Interface**
- Dark mode responsive design
- Real-time WebSocket updates
- Automatic polling fallback
- Pagination for large datasets
- Smart alert system with history
- Settings/reconnection capability

## Quick Start

### Prerequisites
- Node.js v16+ 
- npm v7+
- SSH access to MikroTik router

### Installation

```bash
# Clone repository
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik

# Install dependencies
npm install

# Start server
npm start

# Open browser
# http://localhost:4444
```

### Connect to Router

1. Open http://localhost:4444
2. Enter your MikroTik credentials:
   - **Host**: Router IP (e.g., 192.168.88.1)
   - **Port**: 22 (SSH)
   - **Username**: admin
   - **Password**: [your password]
3. Click "Connect"

## System Architecture

```
┌─────────────────────┐
│  Web Browser        │
│  (React 18 + Babel) │
└──────────┬──────────┘
           │ HTTP/WebSocket
           ↓
┌─────────────────────────────┐
│  Express.js API Server      │
│  (port 3001)                │
├─────────────────────────────┤
│ - Session Management        │
│ - Rate Limiting             │
│ - WebSocket Real-time       │
│ - SSH Connection Pool       │
└──────────┬──────────────────┘
           │ SSH (port 22)
           ↓
┌─────────────────────┐
│  MikroTik Router    │
│  RouterOS v6.40+    │
└─────────────────────┘
```

## File Structure

```
├── netforge-api-integrated.html    # Frontend (React components)
├── server-enhanced.js              # Backend (Express + SSH2)
├── package.json                    # Node.js dependencies
├── test-endpoints.js               # API authentication tests
├── SETUP.md                        # Detailed setup guide
├── README.md                       # This file
└── .gitignore                      # Git configuration
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/login` | POST | Create session with router |
| `/api/system-stats` | GET | CPU, memory, uptime |
| `/api/interfaces` | GET | Network interfaces |
| `/api/firewall` | GET | Firewall rules |
| `/api/routes` | GET/POST | IP routing |
| `/api/nat` | GET/POST | NAT rules |
| `/api/dhcp-clients` | GET | DHCP clients |
| `/api/hotspot` | GET/POST | Hotspot users |
| `/api/vpn` | GET | VPN connections |
| `/api/backups` | GET | System backups |
| `/api/logs` | GET | System logs |
| `/api/scripts` | GET/POST | Script execution |

See [SETUP.md](SETUP.md) for complete API reference.

## Performance

- **18 API Endpoints** with real data parsing
- **Real-time Updates** via WebSocket
- **Pagination** enabled for large datasets
- **Rate Limiting** - 100 req/min per client
- **Session Management** - Auto cleanup
- **SSH Connection Pool** - Persistent connections

## Security Features

✅ Session-based authentication
✅ API rate limiting
✅ Input validation
✅ Secure SSH connections
✅ CORS protection
✅ No hardcoded credentials

## Running in Production

### Option 1: systemd (Ubuntu/Debian)
```bash
sudo cp netforge.service /etc/systemd/system/
sudo systemctl enable netforge
sudo systemctl start netforge
```

### Option 2: supervisor
```bash
sudo apt-get install supervisor
# Configure /etc/supervisor/conf.d/netforge.conf
sudo supervisorctl update
sudo supervisorctl start netforge
```

### Option 3: Alpine Linux (nohup)
```bash
nohup npm start > netforge.log 2>&1 &
echo $! > netforge.pid
tail -f netforge.log
```

## Testing

```bash
# Run endpoint authentication tests
npm start &
node test-endpoints.js

# Expected: 18 passed, 0 failed
```

## Troubleshooting

### Connection Issues
- Verify SSH access: `ssh admin@192.168.88.1`
- Check firewall: Router menu → IP → Services → SSH enabled
- Verify credentials and router IP

### Port Already in Use
```bash
# Find process on port 3001
lsof -i :4444
# Or: netstat -tulpn | grep 3001
# Kill it
kill -9 <PID>
```

### Dependencies Failed
```bash
rm -rf node_modules package-lock.json
npm install
```

See [SETUP.md](SETUP.md) for detailed troubleshooting guide.

## Technology Stack

- **Frontend**: React 18, Babel (CDN), CSS-in-JS
- **Backend**: Node.js, Express.js, SSH2
- **Real-time**: WebSocket (ws), Polling fallback
- **Security**: Express rate-limit, CORS, Session management
- **Testing**: Custom HTTP test suite

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Requirements

### Minimum
- Node.js v16.0.0
- npm v7.0.0
- 256MB RAM
- 100MB storage

### Recommended
- Node.js v18.0.0+
- npm v8.0.0+
- 512MB RAM
- Fast network connection to router

### MikroTik
- RouterOS v6.40+ (recommended: v7.0+)
- SSH enabled (port 22)
- Admin credentials

## Development

```bash
# Install dev dependencies
npm install

# Run tests
node test-endpoints.js

# Start with auto-reload (requires nodemon)
npm install --save-dev nodemon
npx nodemon server-enhanced.js
```

## Contributing

Found an issue? Have a feature request?
- Open an issue on GitHub
- Submit pull requests
- Report security vulnerabilities responsibly

## License

MIT License - See LICENSE file

## Support

📖 **Documentation**: See [SETUP.md](SETUP.md) for detailed setup guide
🐛 **Issues**: GitHub issues page
📧 **Contact**: Via GitHub

---

**Ready to manage your MikroTik routers like a pro!** 🚀

For detailed setup instructions, see [SETUP.md](SETUP.md)
