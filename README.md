# Nimbus

Self-hosted Discord-style chat: servers, channels, DMs, friends, voice/video calls, screen share, themes.

## Run
    npm install
    node server.js        (or double-click start.bat)
Open http://localhost:3000. Data is stored in data.json. Starter server invite code: HQ

## Put it online (so friends can use it from anywhere)
Needs a host that runs Node and supports WebSockets (Render, Railway, Fly.io, a VPS...).
Start command: `node server.js`. It reads the PORT env var. Camera/mic/screen share require HTTPS,
which all of those hosts provide.

## Notes on restricted networks
- Everything is same-origin: one domain, plain HTTPS + WebSocket (wss) on port 443, no external CDNs/fonts/scripts.
- A filter that blocks your domain will still block it. A fresh custom domain or a less-known host is usually allowed;
  filters often categorise new domains slowly.
- Voice/video use WebRTC peer-to-peer (STUN only). On very strict networks that block UDP, calls may not connect;
  fix by adding a TURN server to RTC_CFG in public/app.js.
