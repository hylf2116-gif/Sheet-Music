const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] }
});

const rooms = {};

// Create a new room
app.post('/create-room', (req, res) => {
  const roomId = uuidv4();
  rooms[roomId] = { shapes: [], pdfName: req.body.pdfName };
  res.json({ roomId });
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

  socket.on('clear', (roomId) => {
    if (rooms[roomId]) rooms[roomId].shapes = [];
    socket.to(roomId).emit('clear');
  });
});

server.listen(3001, () => console.log('Server running on port 3001'));