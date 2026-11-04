const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Armazena o estado das salas em memória
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { users: new Set(), currentScreenSharer: null };
    }

    // Informa ao novo usuário quem já está na sala para ele iniciar as conexões
    const existingUsers = Array.from(rooms[roomId].users);
    socket.emit('existing-users', existingUsers);
    
    rooms[roomId].users.add(socket.id);
    socket.to(roomId).emit('user-joined', socket.id);

    // Se alguém já estiver compartilhando a tela, desabilita o botão para o recém-chegado
    if (rooms[roomId].currentScreenSharer) {
      socket.emit('screen-lock-update', true);
    }
  });

  // Árbitro de compartilhamento de tela
  socket.on('request-screen', () => {
    const room = rooms[socket.roomId];
    if (room && !room.currentScreenSharer) {
      room.currentScreenSharer = socket.id;
      // Trava o botão para todos na sala e autoriza o solicitante
      io.to(socket.roomId).emit('screen-lock-update', true);
      socket.emit('screen-granted');
    }
  });

  socket.on('stop-screen', () => {
    const room = rooms[socket.roomId];
    if (room && room.currentScreenSharer === socket.id) {
      room.currentScreenSharer = null;
      // Libera o botão para todos
      io.to(socket.roomId).emit('screen-lock-update', false);
    }
  });

  // Repasse de dados WebRTC (P2P Mesh)
  socket.on('offer', payload => io.to(payload.target).emit('offer', payload));
  socket.on('answer', payload => io.to(payload.target).emit('answer', payload));
  socket.on('ice-candidate', payload => io.to(payload.target).emit('ice-candidate', payload));

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      room.users.delete(socket.id);
      socket.to(socket.roomId).emit('user-disconnected', socket.id);
      
      // Se quem caiu estava compartilhando a tela, libera o bloqueio
      if (room.currentScreenSharer === socket.id) {
        room.currentScreenSharer = null;
        io.to(socket.roomId).emit('screen-lock-update', false);
      }
    }
  });
});

server.listen(3000, () => console.log('Servidor árbitro ativo na porta 3000'));