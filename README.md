# Watch Party

A self-hosted, two-person watch party web app. Stream local movie files and sync playback in real-time — no cloud storage, no subscriptions.

## How it works

```
[Your Machine]
  ├── Node.js server (Express + Socket.io)
  │     ├── Serves the frontend
  │     ├── Streams video files (HTTP range requests)
  │     └── WebSocket hub (sync events)
  └── Cloudflare Tunnel → public HTTPS URL → [Friend's Browser]
```

## Features

- Real-time play/pause/seek sync between two viewers
- HTTP 206 range request streaming — seek anywhere in large files without buffering the whole thing
- Host-controlled playback; guest stays in sync automatically
- Chat sidebar
- Mobile-friendly (iOS Safari / Android Chrome)
- Dark theme

## Requirements

- [Node.js](https://nodejs.org/) v18+
- An `.mp4` file to watch (H.264 + AAC recommended for broadest browser support)
- [`cloudflared`](https://github.com/cloudflare/cloudflared) for the public tunnel

## Setup

```bash
git clone https://github.com/Sero01/watchparty.git
cd watchparty
npm install
```

Drop your `.mp4` files into the `movies/` directory.

## Running

**Terminal 1 — start the server:**
```bash
node server.js
```

**Terminal 2 — open a public tunnel:**
```bash
# Download cloudflared (one-time)
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
chmod +x cloudflared

# Start tunnel
./cloudflared tunnel --url http://localhost:3000
# Prints: https://random-name.trycloudflare.com
```

## Usage

1. **You (host):** open `http://localhost:3000` → Create Room → note the 6-character room code → select a movie
2. **Your friend:** open the Cloudflare URL on their device → Join Room → enter the room code

Play/pause/seek on the host propagates to the guest within ~1 second.

## Video format note

MP4 with H.264 video + AAC audio works natively in all browsers. To convert other formats:

```bash
ffmpeg -i input.mkv -c:v copy -c:a aac output.mp4
```

## Project structure

```
watchparty/
├── server.js          # Express + Socket.io + video streaming
├── public/
│   ├── index.html     # Lobby (create/join room)
│   ├── player.html    # Video player UI
│   ├── app.js         # Socket.io client + sync logic
│   └── style.css      # Dark theme, mobile-first
└── movies/            # Drop .mp4 files here (gitignored)
```
