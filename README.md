# VideoVault 🎬

A self-hosted, dockerized video library browser. Point it at a folder of `.mp4` files and get a sleek, searchable UI with thumbnails and timeline navigation.

Yes, I "vibe coded" this. There is no authentication, it was built to run internally on my homelab/server network for quick access and organization of home security videos. <br>
<br>
See my [Raspberry Pi Zero to flash drive guide](https://github.com/D00MSDAYDEVICE/How-Tos/blob/main/pi_zero_usb_camera_video_sync.md)

## Features

- **Auto-scans** your video folder recursively (mp4, mkv, webm, mov, avi)
- **Auto-generates thumbnails** via ffmpeg (persisted across restarts)
- **Real-time polling** — detects new/removed files automatically
- **Timeline sidebar** — browse by Month → Day
- **Searchable** — filter by filename or path
- **In-browser playback** — range-request streaming, no re-encoding
- **Manual rescan** button in the header

---

## Quick Start

### 1. Set your video folder

Edit `docker-compose.yml` and replace `/path/to/your/videos` with your actual folder:

```yaml
volumes:
  - /home/your/videos:/videos:ro
```

### 2. Build & run

```bash
docker compose up --build -d
```

### 3. Open the UI

```
http://localhost:8080
```

The backend API runs on port `3001`. <br>
The frontend runs on port `8080`.<br>
If you need to change port 3001, update lines 580 and 581 in /frontend/public/index.html
---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VIDEO_DIR` | `/videos` | Path inside container where videos are mounted |

---

## Ports

| Port | Service |
|---|---|
| `8080` | Web UI (nginx) |
| `3001` | Backend API + video streaming |

---

## Architecture

```
┌─────────────┐        ┌──────────────────────────────┐
│   Browser   │──8080──│  Frontend (nginx)            │
│             │──3001──│  Backend (Node/Express)      │
└─────────────┘        │   • ffmpeg thumbnail gen     │
                       │   • chokidar folder watching │
                       │   • range-request streaming  │
                       └──────────────────────────────┘
                                    │
                             /videos (your folder)
```

---

## Updating

```bash
docker compose pull
docker compose up --build -d
```

Thumbnails are stored in a named Docker volume (`videovault-thumbs`) and survive rebuilds.
