# Quick Start Guide - NetForge

Get NetForge running in 5 minutes on Alpine Linux or any Unix-like system.

## Step-by-Step (Copy & Paste)

### 1. Install Node.js (if not already installed)

**Alpine Linux:**
```bash
apk update
apk add nodejs npm
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install nodejs npm
```

**macOS:**
```bash
brew install node
```

### 2. Clone & Setup

```bash
# Clone the repository
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik

# Install dependencies
npm install

# Verify installation
node --version  # Should be v16.0 or higher
npm --version   # Should be v7.0 or higher
```

### 3. Start the Server

```bash
npm start
```

You should see:
```
NetForge API server running on http://localhost:3001
WebSocket available at ws://localhost:3001/ws?sessionId=<sessionId>
```

### 4. Open in Browser

- **Local computer**: http://localhost:3001
- **Remote server**: http://<SERVER_IP>:3001

## Login to Your MikroTik Router

Fill in the login form with:

| Field | Example |
|-------|---------|
| Host | `192.168.88.1` |
| Port | `22` |
| Username | `admin` |
| Password | `your-password` |

Click **"Connect"** and you're done!

## Verify It Works

In another terminal, run:
```bash
node test-endpoints.js
```

Expected output:
```
18 passed, 0 failed
```

## Running in Background (Alpine Linux)

### Option 1: Simple (nohup)
```bash
cd /path/to/Mikrotik
nohup npm start > netforge.log 2>&1 &
echo $! > netforge.pid

# Check logs
tail -f netforge.log

# Stop
kill $(cat netforge.pid)
```

### Option 2: Using screen
```bash
screen -S netforge npm start

# Detach: Ctrl+A, then D
# Resume: screen -r netforge
```

### Option 3: Using supervisor (recommended)
```bash
# Install
apk add supervisor

# Create config
cat > /etc/supervisor/conf.d/netforge.conf << 'EOF'
[program:netforge]
directory=/path/to/Mikrotik
command=npm start
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/netforge.log
user=root
EOF

# Start
supervisorctl reread
supervisorctl update
supervisorctl start netforge

# Check status
supervisorctl status netforge

# View logs
tail -f /var/log/netforge.log
```

## Common Issues

### "Port 3001 already in use"
```bash
# Find what's using it
lsof -i :3001
# Kill the process
kill -9 <PID>
# Or use a different port (edit server-enhanced.js)
```

### "Cannot connect to MikroTik"
1. Test SSH manually: `ssh admin@192.168.88.1`
2. Verify port 22 is open on router
3. Check credentials are correct
4. Ensure router IP is correct

### "npm install fails"
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

## What's Included

✅ Real-time system monitoring  
✅ Network interface management  
✅ Route and NAT configuration  
✅ Firewall rules view  
✅ DHCP client tracking  
✅ Hotspot user management  
✅ System logs streaming  
✅ Backup management  
✅ VPN monitoring  
✅ Script execution  

## Next Steps

- Read [SETUP.md](SETUP.md) for detailed documentation
- Read [README.md](README.md) for feature overview
- Check browser console (F12) for any errors
- Review server logs: `tail -f netforge.log`

## Getting Help

1. Check [SETUP.md](SETUP.md) for troubleshooting
2. Review server logs for error messages
3. Test SSH connection independently
4. Verify network connectivity

---

**That's it! You're ready to manage your MikroTik routers.** 🚀
