# NetForge - Automated Installation Guide

One-click installation and startup scripts for all platforms.

## Overview

We provide two automated installation scripts:

- **`install.sh`** - For Linux (Alpine, Ubuntu, Debian) and macOS
- **`install.bat`** - For Windows 10+

These scripts will:
1. ✅ Check system requirements
2. ✅ Install Node.js (if needed)
3. ✅ Install all dependencies
4. ✅ Ask for MikroTik router credentials
5. ✅ Test the server
6. ✅ Start the application automatically
7. ✅ Open your browser
8. ✅ Display access instructions

**Total setup time: ~3-5 minutes**

---

## Linux / Alpine Linux Installation

### One Command (Recommended)

```bash
# Clone and run in one command
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik
chmod +x install.sh
./install.sh
```

### Step-by-Step

1. **Clone the repository**
   ```bash
   git clone https://github.com/mubashiribstec/Mikrotik.git
   cd Mikrotik
   ```

2. **Make the script executable**
   ```bash
   chmod +x install.sh
   ```

3. **Run the installation script**
   ```bash
   ./install.sh
   ```

4. **Follow the prompts**
   - Confirm Node.js installation (if needed)
   - Enter your MikroTik router IP
   - Enter SSH port (usually 22)
   - Enter username (usually admin)
   - Enter password

5. **Server will start automatically**
   - Browser opens automatically (if available)
   - Live logs shown in terminal
   - Press `Ctrl+C` to stop the server

### What the Script Does

```
✓ Checks operating system (Alpine/Ubuntu/Debian/macOS)
✓ Verifies Node.js installation
✓ Installs Node.js (if missing)
✓ Installs npm dependencies
✓ Prompts for MikroTik credentials
✓ Saves configuration to ~/.netforge/config
✓ Runs endpoint tests
✓ Starts the server
✓ Opens browser to http://localhost:4444
✓ Streams live logs
```

### Script Options & Features

**View logs later:**
```bash
tail -f ~/.netforge/logs/server.log
```

**Reconfigure router:**
```bash
rm ~/.netforge/config
./install.sh
```

**Change port (if 3001 is in use):**
Edit `server-enhanced.js` line ~1400:
```javascript
const PORT = 3000; // Change from 3001
```

**Run without opening browser:**
```bash
# Edit install.sh and comment out open_browser() call
```

---

## macOS Installation

### Automatic Installation

The `install.sh` script handles macOS automatically:

```bash
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik
chmod +x install.sh
./install.sh
```

### Manual Installation (if script fails)

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Clone and setup
git clone https://github.com/mubashiribstec/Mikrotik.git
cd Mikrotik
npm install
npm start
```

Then open: **http://localhost:4444**

---

## Windows Installation

### One-Click Installation

1. **Download and extract**
   - Clone or download the repository
   - Extract to a folder (e.g., `C:\Users\YourName\Mikrotik`)

2. **Install Node.js** (if not already installed)
   - Download from: https://nodejs.org/ (LTS version recommended)
   - Run installer and follow prompts
   - Restart your computer

3. **Run the install script**
   - Right-click `install.bat`
   - Select "Run as administrator"
   - Or: Double-click `install.bat`

4. **Follow the prompts**
   - Enter your MikroTik router IP
   - Enter SSH port (usually 22)
   - Enter username (usually admin)
   - Enter password

5. **Browser opens automatically**
   - NetForge web interface loads
   - Connected to your router
   - Ready to use!

### Troubleshooting on Windows

**Script won't run:**
- Right-click Command Prompt
- Select "Run as Administrator"
- Navigate to the Mikrotik folder
- Type: `install.bat`

**Node.js not found:**
- Reinstall from: https://nodejs.org/
- Restart your computer
- Try again

**Port 3001 already in use:**
- Open Command Prompt
- Type: `netstat -ano | findstr :4444`
- Close the application using that port
- Try again

**Help!**
- See SETUP.md for detailed troubleshooting
- Check the command prompt for error messages

---

## Configuration File

Both scripts save your configuration to:

**Linux/macOS:**
```
~/.netforge/config
```

**Windows:**
```
C:\Users\YourName\.netforge\config.bat
```

### What's Saved

```bash
# Your credentials (stored locally, not in git)
ROUTER_HOST="192.168.88.1"
ROUTER_PORT="22"
ROUTER_USER="admin"
ROUTER_PASS="your-password"
ROUTER_NAME="Main Router"
```

### Edit Configuration

**Linux/macOS:**
```bash
nano ~/.netforge/config
# Edit and save
./install.sh  # Run again - it will use your settings
```

**Windows:**
```
Edit: C:\Users\YourName\.netforge\config.bat
Then run: install.bat
```

---

## Verify Installation

### Test 1: Server Health
```bash
# Should see: 18 passed, 0 failed
node test-endpoints.js
```

### Test 2: Browser Access
```
http://localhost:4444
```
Should show login screen

### Test 3: Router Connection
1. Enter credentials
2. Click "Connect"
3. Should show dashboard with system stats

---

## Running in Background

### Linux/Alpine (Keep running after logout)

**Option 1: nohup (simple)**
```bash
nohup npm start > netforge.log 2>&1 &
# View logs
tail -f netforge.log
```

**Option 2: supervisor (recommended)**
```bash
# Follow SETUP.md section "Running in Production"
```

**Option 3: systemd**
```bash
# Follow SETUP.md section "Running in Production"
```

### Windows (Keep running)

**Option 1: Use Task Scheduler**
1. Open Task Scheduler
2. Create a task to run `npm start` in the Mikrotik folder
3. Set to run on startup

**Option 2: Use NSSM (Non-Sucking Service Manager)**
```cmd
# Download NSSM: nssm.cc/download
nssm install NetForge npm start C:\path\to\Mikrotik
nssm start NetForge
```

---

## Network Access

### Local Network
```
http://192.168.x.x:4444
```
(Replace with your computer's IP)

### Remote Access (NOT Recommended for public internet)

If you need remote access:
1. Use a VPN to your network
2. Or configure nginx/Apache as reverse proxy with SSL
3. See SETUP.md for production deployment

**Security Warning:** Do NOT expose port 4444 to the internet without SSL/TLS encryption.

---

## Updating

### Get Latest Version

```bash
cd Mikrotik
git pull origin main
npm install
./install.sh
```

### Check Version History

```bash
git log --oneline -10
```

---

## Uninstalling

### Linux/macOS

```bash
# Stop the server
killall node

# Remove installation (optional)
rm -rf ~/Mikrotik
rm -rf ~/.netforge  # Keep this if you want to preserve credentials
```

### Windows

```cmd
# Stop the server
taskkill /F /IM node.exe

# Delete the folder
# Delete: C:\Users\YourName\.netforge (optional - keeps credentials)
```

---

## Common Issues

### Issue: "Port 3001 already in use"

**Linux/macOS:**
```bash
lsof -i :4444
kill -9 <PID>
```

**Windows:**
```cmd
netstat -ano | findstr :4444
taskkill /PID <PID> /F
```

Or change port in `server-enhanced.js`

### Issue: "Node.js not found"

1. Verify installation:
   ```bash
   node --version
   npm --version
   ```

2. Reinstall from: https://nodejs.org/

3. Restart terminal/computer

4. Try again

### Issue: "Cannot connect to router"

1. **Verify SSH access:**
   ```bash
   ssh admin@192.168.88.1
   ```

2. **Check firewall:**
   - Router menu → IP → Services
   - Verify SSH is enabled
   - Verify port 22 (or your custom port)

3. **Check credentials:**
   - Correct username?
   - Correct password?
   - Correct IP address?

4. **Check network:**
   - Can you ping the router?
   - ```bash
     ping 192.168.88.1
     ```

### Issue: "Script won't run on macOS"

```bash
# Make sure it's executable
chmod +x install.sh

# Run with explicit shell
bash install.sh
```

### Issue: "npm install fails"

```bash
# Clear cache
npm cache clean --force

# Remove old files
rm -rf node_modules package-lock.json

# Reinstall
npm install
```

---

## Getting Help

1. **Check logs:**
   ```bash
   # Linux/macOS
   tail -f ~/netforge.log
   
   # Windows
   type netforge.log
   ```

2. **Read documentation:**
   - `README.md` - Overview
   - `SETUP.md` - Detailed guide
   - `QUICKSTART.md` - Quick start

3. **Test endpoints:**
   ```bash
   node test-endpoints.js
   ```

4. **Check GitHub issues:**
   https://github.com/mubashiribstec/Mikrotik/issues

---

## Security Notes

### Credentials Storage

- **Local only** - Credentials stored in `~/.netforge/`
- **Never in git** - Configuration is .gitignored
- **File permissions** - Config file is readable only by you

### Best Practices

1. Use strong router password
2. Keep your router accessible only on internal network
3. Don't share credentials
4. Use HTTPS for remote access (configure reverse proxy)
5. Keep Node.js updated: `npm install -g npm`

---

## Next Steps

After installation:

1. ✅ Access http://localhost:4444
2. ✅ Login with your router credentials
3. ✅ Explore the dashboard
4. ✅ Monitor real-time metrics
5. ✅ Configure rules and settings

---

## Support

For detailed documentation:
- 📖 [SETUP.md](SETUP.md) - Complete setup guide
- 📖 [QUICKSTART.md](QUICKSTART.md) - 5-minute quick start
- 📖 [README.md](README.md) - Project overview

**Enjoy managing your MikroTik router!** 🚀
