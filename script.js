const { ipcRenderer } = require('electron');
const socket = io('https://anonycord-server.onrender.com');

const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const shareBtn = document.getElementById('share-btn');
const optionsBtn = document.getElementById('options-btn');
const muteBtn = document.getElementById('mute-btn');
const deafenBtn = document.getElementById('deafen-btn');
const videoGrid = document.getElementById('video-grid');
const userList = document.getElementById('user-list');

// Modais
const screenPickerModal = document.getElementById('screen-picker-modal');
const sourcesGrid = document.getElementById('sources-grid');
const cancelPickerBtn = document.getElementById('cancel-picker-btn');

const optionsModal = document.getElementById('options-modal');
const closeOptionsBtn = document.getElementById('close-options-btn');
const audioInputSelect = document.getElementById('audio-input-select');
const audioOutputSelect = document.getElementById('audio-output-select');
const micMeterFill = document.getElementById('mic-meter-fill');
const shortcutMuteInput = document.getElementById('shortcut-mute-input');
const shortcutDeafenInput = document.getElementById('shortcut-deafen-input');

let localStream = null;
let screenStream = null;
let currentRoom = null;
const peers = {};

// Estados de Áudio
let isMuted = false;
let isDeafened = false;

// Atalhos
let shortcuts = {
  mute: localStorage.getItem('shortcut_mute') || 'Ctrl+M',
  deafen: localStorage.getItem('shortcut_deafen') || 'Ctrl+D'
};

let audioCtx = null;
let analyser = null;
let micSource = null;
let animFrameId = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Sintetizador de Efeitos Sonoros (Web Audio API)
function playSoundEffect(type) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    switch (type) {
      case 'self-join': // Entrada própria (Tom ascendente)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
        break;

      case 'self-leave': // 2. Saída própria da sala (Tom descendente duplo)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.18);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;

      case 'user-join': // Entrada de outro usuário (Bip duplo)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
        break;

      case 'user-leave': // 3. Saída de outro usuário da sala (Tom grave descendente curto)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.setValueAtTime(523.25, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
        break;

      case 'mute':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(550, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;

      case 'unmute':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(550, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;

      case 'deafen':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;

      case 'undeafen':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(550, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
    }
  } catch (err) {
    console.error('Erro ao tocar efeito sonoro:', err);
  }
}

// Inicialização de Áudio Local
async function initLocalAudio(deviceId = null) {
  try {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => track.stop());
    }

    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted && !isDeafened;
    });

    setupMicMeter(localStream);
    return localStream;
  } catch (err) {
    console.error('Aviso: Microfone não encontrado ou negado:', err);
  }
}
initLocalAudio();

// Medidor de Sensibilidade
function setupMicMeter(stream) {
  if (!stream || stream.getAudioTracks().length === 0) return;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (micSource) {
    micSource.disconnect();
  }

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  micSource = audioCtx.createMediaStreamSource(stream);
  micSource.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function updateMeter() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    const percentage = Math.min(100, Math.round((average / 100) * 100));

    if (micMeterFill) {
      micMeterFill.style.width = percentage + '%';
      micMeterFill.style.background = percentage > 85 ? '#ff4444' : '#fcc203';
    }

    animFrameId = requestAnimationFrame(updateMeter);
  }

  if (animFrameId) cancelAnimationFrame(animFrameId);
  updateMeter();
}

// Alternar Mute Microfone
function toggleMute() {
  isMuted = !isMuted;
  applyAudioStates();
  playSoundEffect(isMuted ? 'mute' : 'unmute');
}

// Alternar Silenciar Tudo (Ensurdecer)
function toggleDeafen() {
  isDeafened = !isDeafened;
  applyAudioStates();
  playSoundEffect(isDeafened ? 'deafen' : 'undeafen');
}

// Aplicação dos estados de áudio
function applyAudioStates() {
  const micEnabled = !isMuted && !isDeafened;

  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled;
    });
  }

  const remoteVideos = videoGrid.querySelectorAll('video:not(#local-screen-video)');
  remoteVideos.forEach(video => {
    video.muted = isDeafened;
  });

  if (isMuted) {
    muteBtn.classList.add('btn-danger');
    muteBtn.innerText = '🎤 Desmutar Mic';
  } else {
    muteBtn.classList.remove('btn-danger');
    muteBtn.innerText = '🎤 Mutar Mic';
  }

  if (isDeafened) {
    deafenBtn.classList.add('btn-danger');
    deafenBtn.innerText = '🎧 Desensurdecer';
  } else {
    deafenBtn.classList.remove('btn-danger');
    deafenBtn.innerText = '🎧 Silenciar Tudo';
  }
}

muteBtn.addEventListener('click', toggleMute);
deafenBtn.addEventListener('click', toggleDeafen);

// Gerenciador de Atalhos
function parseKeyEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  
  const keyUpper = e.key.toUpperCase();
  if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(keyUpper)) {
    parts.push(keyUpper);
  }
  return parts.join('+');
}

function setupShortcutInput(inputEl, shortcutKey) {
  inputEl.value = shortcuts[shortcutKey];

  inputEl.addEventListener('focus', () => {
    inputEl.value = 'Pressione o atalho...';
    inputEl.style.borderColor = '#ffe066';
  });

  inputEl.addEventListener('blur', () => {
    inputEl.value = shortcuts[shortcutKey];
    inputEl.style.borderColor = '#fcc203';
  });

  inputEl.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      inputEl.blur();
      return;
    }

    const combo = parseKeyEvent(e);
    if (combo && !['Ctrl', 'Alt', 'Shift'].includes(combo)) {
      shortcuts[shortcutKey] = combo;
      localStorage.setItem(`shortcut_${shortcutKey}`, combo);
      inputEl.value = combo;
      inputEl.blur();
    }
  });
}

setupShortcutInput(shortcutMuteInput, 'mute');
setupShortcutInput(shortcutDeafenInput, 'deafen');

window.addEventListener('keydown', (e) => {
  if (['username-input', 'room-input'].includes(document.activeElement.id)) {
    return;
  }

  const combo = parseKeyEvent(e);

  if (combo === shortcuts.mute) {
    e.preventDefault();
    toggleMute();
  } else if (combo === shortcuts.deafen) {
    e.preventDefault();
    toggleDeafen();
  }
});

// Listagem de Dispositivos de Áudio
async function getAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selectedInput = audioInputSelect.value;
    const selectedOutput = audioOutputSelect.value;

    audioInputSelect.innerHTML = '';
    audioOutputSelect.innerHTML = '';

    let inputCount = 1;
    let outputCount = 1;

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;

      if (device.kind === 'audioinput') {
        option.text = device.label || `Microfone ${inputCount++}`;
        audioInputSelect.appendChild(option);
      } else if (device.kind === 'audiooutput') {
        option.text = device.label || `Alto-falante ${outputCount++}`;
        audioOutputSelect.appendChild(option);
      }
    });

    if (selectedInput) audioInputSelect.value = selectedInput;
    if (selectedOutput) audioOutputSelect.value = selectedOutput;
  } catch (err) {
    console.error('Erro ao listar dispositivos de áudio:', err);
  }
}

optionsBtn.addEventListener('click', async () => {
  await getAudioDevices();
  optionsModal.style.display = 'flex';
});

closeOptionsBtn.addEventListener('click', () => {
  optionsModal.style.display = 'none';
});

audioInputSelect.addEventListener('change', async () => {
  const deviceId = audioInputSelect.value;
  if (!deviceId) return;

  const newStream = await initLocalAudio(deviceId);
  if (newStream) {
    const newAudioTrack = newStream.getAudioTracks()[0];
    for (let userId in peers) {
      const pc = peers[userId];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) {
        sender.replaceTrack(newAudioTrack);
      } else {
        pc.addTrack(newAudioTrack, newStream);
      }
    }
  }
});

audioOutputSelect.addEventListener('change', async () => {
  const deviceId = audioOutputSelect.value;
  if (!deviceId) return;

  const videoElements = videoGrid.querySelectorAll('video');
  videoElements.forEach(async (video) => {
    if (typeof video.setSinkId === 'function') {
      try {
        await video.setSinkId(deviceId);
      } catch (err) {
        console.error('Erro ao definir saída de áudio:', err);
      }
    }
  });
});

navigator.mediaDevices.ondevicechange = () => {
  getAudioDevices();
};

// Modal Seletor de Telas (IPC)
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

// Entrar na Sala
joinBtn.addEventListener('click', async () => {
  const roomId = roomInput.value.trim();
  const username = usernameInput.value.trim() || 'Anônimo';

  if (!roomId) {
    alert('Digite um ID para a sala!');
    return;
  }

  if (!localStream) {
    await initLocalAudio();
  }

  currentRoom = roomId;
  socket.emit('join-room', { roomId, username });

  playSoundEffect('self-join');

  joinBtn.disabled = true;
  joinBtn.style.display = 'none';
  leaveBtn.style.display = 'inline-block';
  usernameInput.disabled = true;
  roomInput.disabled = true;

  addUserToList('me', `${username} (Você)`);
});

// 1. Ação de Sair da Sala
leaveBtn.addEventListener('click', () => {
  leaveRoom();
});

function leaveRoom() {
  if (!currentRoom) return;

  // Notifica o servidor e limpa estados P2P
  socket.emit('leave-room');

  if (screenStream) {
    stopScreenSharing();
  }

  for (let userId in peers) {
    peers[userId].close();
    delete peers[userId];
  }

  // Toca o aviso sonoro de saída própria
  playSoundEffect('self-leave');

  // Limpa elementos visuais
  videoGrid.innerHTML = '';
  userList.innerHTML = '';

  // Restaura o estado dos controles
  currentRoom = null;
  joinBtn.disabled = false;
  joinBtn.innerText = 'Entrar';
  joinBtn.style.display = 'inline-block';
  leaveBtn.style.display = 'none';
  usernameInput.disabled = false;
  roomInput.disabled = false;
}

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

// Eventos do Socket.IO
socket.on('user-connected', ({ userId, username }) => {
  playSoundEffect('user-join');
  addUserToList(userId, username);
  createPeerConnection(userId, true);
});

socket.on('existing-users', (users) => {
  users.forEach(({ userId, username }) => {
    addUserToList(userId, username);
    createPeerConnection(userId, false);
  });
});

// 3. Aviso sonoro e remoção quando outro usuário sai
socket.on('user-disconnected', (userId) => {
  playSoundEffect('user-leave');
  removeUserFromList(userId);
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  const remoteVideo = document.getElementById(`video-${userId}`);
  if (remoteVideo) remoteVideo.remove();
});

socket.on('offer', async ({ senderId, offer }) => {
  const pc = getOrCreatePeerConnection(senderId);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetId: senderId, answer });
  } catch (err) {
    console.error('Erro ao processar oferta WebRTC:', err);
  }
});

socket.on('answer', async ({ senderId, answer }) => {
  const pc = peers[senderId];
  if (pc) {
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

  const pc = new RTCPeerConnection(rtcConfig);
  peers[userId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  if (screenStream) {
    screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
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
      remoteVideo.muted = isDeafened;

      if (audioOutputSelect.value && typeof remoteVideo.setSinkId === 'function') {
        remoteVideo.setSinkId(audioOutputSelect.value).catch(console.error);
      }

      videoGrid.appendChild(remoteVideo);
    }

    // Cria uma MediaStream persistente para o elemento <video> remoto
    if (!remoteVideo.srcObject) {
      remoteVideo.srcObject = new MediaStream();
    }

    // Adiciona a nova faixa (áudio ou vídeo da tela) ao stream existente sem sobrescrevê-lo
    const stream = remoteVideo.srcObject;
    if (!stream.getTracks().some(t => t.id === event.track.id)) {
      stream.addTrack(event.track);
    }

    remoteVideo.play().catch(e => console.error('Erro na reprodução de mídia remota:', e));

    // Remove a faixa do player caso seja encerrada pelo parceiro
    event.track.onended = () => {
      if (remoteVideo.srcObject) {
        remoteVideo.srcObject.removeTrack(event.track);
      }
    };
  };

  pc.onnegotiationneeded = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { targetId: userId, offer });
    } catch (err) {
      console.error('Erro na renegociação WebRTC:', err);
    }
  };

  if (isInitiator) {
    pc.onnegotiationneeded();
  }

  return pc;
}

// Compartilhamento de Tela
shareBtn.addEventListener('click', () => {
  if (!currentRoom) {
    alert('Entre em uma sala primeiro!');
    return;
  }

  if (screenStream) {
    stopScreenSharing();
  } else {
    socket.emit('request-screen');
  }
});

socket.on('screen-granted', async () => {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    shareBtn.innerText = 'Parar Partilha';

    // Prévia local (mutada)
    let localVideo = document.getElementById('local-screen-video');
    if (!localVideo) {
      localVideo = document.createElement('video');
      localVideo.id = 'local-screen-video';
      localVideo.autoplay = true;
      localVideo.playsInline = true;
      localVideo.muted = true;
      localVideo.style.border = '2px solid #fcc203';
      videoGrid.appendChild(localVideo);
    }
    localVideo.srcObject = screenStream;

    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
      for (let userId in peers) {
        const pc = peers[userId];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');

        if (sender) {
          await sender.replaceTrack(videoTrack);
        } else {
          pc.addTrack(videoTrack, screenStream);
        }

        // Força a oferta SDP para que o parceiro remoto atualize os canais de recepção
        if (pc.signalingState === 'stable') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { targetId: userId, offer });
        }
      }

      videoTrack.onended = () => {
        stopScreenSharing();
      };
    }
  } catch (err) {
    console.error('Erro ao capturar tela ou cancelado:', err);
    stopScreenSharing();
  }
});

async function stopScreenSharing() {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  for (let userId in peers) {
    const pc = peers[userId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      pc.removeTrack(sender);

      // Renegocia a remoção da faixa com o parceiro remoto
      if (pc.signalingState === 'stable') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetId: userId, offer });
      }
    }
  }

  const localVideo = document.getElementById('local-screen-video');
  if (localVideo) {
    localVideo.remove();
  }

  shareBtn.innerText = 'Compartilhar Tela';
  socket.emit('stop-screen');
}

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());