(() => {
  const params = new URLSearchParams(location.search);
  const isHost = params.get('host') === '1';
  const joinRoomId = params.get('room');
  const name = params.get('name') || (isHost ? 'Host' : 'Guest');

  let roomId = null;
  let ignoreEvents = false; // prevent echo loops when applying remote changes

  const socket = io();
  const video = document.getElementById('video');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const seekBar = document.getElementById('seek-bar');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');
  const muteBtn = document.getElementById('mute-btn');
  const volumeBar = document.getElementById('volume-bar');
  const roomLabel = document.getElementById('room-label');
  const copyBtn = document.getElementById('copy-btn');
  const syncStatus = document.getElementById('sync-status');
  const movieSelector = document.getElementById('movie-selector');
  const movieSelect = document.getElementById('movie-select');
  const noMovie = document.getElementById('no-movie');
  const waitingMsg = document.getElementById('waiting-msg');
  const chatLog = document.getElementById('chat-log');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  document.getElementById('viewer-name').textContent = name;

  // ── Room setup ──────────────────────────────────────────────────────────────

  socket.on('connect', () => {
    if (isHost) {
      socket.emit('create-room', { name });
    } else if (joinRoomId) {
      socket.emit('join-room', { roomId: joinRoomId.toUpperCase() });
    }
  });

  socket.on('room-created', ({ roomId: id }) => {
    roomId = id;
    roomLabel.textContent = `Room: ${roomId}`;
    syncStatus.textContent = '✅ Hosting';
    syncStatus.className = 'sync-badge synced';
    movieSelector.classList.remove('hidden');
    noMovie.classList.remove('hidden');
    waitingMsg.textContent = 'Select a movie above to start';
    loadMovieList();
  });

  socket.on('room-joined', ({ roomId: id, movie }) => {
    roomId = id;
    roomLabel.textContent = `Room: ${roomId}`;
    syncStatus.textContent = '⏳ Syncing...';
    if (movie) loadMovie(movie);
    socket.emit('sync-request', { roomId });
  });

  socket.on('error', ({ message }) => {
    alert(`Error: ${message}`);
    window.location.href = '/';
  });

  socket.on('host-left', () => {
    syncStatus.textContent = '❌ Host left';
    syncStatus.className = 'sync-badge error';
    video.pause();
  });

  copyBtn.addEventListener('click', () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId).then(() => {
        copyBtn.textContent = '✅';
        setTimeout(() => copyBtn.textContent = '📋', 1500);
      });
    }
  });

  // ── Movie loading (host) ────────────────────────────────────────────────────

  async function loadMovieList() {
    const res = await fetch('/api/movies');
    const files = await res.json();
    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      movieSelect.appendChild(opt);
    });
  }

  movieSelect.addEventListener('change', () => {
    const file = movieSelect.value;
    if (!file) return;
    socket.emit('select-movie', { roomId, file });
    loadMovie(file);
  });

  socket.on('movie-selected', ({ file }) => {
    loadMovie(file);
  });

  function loadMovie(file) {
    video.src = `/stream/${encodeURIComponent(file)}`;
    video.load();
    noMovie.classList.add('hidden');
    playPauseBtn.disabled = false;
    seekBar.disabled = false;
  }

  // ── Video events → emit to room ─────────────────────────────────────────────

  // Only host controls playback; guest UI reflects state
  if (isHost) {
    video.addEventListener('play', () => {
      if (ignoreEvents) return;
      socket.emit('play', { roomId, time: video.currentTime });
      playPauseBtn.textContent = '⏸';
    });

    video.addEventListener('pause', () => {
      if (ignoreEvents) return;
      socket.emit('pause', { roomId, time: video.currentTime });
      playPauseBtn.textContent = '▶';
    });

    video.addEventListener('seeked', () => {
      if (ignoreEvents) return;
      socket.emit('seek', { roomId, time: video.currentTime });
    });

    playPauseBtn.addEventListener('click', () => {
      video.paused ? video.play() : video.pause();
    });

    // Host responds to sync-state requests
    socket.on('sync-request', ({ guestId, roomId: rid }) => {
      socket.emit('sync-state', {
        roomId: rid,
        guestId,
        time: video.currentTime,
        playing: !video.paused,
      });
    });

    // Host notified a guest joined
    socket.on('guest-joined', () => {
      addChat('System', 'A guest joined the room');
    });

  } else {
    // Guest: controls are disabled; show play/pause mirroring state only
    playPauseBtn.addEventListener('click', () => {
      // Guests can't control playback; clicking requests re-sync
      socket.emit('sync-request', { roomId });
    });
    playPauseBtn.title = 'Host controls playback. Click to re-sync.';
  }

  // ── Incoming sync events → apply to video ───────────────────────────────────

  function applyRemote(fn) {
    ignoreEvents = true;
    fn();
    // Release flag after a short debounce to avoid echoing seeked/play events
    setTimeout(() => { ignoreEvents = false; }, 300);
  }

  socket.on('play', ({ time }) => {
    applyRemote(() => {
      video.currentTime = time;
      video.play().catch(() => {});
      playPauseBtn.textContent = '⏸';
      syncStatus.textContent = '✅ Synced';
      syncStatus.className = 'sync-badge synced';
    });
  });

  socket.on('pause', ({ time }) => {
    applyRemote(() => {
      video.currentTime = time;
      video.pause();
      playPauseBtn.textContent = '▶';
      syncStatus.textContent = '⏸ Paused';
      syncStatus.className = 'sync-badge';
    });
  });

  socket.on('seek', ({ time }) => {
    applyRemote(() => {
      video.currentTime = time;
    });
  });

  socket.on('sync-state', ({ time, playing }) => {
    applyRemote(() => {
      video.currentTime = time;
      if (playing) {
        video.play().catch(() => {});
        playPauseBtn.textContent = '⏸';
      } else {
        video.pause();
        playPauseBtn.textContent = '▶';
      }
      syncStatus.textContent = '✅ Synced';
      syncStatus.className = 'sync-badge synced';
    });
  });

  // ── Video UI updates ────────────────────────────────────────────────────────

  video.addEventListener('timeupdate', () => {
    currentTimeEl.textContent = formatTime(video.currentTime);
    if (video.duration) {
      seekBar.value = (video.currentTime / video.duration) * 100;
    }
  });

  video.addEventListener('loadedmetadata', () => {
    seekBar.max = 100;
    durationEl.textContent = formatTime(video.duration);
  });

  seekBar.addEventListener('input', () => {
    if (video.duration) {
      const t = (seekBar.value / 100) * video.duration;
      video.currentTime = t;
    }
  });

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
  });

  volumeBar.addEventListener('input', () => {
    video.volume = volumeBar.value / 100;
  });

  // ── Chat ─────────────────────────────────────────────────────────────────────

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !roomId) return;
    socket.emit('chat', { roomId, name, text });
    chatInput.value = '';
  }

  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  socket.on('chat', ({ name: sender, text }) => {
    addChat(sender, text);
  });

  function addChat(sender, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<strong>${escHtml(sender)}:</strong> ${escHtml(text)}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
