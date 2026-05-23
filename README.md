# NetForge — MikroTik Router Manager

A modern, single-page web interface for managing MikroTik routers via SSH or RouterOS API. Real-time monitoring, firewall management, VPN setup, service blocking, and full terminal access — all in a browser.

![Dashboard](screenshots/02-dashboard.png)

---

## Features

| Category | Features |
|---|---|
| **Monitoring** | Live CPU / RAM / storage / uptime, interface status, bandwidth graphs, top talkers |
| **Network** | IP addresses, routes, NAT rules, DNS (static + cache flush), DHCP leases |
| **Firewall** | Filter rules, one-click service blocking (YouTube, TikTok, Snapchat, etc.), L7 + DNS + IP blocking |
| **VPN** | WireGuard (create interface + add peers), L2TP/IPsec, PPTP server management |
| **WAN** | Multi-WAN load balance (PCC / NTH / Failover), health checks, auto-restart |
| **Access Control** | Allowed-IP allowlist per service port, brute-force protection |
| **Wireless** | Interface status, SSID info (RouterOS 6 wireless + RouterOS 7 wifi) |
| **Hotspot / PPPoE** | User management, live session stats, profile assignment |
| **Automation** | Scheduler, script library with real RouterOS source, deploy-and-run templates |
| **Terminal** | Full RouterOS CLI passthrough with command history |
| **Backup** | Create backups, list existing, schedule automatic daily backups |
| **Users** | Router user management (`/user add/remove`) |

---

## Screenshots

<table>
<tr>
<td><img src="screenshots/01-login.png" width="480"/><br><sub>Login — SSH or RouterOS API</sub></td>
<td><img src="screenshots/02-dashboard.png" width="480"/><br><sub>Dashboard — live system metrics</sub></td>
</tr>
<tr>
<td><img src="screenshots/03-firewall.png" width="480"/><br><sub>Firewall — service blocking + rules</sub></td>
<td><img src="screenshots/04-vpn.png" width="480"/><br><sub>VPN — WireGuard, L2TP, PPTP</sub></td>
</tr>
<tr>
<td><img src="screenshots/06-wan.png" width="480"/><br><sub>WAN & Load Balance</sub></td>
<td><img src="screenshots/05-dhcp.png" width="480"/><br><sub>DHCP & Connected Clients</sub></td>
</tr>
<tr>
<td><img src="screenshots/15-access-control.png" width="480"/><br><sub>Access Control — allowed IPs per port</sub></td>
<td><img src="screenshots/16-terminal.png" width="480"/><br><sub>Terminal — RouterOS CLI</sub></td>
</tr>
<tr>
<td><img src="screenshots/11-scripts.png" width="480"/><br><sub>Scripts & Scheduler</sub></td>
<td><img src="screenshots/12-logs.png" width="480"/><br><sub>Logs — live system log stream</sub></td>
</tr>
<tr>
<td><img src="screenshots/13-bandwidth.png" width="480"/><br><sub>Bandwidth — queue management</sub></td>
<td><img src="screenshots/10-hotspot.png" width="480"/><br><sub>Hotspot / PPPoE users</sub></td>
</tr>
<tr>
<td><img src="screenshots/23-automation.png" width="480"/><br><sub>Automation — recipes & scheduler</sub></td>
<td><img src="screenshots/22-network-health.png" width="480"/><br><sub>Network Health — ping & traceroute</sub></td>
</tr>
</table>

---

## Requirements

- **Node.js** v16 or later
- **npm** v7 or later
- A MikroTik router with **SSH enabled** (port 22) **or** RouterOS API enabled (port 8728)

---

## Installation

### Option 1 — Direct (Linux / macOS / WSL)

```bash
# 1. Clone the repository
git clone https://github.com/mubashiribstec/mikrotik.git
cd mikrotik

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open **http://localhost:4444** in your browser.

---

### Option 2 — Docker

```bash
# Build and run with Docker Compose
docker compose up -d

# Or manually
docker build -t netforge .
docker run -d -p 4444:4444 --name netforge netforge
```

Open **http://localhost:4444** in your browser.

---

### Option 3 — Windows (install.bat)

Double-click **`install.bat`** — it installs Node.js (if needed), runs `npm install`, and starts the server automatically.

---

## First Login

1. Open **http://localhost:4444**
2. Enter your router's **IP address**
3. Choose connection type:
   - **SSH** (default, port 22) — works on all MikroTik routers
   - **RouterOS API** (port 8728) — faster, requires API service enabled on router
4. Enter your router **username** and **password**
5. Click **Connect**

> **Tip:** Create a dedicated NetForge user on your router:
> ```routeros
> /user add name=netforge password=strongpass group=full comment="NetForge"
> ```

---

## Router Prerequisites

### Enable SSH (if not already active)
```routeros
/ip service enable ssh
/ip service set ssh port=22
```

### Enable RouterOS API (optional, for API connection mode)
```routeros
/ip service enable api
/ip service set api port=8728
```

---

## Configuration

The server runs on port **4444** by default. Override with an environment variable:

```bash
PORT=8080 npm start
```

No config file needed — all UI preferences are stored in browser `localStorage`.

---

## Security Notes

- NetForge runs entirely on your local network — no data leaves your infrastructure
- Sessions expire after 2 hours of inactivity
- Use the **Access Control** screen to restrict which IPs can reach management ports
- For internet-facing deployments, run behind a reverse proxy (nginx / Caddy) with HTTPS + authentication

---

## All Screens

| Screen | Description |
|---|---|
| Dashboard | Live CPU, RAM, uptime, interface status, bandwidth, top clients |
| Interfaces | All interfaces with traffic counters, enable/disable |
| IP Addresses | Add / remove IP assignments per interface |
| Routes | Routing table — add, delete, view distances |
| DNS | Server settings, static entries, cache flush |
| NAT | Masquerade, dst-nat, port forward rules |
| WAN & Load Balance | Multi-WAN PCC / NTH / Failover with health checks |
| Firewall | Rules list + one-click block for 9 services |
| Bandwidth | Simple queue per-IP rate limits |
| DHCP & Clients | Active leases, ARP table, static reservations |
| Hotspot / PPPoE | Hotspot and PPPoE user sessions and management |
| Wireless | WiFi interface status (RouterOS 6 + RouterOS 7) |
| VPN | WireGuard interfaces & peers, L2TP/IPsec, PPTP |
| Logs | Live system log with topic and severity filters |
| Scripts | Script library with RouterOS templates, deploy & run |
| Backup | Create backups, list files, schedule daily auto-backup |
| Users | Router user accounts — add, remove, set password |
| Automation | Scheduler entries and pre-built automation recipes |
| Network Health | Ping, traceroute, SLA uptime monitoring |
| Port Forwards | DSTNAT port forward wizard |
| Access Control | Per-port IP allowlist + brute-force connection limiting |
| Terminal | Full RouterOS CLI with ↑↓ history and Ctrl+L clear |
| Settings | UI preferences, reconnect, theme |

---

## Tech Stack

- **Backend:** Node.js · Express · ssh2 · ws
- **Frontend:** React 18 (Babel standalone — no build step required)
- **Protocols:** SSH (`ssh2` library) or RouterOS binary API (port 8728, built-in implementation)
- **Realtime:** WebSocket push from server, automatic HTTP polling fallback

---

## License

MIT
