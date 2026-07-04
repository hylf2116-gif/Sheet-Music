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

const rooms = {};

// Create a new room
app.post('/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { shapes: [], pdfUrl: req.body.pdfUrl };
  res.json({ roomId });
});

// Upload a PDF
app.post('/upload', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.filename });
});

// Get room info
app.get('/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    if (rooms[roomId]) {
      socket.emit('load-shapes', rooms[roomId].shapes);
    }
  });

  socket.on('new-shape', ({ roomId, shape }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].shapes.push(shape);
    socket.to(roomId).emit('new-shape', shape);
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
});

server.listen(3001, () => console.log('Server running on port 3001'));