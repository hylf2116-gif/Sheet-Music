const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// rooms[id] = { pdfUrl, shapes, hostId, raisedHands: string[] }
const rooms = {};

app.post('/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { shapes: [], pdfUrl: req.body.pdfUrl, hostId: null, raisedHands: [] };
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
  res.json({ pdfUrl: room.pdfUrl });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    currentRoom = roomId;
    const room = rooms[roomId];
    if (!room) return;
    // First socket to join becomes the host.
    if (!room.hostId) room.hostId = socket.id;
    socket.emit('load-shapes', room.shapes);
    socket.emit('room-info', {
      isHost: socket.id === room.hostId,
      raisedHands: room.raisedHands,
    });
  });

  socket.on('new-shape', ({ roomId, shape }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.shapes.push(shape); // shape includes ownerId set by client
    socket.to(roomId).emit('new-shape', shape);
  });

  socket.on('delete-shape', ({ roomId, id }) => {
    const room = rooms[roomId];
    if (!room) return;
    const shape = room.shapes.find(s => s.id === id);
    if (shape) {
      const isHost = socket.id === room.hostId;
      const isOwner = !shape.ownerId || shape.ownerId === socket.id;
      if (!isHost && !isOwner) return; // enforce ownership
      room.shapes = room.shapes.filter(s => s.id !== id);
    }
    // Broadcast regardless (shape may not exist if pixel-erase already removed it).
    socket.to(roomId).emit('delete-shape', id);
  });

  socket.on('undo', (roomId) => {
    if (!rooms[roomId] || rooms[roomId].shapes.length === 0) return;
    rooms[roomId].shapes.pop();
    socket.to(roomId).emit('undo');
  });

  socket.on('clear', (roomId) => {
    if (rooms[roomId]) rooms[roomId].shapes = [];
    socket.to(roomId).emit('clear');
  });

  socket.on('update-shape', ({ roomId, id, changes }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.shapes = room.shapes.map(s => s.id === id ? { ...s, ...changes } : s);
    socket.to(roomId).emit('update-shape', { id, changes });
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
