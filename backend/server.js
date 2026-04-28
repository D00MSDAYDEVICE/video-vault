const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const chokidar = require('chokidar');
const cors = require('cors');

const app = express();
const PORT = 3001;

const VIDEO_DIR = process.env.VIDEO_DIR || '/videos';
const THUMB_DIR = '/app/thumbnails';
const THUMB_PUBLIC = '/thumbnails';

// Ensure thumbnail dir exists
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/thumbnails', express.static(THUMB_DIR));
app.use('/videos', express.static(VIDEO_DIR));

// In-memory video index
let videoIndex = [];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Try to parse date from folder path segments.
// Supports patterns in any path segment:
//   YY-MM-DD  (e.g. 26-04-06)
//   YY-MM     (e.g. 26-04)
//   YYYY-MM-DD
//   YYYY-MM
function parseDateFromPath(relativePath) {
  const segments = relativePath.replace(/\\/g, '/').split('/');

  let year = null, monthNum = null, day = null;

  for (const seg of segments) {
    // Full date: YY-MM-DD or YYYY-MM-DD
    let m = seg.match(/^(\d{2,4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = parseInt(m[1]);
      year = y < 100 ? 2000 + y : y;
      monthNum = parseInt(m[2]) - 1; // 0-indexed
      day = parseInt(m[3]);
      break; // most specific, stop here
    }
    // Month only: YY-MM or YYYY-MM
    m = seg.match(/^(\d{2,4})-(\d{2})$/);
    if (m && monthNum === null) {
      const y = parseInt(m[1]);
      year = y < 100 ? 2000 + y : y;
      monthNum = parseInt(m[2]) - 1;
      // don't break — a deeper segment may have the full date
    }
  }

  return { year, monthNum, day };
}

function getVideoMeta(filePath) {
  const stat = fs.statSync(filePath);
  const relativePath = path.relative(VIDEO_DIR, filePath);
  const name = path.basename(filePath, path.extname(filePath));
  const mtime = stat.mtime;

  // Prefer dates encoded in the folder structure
  const parsed = parseDateFromPath(relativePath);
  const year     = parsed.year     ?? mtime.getUTCFullYear();
  const monthNum = parsed.monthNum ?? mtime.getUTCMonth();
  const day      = parsed.day      ?? mtime.getUTCDate();
  const month    = MONTH_NAMES[monthNum] ?? mtime.toLocaleString('default', { month: 'long', timeZone: 'UTC' });

  return {
    id: Buffer.from(relativePath).toString('base64').replace(/[/+=]/g, '_'),
    name,
    relativePath,
    size: stat.size,
    mtime: mtime.toISOString(),
    month,
    monthNum,
    day,
    year,
    videoUrl: `/videos/${relativePath.replace(/\\/g, '/')}`,
  };
}

function generateThumbnail(filePath, id) {
  const thumbPath = path.join(THUMB_DIR, `${id}.jpg`);
  if (fs.existsSync(thumbPath)) return thumbPath;

  try {
    execSync(
      `ffmpeg -y -ss 00:00:03 -i "${filePath}" -vframes 1 -vf "scale=320:-1" "${thumbPath}" 2>/dev/null`,
      { timeout: 30000 }
    );
    return thumbPath;
  } catch (e) {
    // Try at 0s if 3s fails (short video)
    try {
      execSync(
        `ffmpeg -y -ss 00:00:00 -i "${filePath}" -vframes 1 -vf "scale=320:-1" "${thumbPath}" 2>/dev/null`,
        { timeout: 30000 }
      );
      return thumbPath;
    } catch (e2) {
      return null;
    }
  }
}

function scanVideos() {
  const results = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (['.mp4', '.mkv', '.webm', '.mov', '.avi'].includes(path.extname(entry.name).toLowerCase())) {
        try {
          const meta = getVideoMeta(fullPath);
          const thumbPath = generateThumbnail(fullPath, meta.id);
          meta.thumbnailUrl = thumbPath ? `${THUMB_PUBLIC}/${meta.id}.jpg` : null;
          results.push(meta);
        } catch (e) {
          console.error('Error processing:', fullPath, e.message);
        }
      }
    }
  }

  walk(VIDEO_DIR);
  // Sort by date descending
  results.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  videoIndex = results;
  console.log(`[scan] Found ${results.length} videos`);
}

// Initial scan
console.log('[init] Scanning videos...');
scanVideos();

// Watch for changes
const watcher = chokidar.watch(VIDEO_DIR, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
});

let debounceTimer;
function debouncedScan() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log('[watcher] Change detected, rescanning...');
    scanVideos();
  }, 3000);
}

watcher.on('add', debouncedScan);
watcher.on('unlink', debouncedScan);
watcher.on('change', debouncedScan);

// API endpoints
app.get('/api/videos', (req, res) => {
  res.json(videoIndex);
});

app.get('/api/status', (req, res) => {
  res.json({
    videoCount: videoIndex.length,
    videoDir: VIDEO_DIR,
    lastScan: new Date().toISOString(),
  });
});

// Force rescan
app.post('/api/rescan', (req, res) => {
  scanVideos();
  res.json({ ok: true, count: videoIndex.length });
});

// Video streaming with range support
app.get('/stream/:id', (req, res) => {
  const video = videoIndex.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(VIDEO_DIR, video.relativePath);
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`));
