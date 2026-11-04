const { ipcRenderer } = require('electron');
const socket = io('https://anonycord-server.onrender.com');

const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const shareBtn = document.getElementById('share-btn');
const videoGrid = document.getElementById('video-grid');
const userList = document.getElementById('user-list');

// Elementos do Modal de Seleção de Tela
const screenPickerModal = document.getElementById('screen-picker-modal');
const sourcesGrid = document.getElementById('sources-grid');
const cancelPickerBtn = document.getElementById('cancel-picker-btn');

let localStream = null;
let screenStream = null;
let currentRoom = null;
const peers = {};

navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  .then(stream => { localStream = stream; })
  .catch(err => console.error('Aviso: Microfone não encontrado ou negado:', err));

// Lógica de manipulação do Modal de Seleção de Tela (IPC)
ipcRenderer.on('open-screen-picker', (event, sources) => {
  sourcesGrid.innerHTML = '';

  sources.forEach(source => {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `
      <img src="${source.thumbnail}" alt="${source.name}">
      <p>${source.name}</p>
    `;
    card.addEventListener('click', () => {
      screenPickerModal.style.display = 'none';
      ipcRenderer.send('select-screen-source', source.id);
    });
    sourcesGrid.appendChild(card);
  });

  screenPickerModal.style.display = 'flex';
});

cancelPickerBtn.addEventListener('click', () => {
  screenPickerModal.style.display = 'none';
  ipcRenderer.send('select-screen-source', null);
});

// Entrar na sala
joinBtn.addEventListener('click', () => {
  const roomId = roomInput.value.trim();
  const username = usernameInput.value.trim() || 'Anônimo';

  if (!roomId) {
    alert('Digite um ID para a sala!');
    return;
  }

  currentRoom = roomId;
  socket.emit('join-room', { roomId, username });

  joinBtn.disabled = true;
  joinBtn.innerText = 'Conectado';
  usernameInput.disabled = true;
  roomInput.disabled = true;

  addUserToList('me', `${username} (Você)`);
});

function addUserToList(userId, name) {
  if (document.getElementById(`user-li-${userId}`)) return;
  const li = document.createElement('li');
  li.id = `user-li-${userId}`;
  li.innerText = name;
  userList.appendChild(li);
}

function removeUserFromList(userId) {
  const li = document.getElementById(`user-li-${userId}`);
  if (li) li.remove();
}

socket.on('user-connected', ({ userId, username }) => {
  addUserToList(userId, username);
  createPeerConnection(userId, true);
});

socket.on('existing-users', (users) => {
  users.forEach(({ userId, username }) => {
    addUserToList(userId, username);
    createPeerConnection(userId, false);
  });
});

socket.on('user-disconnected', (userId) => {
  removeUserFromList(userId);
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  const remoteVideo = document.getElementById(`video-${userId}`);
  if (remoteVideo) remoteVideo.remove();
});

// Sinalização WebRTC
socket.on('offer', async ({ senderId, offer }) => {
  const pc = getOrCreatePeerConnection(senderId);
  try {
    if (pc.signalingState !== 'stable') {
      await Promise.all([
        pc.setLocalDescription({ type: 'rollback' }),
        pc.setRemoteDescription(new RTCSessionDescription(offer))
      ]);
    } else {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetId: senderId, answer });
  } catch (err) {
    console.error('Erro ao processar oferta WebRTC:', err);
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  const pc = peers[senderId];
  if (pc && pc.signalingState === 'have-local-offer') {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Erro ao aplicar resposta WebRTC:', err);
    }
  }
});

socket.on('ice-candidate', async ({ senderId, candidate }) => {
  const pc = peers[senderId];
  if (pc && candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Erro ao adicionar candidato ICE:', err);
    }
  }
});

function getOrCreatePeerConnection(userId) {
  if (!peers[userId]) {
    createPeerConnection(userId, false);
  }
  return peers[userId];
}

function createPeerConnection(userId, isInitiator) {
  if (peers[userId]) return peers[userId];

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[userId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { targetId: userId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    let remoteVideo = document.getElementById(`video-${userId}`);
    if (!remoteVideo) {
      remoteVideo = document.createElement('video');
      remoteVideo.id = `video-${userId}`;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      videoGrid.appendChild(remoteVideo);
    }
    remoteVideo.srcObject = event.streams[0];
  };

  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetId: userId, offer });
      } catch (err) {
        console.error('Erro ao iniciar negociação:', err);
      }
    };
  }

  return pc;
}

// Compartilhamento de tela
shareBtn.addEventListener('click', () => {
  if (!currentRoom) {
    alert('Entre em uma sala primeiro!');
    return;
  }
  socket.emit('request-screen');
});

socket.on('screen-granted', async () => {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    shareBtn.innerText = 'Parar Partilha';

    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
      for (let userId in peers) {
        const sender = peers[userId].getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        } else {
          peers[userId].addTrack(videoTrack, screenStream);
        }
      }

      videoTrack.onended = () => {
        screenStream = null;
        shareBtn.innerText = 'Compartilhar Tela';
        socket.emit('stop-screen');
      };
    }
  } catch (err) {
    console.error('Erro ao capturar tela:', err);
    socket.emit('stop-screen');
  }
});

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());