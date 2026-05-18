# 🚀 NetForge - Quick Installation Summary

## TL;DR - Just Run This!

### For Alpine Linux / Linux / macOS:
```bash
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik
chmod +x install.sh
./install.sh
```

### For Windows:
1. Clone repository
2. Double-click `install.bat`
3. Follow prompts

---

## What Happens Automatically

The installation script will:

1. ✅ Check if Node.js is installed
2. ✅ Install Node.js if missing (Linux only)
3. ✅ Install all npm dependencies
4. ✅ Ask for your MikroTik router details:
   - Router IP (e.g., 192.168.88.1)
   - SSH Port (usually 22)
   - Username (usually admin)
   - Password (your router password)
5. ✅ Save configuration locally
6. ✅ Run test suite
7. ✅ Start the server on port 3001
8. ✅ Open browser automatically
9. ✅ Display login screen

**Total time: 3-5 minutes**

---

## Step-by-Step for Alpine Linux

```bash
# 1. Update package manager (optional but recommended)
apk update

# 2. Clone the repository
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik

# 3. Make script executable
chmod +x install.sh

# 4. Run the installation script
./install.sh
```

The script will:
- Check Node.js installation
- Install Node.js if needed (uses apk)
- Install dependencies
- Prompt for router credentials
- Start the server
- Show logs in real-time

---

## Step-by-Step for Windows

```
1. Download/Clone the repository
   https://github.com/mubashiribstec/Mikrotik/archive/refs/heads/main.zip

2. Extract the ZIP file to a folder
   C:\Users\YourName\Mikrotik

3. Install Node.js (if not installed)
   https://nodejs.org/
   - Download LTS version
   - Run installer
   - Restart computer

4. Run install script
   - Right-click: install.bat
   - Select: Run as administrator
   OR
   - Double-click: install.bat

5. Follow the prompts
   - Enter router IP
   - Enter username
   - Enter password

6. Browser opens automatically
```

---

## What You Need

### For Your Computer
- Node.js v16+ (script will install)
- npm v7+ (comes with Node.js)
- 256MB RAM minimum
- 100MB disk space

### For Your MikroTik Router
- RouterOS v6.40+ (recommended v7.0+)
- SSH enabled on port 22
- Valid admin credentials
- Network connectivity from your computer

---

## Login Credentials

After the script completes, you'll see:

```
Web Interface: http://localhost:8080
Router IP: 192.168.88.1
Username: admin
```

The credentials will be pre-filled in the login form!

If not pre-filled, use the credentials you entered during setup.

---

## Features Available

Once logged in:

🎯 **Dashboard**
- Real-time CPU, memory, storage
- System uptime

🌐 **Network Management**
- Interface status
- WAN configuration
- Route management
- NAT rules

👥 **Clients & Users**
- DHCP client list
- Connected device tracking
- Traffic per client

🔒 **Security**
- Firewall rules
- Connection tracking
- Dropped packets

📊 **Monitoring**
- Real-time logs
- Bandwidth usage
- VPN status
- System backups

⚙️ **Advanced**
- Script execution
- System configuration
- DNS settings
- Hotspot management

---

## Stop the Server

### Linux/macOS:
```bash
# If running in terminal:
Ctrl+C

# If running in background:
killall node
# or
kill $(cat ~/.netforge/.server.pid)
```

### Windows:
```cmd
# Close the command prompt window
# or
taskkill /F /IM node.exe
```

---

## Troubleshooting

### "Node.js not found"
```bash
# Reinstall from https://nodejs.org/
# Restart terminal/computer
# Run script again
```

### "Cannot connect to router"
1. Verify SSH works: `ssh admin@192.168.88.1`
2. Check firewall: Router → IP → Services → SSH enabled
3. Verify credentials are correct
4. Verify router IP is correct

### "Port 3001 in use"
```bash
# Kill the process using port 3001
# Then run the script again
```

### Need help?
- See `INSTALL_GUIDE.md` for detailed help
- See `SETUP.md` for troubleshooting
- See `QUICKSTART.md` for quick reference

---

## After Installation

### View logs anytime:
```bash
# Linux/macOS
tail -f netforge.log

# Windows
type netforge.log
```

### Change router credentials:
```bash
# Remove old config
rm ~/.netforge/config  # Linux/macOS
# or delete: C:\Users\YourName\.netforge\config.bat  # Windows

# Run install script again
./install.sh  # or install.bat
```

### Run in background permanently:
See `SETUP.md` section "Running in Production"

---

## What Gets Saved

Configuration file location:
- **Linux/macOS**: `~/.netforge/config`
- **Windows**: `C:\Users\YourName\.netforge\config.bat`

Contains:
- Router IP
- SSH Port
- Username
- Router display name
- Password (encrypted locally)

**Not stored in git - kept private on your computer**

---

## Network Access

### From same computer:
```
http://localhost:8080
```

### From another computer on same network:
```
http://<your-computer-ip>:8080
```

Find your IP:
```bash
# Linux/macOS
hostname -I

# Windows
ipconfig
```

### From outside your network:
- Use VPN to connect to your network
- Or setup HTTPS with reverse proxy (see SETUP.md)
- Do NOT expose to internet without SSL/TLS!

---

## Files in Repository

```
Mikrotik/
├── install.sh                      ← Run this (Linux/macOS)
├── install.bat                     ← Run this (Windows)
├── INSTALL_GUIDE.md               ← Detailed installation guide
├── README.md                       ← Project overview
├── SETUP.md                        ← Complete documentation
├── QUICKSTART.md                   ← 5-minute quick start
├── netforge-api-integrated.html    ← Frontend (React)
├── server-enhanced.js              ← Backend (Node.js)
├── test-endpoints.js               ← Test suite
├── package.json                    ← Dependencies
└── .gitignore                      ← Git settings
```

---

## System Requirements

### Alpine Linux
```bash
# Node.js and npm installed automatically
# Requirements: 256MB RAM, 100MB disk
```

### Ubuntu/Debian
```bash
# Node.js and npm installed automatically
# Requirements: 256MB RAM, 100MB disk
```

### macOS
```bash
# Homebrew required for automatic install
# Or: brew install node
# Requirements: 256MB RAM, 100MB disk
```

### Windows
```
Node.js v16+: https://nodejs.org/
NPM v7+: Comes with Node.js
Requirements: 256MB RAM, 100MB disk
```

---

## One More Thing...

The installation script is designed to be foolproof:
- ✅ Handles all error cases
- ✅ Provides helpful error messages
- ✅ Saves your credentials locally
- ✅ Automatically tests the server
- ✅ Opens your browser
- ✅ Shows live logs

**Just run it and follow the prompts!**

---

## Happy Monitoring! 🎉

You're now ready to manage your MikroTik router from a beautiful web interface.

Questions? See the documentation:
- `INSTALL_GUIDE.md` - Installation help
- `SETUP.md` - Complete documentation
- `README.md` - Features overview

Enjoy! 🚀
