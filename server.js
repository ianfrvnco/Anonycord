const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = {};

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId, username }) => {
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    const userObj = { userId: socket.id, username: username || 'Anônimo' };

    socket.to(roomId).emit('user-connected', userObj);

    const existingUsers = Object.entries(rooms[roomId]).map(([id, name]) => ({
      userId: id,
      username: name
    }));
    socket.emit('existing-users', existingUsers);

    rooms[roomId][socket.id] = userObj.username;
  });

  // Manipulador para saída voluntária da sala
  socket.on('leave-room', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom][socket.id];
      socket.to(currentRoom).emit('user-disconnected', socket.id);
      socket.leave(currentRoom);
      
      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
      currentRoom = null;
    }
  });

  socket.on('offer', ({ targetId, offer }) => {
    io.to(targetId).emit('offer', { senderId: socket.id, offer });
  });

  socket.on('answer', ({ targetId, answer }) => {
    io.to(targetId).emit('answer', { senderId: socket.id, answer });
  });

  socket.on('ice-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('ice-candidate', { senderId: socket.id, candidate });
  });

  socket.on('request-screen', () => {
    io.to(socket.id).emit('screen-granted');
  });

  socket.on('stop-screen', () => {
    if (currentRoom) {
      socket.to(currentRoom).emit('screen-stopped');
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom][socket.id];
      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      } else {
        socket.to(currentRoom).emit('user-disconnected', socket.id);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor árbitro ativo na porta ${PORT}`);
});