# Timon Dashboard (GR Verk — Starfsmannavakt)

A shareable local-network dashboard for live employee sign-in visibility by project, powered by the Tímon API.

---

## English

### 1) Prerequisites
- Node.js 18+

### 2) Installation
```bash
cd timon-dashboard
npm install
```

### 3) Configuration
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Environment variables:
- `TIMON_USERNAME` = SSN username for Tímon
- `TIMON_PASSWORD` = Tímon password
- `PIN` = optional access PIN for dashboard viewers
- `PORT` = server port (default `3000`)
- `SHOW_INACTIVE_EMPLOYEES` = `true`/`false`

### 4) Running
```bash
node server.js
```
The server binds to `0.0.0.0`, so teammates can open:
- `http://<server-ip>:3000`

### 5) Find your local IP
Linux/macOS:
```bash
hostname -I
```
or:
```bash
ip a
```

Windows (PowerShell):
```powershell
ipconfig
```

### 6) Run in background with PM2
Install PM2 globally:
```bash
npm i -g pm2
```
Start app:
```bash
pm2 start server.js --name timon-dashboard
```
Save process list:
```bash
pm2 save
```
Enable startup on reboot:
```bash
pm2 startup
```
View logs:
```bash
pm2 logs timon-dashboard
```

---

## Íslenska

### 1) Kröfur
- Node.js 18+

### 2) Uppsetning
```bash
cd timon-dashboard
npm install
```

### 3) Stillingar
Afritaðu `.env.example` í `.env` og fylltu inn upplýsingar:
```bash
cp .env.example .env
```

Breytur í `.env`:
- `TIMON_USERNAME` = kennitala/notandanafn í Tímon
- `TIMON_PASSWORD` = lykilorð í Tímon
- `PIN` = valfrjáls PIN kóði fyrir aðgang að mælaborði
- `PORT` = port (sjálfgefið `3000`)
- `SHOW_INACTIVE_EMPLOYEES` = `true`/`false`

### 4) Keyrsla
```bash
node server.js
```
Þjónninn bindst á `0.0.0.0` og er því aðgengilegur á innraneti:
- `http://<ip-tölva>:3000`

### 5) Finna staðarnet-IP
Linux/macOS:
```bash
hostname -I
```
Eða:
```bash
ip a
```

Windows (PowerShell):
```powershell
ipconfig
```

### 6) Keyra í bakgrunni með PM2
Setja PM2 upp:
```bash
npm i -g pm2
```
Ræsa forrit:
```bash
pm2 start server.js --name timon-dashboard
```
Vista process lista:
```bash
pm2 save
```
Virkja sjálfvirka ræsingu við restart:
```bash
pm2 startup
```
Skoða logga:
```bash
pm2 logs timon-dashboard
```

---

## Notes
- Uses only `/api/v2/*` Tímon endpoints.
- Server caches API responses for 4 minutes and auto-refreshes every 5 minutes.
- All server/API errors are logged to `timon-dashboard.log`.
- If refresh fails, the UI shows last successful data with a stale-data warning.
