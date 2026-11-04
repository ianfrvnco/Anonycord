const socket = io('http://localhost:3000');
const peers = {};
let localAudioStream;
let screenStream;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const videoGrid = document.getElementById('video-grid');
const shareBtn = document.getElementById('share-btn');

document.getElementById('join-btn').addEventListener('click', async () => {
  const roomId = document.getElementById('room-input').value;
  if (!roomId) return;
  
  // Captura apenas o microfone por padrão para economizar banda no grupo
  localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  socket.emit('join-room', roomId);
  shareBtn.disabled = false; // Habilita o botão localmente para tentar solicitar
});

// Controle da trava da tela imposta pelo servidor
socket.on('screen-lock-update', (isLocked) => {
  // Se a tela foi travada e não fui eu que iniciei, desabilita meu botão
  if (isLocked && !screenStream) {
    shareBtn.disabled = true;
    shareBtn.innerText = 'Alguém está compartilhando';
  } else if (!isLocked) {
    shareBtn.disabled = false;
    shareBtn.innerText = 'Compartilhar Tela';
  }
});

// Solicitando a tela
shareBtn.addEventListener('click', () => {
  if (!screenStream) {
    socket.emit('request-screen');
  } else {
    // Parar de compartilhar
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    socket.emit('stop-screen');
  }
});

// Servidor concedeu exclusividade de tela
socket.on('screen-granted', async () => {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    shareBtn.innerText = 'Parar Compartilhamento';
    
    // Substitui a faixa de vídeo/áudio em todas as conexões P2P ativas
    for (let userId in peers) {
      const sender = peers[userId].getSenders().find(s => s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenStream.getVideoTracks()[0]);
      else peers[userId].addTrack(screenStream.getVideoTracks()[0], screenStream);
    }

    screenStream.getVideoTracks()[0].onended = () => {
      screenStream = null;
      socket.emit('stop-screen');
    };
  } catch (err) {
    socket.emit('stop-screen'); // Se o usuário cancelar no navegador, devolve a trava
  }
});

// Lógica de Malha (Mesh): Conectar com quem já estava na sala
socket.on('existing-users', (users) => {
  users.forEach(userId => createPeerConnection(userId, true));
});

// Lógica de Malha: Conectar com quem acabou de entrar
socket.on('user-joined', (userId) => {
  createPeerConnection(userId, false);
});

async function createPeerConnection(userId, isInitiator) {
  const pc = new RTCPeerConnection(config);
  peers[userId] = pc;

  // Envia meu áudio (e tela, se eu for o dono atual)
  localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));
  if (screenStream) {
    screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
  }

  // Recebe mídia de outros usuários
  const userVideo = document.createElement('video');
  userVideo.id = userId;
  userVideo.autoplay = true;
  
  pc.ontrack = (event) => {
    userVideo.srcObject = event.streams[0];
    if (event.track.kind === 'video') userVideo.classList.add('screen-share');
    videoGrid.append(userVideo);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('ice-candidate', { target: userId, candidate: event.candidate });
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: userId, caller: socket.id, sdp: offer });
  }
}

// Negociação WebRTC padrão
socket.on('offer', async payload => {
  const pc = peers[payload.caller];
  await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { target: payload.caller, caller: socket.id, sdp: answer });
});

socket.on('answer', async payload => {
  await peers[payload.caller].setRemoteDescription(new RTCSessionDescription(payload.sdp));
});

socket.on('ice-candidate', payload => {
  peers[payload.caller]?.addIceCandidate(new RTCIceCandidate(payload.candidate));
});

// Remove o vídeo quando alguém sai
socket.on('user-disconnected', userId => {
  if (peers[userId]) peers[userId].close();
  delete peers[userId];
  const videoObj = document.getElementById(userId);
  if (videoObj) videoObj.remove();
});