const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Estrutura: rooms[roomId][socketId] = { userId, username, isMuted, isDeafened }
const rooms = {};

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId, username, isMuted = false, isDeafened = false }) => {
    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {};
    }

    const userObj = { 
      userId: socket.id, 
      username: username || 'Anônimo',
      isMuted,
      isDeafened
    };

    rooms[roomId][socket.id] = userObj;

    // Notifica os participantes já conectados sobre o novo usuário com seu estado de áudio
    socket.to(roomId).emit('user-connected', userObj);

    // Envia a lista dos participantes atuais e seus estados de áudio
    const existingUsers = Object.values(rooms[roomId]).filter(u => u.userId !== socket.id);
    socket.emit('existing-users', existingUsers);
  });

  // Evento de alteração de estado de áudio (Mute / Deafen)
  socket.on('audio-state-change', ({ isMuted, isDeafened }) => {
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
      rooms[currentRoom][socket.id].isMuted = isMuted;
      rooms[currentRoom][socket.id].isDeafened = isDeafened;

      socket.to(currentRoom).emit('user-audio-state-changed', {
        userId: socket.id,
        isMuted,
        isDeafened
      });
    }
  });

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