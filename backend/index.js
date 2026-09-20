const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
      // Reset session-specific state on load
      for (const id of Object.keys(data)) {
        data[id].hostId = null;
        data[id].raisedHands = [];
        if (data[id].currentPage === undefined) data[id].currentPage = 0;
      }
      return data;
    }
  } catch (e) {
    console.error('Failed to load rooms:', e);
  }
  return {};
}

function saveRooms() {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
  } catch (e) {
    console.error('Failed to save rooms:', e);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] }
});

// rooms[id] = { pdfUrl, shapes, currentPage, hostId, raisedHands }
const rooms = loadRooms();

app.post('/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { shapes: [], pdfUrl: req.body.pdfUrl, currentPage: 0, hostId: null, raisedHands: [] };
  saveRooms();
  res.json({ roomId });
});

app.post('/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.filename });
});

app.get('/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ pdfUrl: room.pdfUrl, currentPage: room.currentPage ?? 0 });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    currentRoom = roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.hostId) room.hostId = socket.id;
    socket.emit('load-shapes', room.shapes);
    socket.emit('room-info', {
      isHost: socket.id === room.hostId,
      raisedHands: room.raisedHands,
      currentPage: room.currentPage ?? 0,
    });
  });

  socket.on('new-shape', ({ roomId, shape }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.shapes.push(shape);
    saveRooms();
    socket.to(roomId).emit('new-shape', shape);
  });

  socket.on('delete-shape', ({ roomId, id }) => {
    const room = rooms[roomId];
    if (!room) return;
    const shape = room.shapes.find(s => s.id === id);
    if (shape) {
      const isHost = socket.id === room.hostId;
      const isOwner = !shape.ownerId || shape.ownerId === socket.id;
      if (!isHost && !isOwner) return;
      room.shapes = room.shapes.filter(s => s.id !== id);
      saveRooms();
    }
    // Broadcast regardless (shape may not exist if pixel-erase already removed it).
    socket.to(roomId).emit('delete-shape', id);
  });

  socket.on('undo', (roomId) => {
    if (!rooms[roomId] || rooms[roomId].shapes.length === 0) return;
    rooms[roomId].shapes.pop();
    saveRooms();
    socket.to(roomId).emit('undo');
  });

  socket.on('clear', (roomId) => {
    if (rooms[roomId]) {
      rooms[roomId].shapes = [];
      saveRooms();
    }
    socket.to(roomId).emit('clear');
  });

  socket.on('update-shape', ({ roomId, id, changes }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.shapes = room.shapes.map(s => s.id === id ? { ...s, ...changes } : s);
    saveRooms();
    socket.to(roomId).emit('update-shape', { id, changes });
  });

  socket.on('change-page', ({ roomId, page }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.currentPage = page;
    saveRooms();
    socket.to(roomId).emit('page-changed', page);
  });

  // Laser pointer — no storage, pure broadcast.
  socket.on('laser-move', ({ roomId, x, y, page }) => {
    socket.to(roomId).emit('laser-move', { socketId: socket.id, x, y, page });
  });
  socket.on('laser-stop', (roomId) => {
    socket.to(roomId).emit('laser-stop', { socketId: socket.id });
  });

  // Raise / lower hand — broadcast to everyone in room including sender.
  socket.on('raise-hand', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.raisedHands.includes(socket.id)) room.raisedHands.push(socket.id);
    io.to(roomId).emit('raise-hand', { socketId: socket.id });
  });
  socket.on('lower-hand', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.raisedHands = room.raisedHands.filter(id => id !== socket.id);
    io.to(roomId).emit('lower-hand', { socketId: socket.id });
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].raisedHands = rooms[currentRoom].raisedHands.filter(id => id !== socket.id);
      socket.to(currentRoom).emit('laser-stop', { socketId: socket.id });
      socket.to(currentRoom).emit('lower-hand', { socketId: socket.id });
    }
  });
});

server.listen(3001, () => console.log('Server running on port 3001'));
