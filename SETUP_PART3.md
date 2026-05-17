# NetForge Part 3: Real MikroTik Backend

This part includes a Node.js backend that connects to real MikroTik routers via SSH and exposes REST API endpoints for the frontend.

## Architecture

```
Frontend (netforge-3a.html)
    ↓ HTTP/CORS
Backend Server (server.js)
    ↓ SSH
MikroTik Router (192.168.1.1)
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

This installs: `express`, `ssh2`, `cors`

### 2. Configure Router Credentials

Set environment variables before starting the server:

```bash
export ROUTER_IP=192.168.1.1
export ROUTER_PORT=22
export ROUTER_USER=admin
export ROUTER_PASS=admin
```

Or use `.env` file (create `.env` in repo root):

```
ROUTER_IP=192.168.1.1
ROUTER_PORT=22
ROUTER_USER=admin
ROUTER_PASS=admin
```

Then load with: `source .env` (or install `dotenv` package)

### 3. Start Backend Server

```bash
npm start
# or: node server.js
```

Server runs on `http://localhost:3001`

Check health: `curl http://localhost:3001/api/health`

### 4. Open Frontend

- **Development**: Open `netforge-3a.html` in browser (it auto-connects to `http://localhost:3001`)
- **Production**: Deploy frontend to Vercel, update API_BASE URL in frontend code

## API Endpoints

Backend provides these REST endpoints:

- `GET /api/system-stats` - CPU, memory, storage, uptime
- `GET /api/interfaces` - Network interface status
- `GET /api/wan-status` - WAN port status
- `GET /api/firewall` - Firewall rules and stats
- `GET /api/bandwidth` - Bandwidth queues
- `GET /api/dhcp-clients` - DHCP lease information
- `GET /api/wireless` - Wireless SSID information
- `GET /api/vpn` - VPN protocol status
- `GET /api/logs` - System logs
- `GET /api/scripts` - Scheduled scripts
- `GET /api/backups` - Backup files
- `GET /api/traffic` - Traffic data (RX/TX)
- `GET /api/top-talkers` - Top traffic sources
- `GET /api/health` - Server health check

## How It Works

1. **SSH Connection**: Server establishes SSH connection to MikroTik router
2. **Command Execution**: Runs RouterOS CLI commands (e.g., `/interface print`, `/system info print`)
3. **Data Parsing**: Parses RouterOS text output into JSON format
4. **Response**: Returns structured JSON to frontend
5. **Frontend Display**: React components render data with 2-second refresh interval

## RouterOS Commands Used

- `/system info print` - System information
- `/interface print` - Interface list
- `/ip address print` - IP addresses
- `/ip firewall filter print` - Firewall rules
- `/interface wireless print` - Wireless interfaces
- `/ip dhcp-server lease print` - DHCP leases
- `/log print` - System logs

## Troubleshooting

**"Connection refused"**
- Verify router is reachable: `ping 192.168.1.1`
- Check SSH is enabled on router (usually port 22)
- Verify credentials are correct

**"SSH timeout"**
- Increase readyTimeout in server.js (currently 30s)
- Check network connectivity to router

**"No data returned"**
- Frontend API calls may be getting null responses
- Check server logs for SSH errors
- Verify router SSH user has permission to run commands

**CORS errors in frontend**
- Server includes `cors` middleware
- Make sure API_BASE is correct in frontend

## Development Notes

- Mock data fallbacks: If SSH commands fail, backend returns example data
- 2-second polling: Frontend fetches all endpoints every 2 seconds
- No authentication UI: Currently connects directly with env credentials
- No error handling UI: Errors logged to console only (improve in Part 4)

## Next Steps (Part 4)

- Add login UI with credential input
- Implement error handling and retry logic
- Add caching to reduce API calls
- Support multiple routers
- WebSocket real-time updates instead of polling
