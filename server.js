const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MOVIES_DIR = path.join(__dirname, 'movies');

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// List available movies
app.get('/api/movies', (req, res) => {
  const files = fs.readdirSync(MOVIES_DIR).filter(f =>
    ['.mp4', '.webm', '.ogg'].includes(path.extname(f).toLowerCase())
  );
  res.json(files);
});

// Stream video with range request support (required for seeking)
app.get('/stream/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(MOVIES_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(filepath);
  const range = req.headers.range;
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg' };
  const contentType = mimeTypes[ext] || 'video/mp4';

  if (range) {
    const parts = range.replace('bytes=', '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filepath).pipe(res);
  }
});

// Room state tracking
const rooms = new Map();
// rooms[roomId] = { hostId, movie, time, playing }

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('create-room', ({ name }) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    rooms.set(roomId, { hostId: socket.id, movie: null, time: 0, playing: false });
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log(`[room] Created: ${roomId} by ${name}`);
  });

  socket.on('join-room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    socket.join(roomId);
    socket.emit('room-joined', { roomId, movie: room.movie });
    // Notify host that a guest joined, so host can send sync-state
    io.to(room.hostId).emit('guest-joined', { guestId: socket.id, roomId });
    console.log(`[room] ${socket.id} joined ${roomId}`);
  });

  socket.on('select-movie', ({ roomId, file }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.movie = file;
      room.time = 0;
      room.playing = false;
    }
    socket.to(roomId).emit('movie-selected', { file });
  });

  socket.on('play', ({ roomId, time }) => {
    const room = rooms.get(roomId);
    if (room) { room.time = time; room.playing = true; }
    socket.to(roomId).emit('play', { time });
  });

  socket.on('pause', ({ roomId, time }) => {
    const room = rooms.get(roomId);
    if (room) { room.time = time; room.playing = false; }
    socket.to(roomId).emit('pause', { time });
  });

  socket.on('seek', ({ roomId, time }) => {
    const room = rooms.get(roomId);
    if (room) room.time = time;
    socket.to(roomId).emit('seek', { time });
  });

  // Guest requests current state; relay to host
  socket.on('sync-request', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      io.to(room.hostId).emit('sync-request', { guestId: socket.id, roomId });
    }
  });

  // Host responds with state; relay to specific guest
  socket.on('sync-state', ({ roomId, guestId, time, playing }) => {
    io.to(guestId).emit('sync-state', { time, playing });
  });

  // Chat messages
  socket.on('chat', ({ roomId, name, text }) => {
    io.to(roomId).emit('chat', { name, text });
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    // Notify rooms where this was the host
    for (const [roomId, room] of rooms.entries()) {
      if (room.hostId === socket.id) {
        io.to(roomId).emit('host-left');
        rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Watch Party server running at http://localhost:${PORT}`);
  console.log(`Drop .mp4 files into the ./movies/ directory`);
});
