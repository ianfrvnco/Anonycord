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

let isMuted = false;
let isDeafened = false;

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
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelay',
      credential: 'openrelay'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelay',
      credential: 'openrelay'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

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
      case 'self-join':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
        break;

      case 'self-leave':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.18);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;

      case 'user-join':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
        break;

      case 'user-leave':
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

function toggleMute() {
  isMuted = !isMuted;
  applyAudioStates();
  playSoundEffect(isMuted ? 'mute' : 'unmute');
}

function toggleDeafen() {
  isDeafened = !isDeafened;
  applyAudioStates();
  playSoundEffect(isDeafened ? 'deafen' : 'undeafen');
}

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

  if (currentRoom) {
    socket.emit('audio-state-change', { isMuted, isDeafened });
  }
  const username = usernameInput.value.trim() || 'Anônimo';
  addUserToList('me', `${username} (Você)`, isMuted, isDeafened);
}

muteBtn.addEventListener('click', toggleMute);
deafenBtn.addEventListener('click', toggleDeafen);

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
  socket.emit('join-room', { roomId, username, isMuted, isDeafened });

  playSoundEffect('self-join');

  joinBtn.disabled = true;
  joinBtn.style.display = 'none';
  leaveBtn.style.display = 'inline-block';
  usernameInput.disabled = true;
  roomInput.disabled = true;

  addUserToList('me', `${username} (Você)`, isMuted, isDeafened);
});

leaveBtn.addEventListener('click', () => {
  leaveRoom();
});

function leaveRoom() {
  if (!currentRoom) return;

  socket.emit('leave-room');

  if (screenStream) {
    stopScreenSharing();
  }

  for (let userId in peers) {
    peers[userId].close();
    delete peers[userId];
  }

  playSoundEffect('self-leave');

  videoGrid.innerHTML = '';
  userList.innerHTML = '';

  currentRoom = null;
  joinBtn.disabled = false;
  joinBtn.innerText = 'Entrar';
  joinBtn.style.display = 'inline-block';
  leaveBtn.style.display = 'none';
  usernameInput.disabled = false;
  roomInput.disabled = false;
}

function addUserToList(userId, name, userIsMuted = false, userIsDeafened = false) {
  let li = document.getElementById(`user-li-${userId}`);
  if (!li) {
    li = document.createElement('li');
    li.id = `user-li-${userId}`;
    userList.appendChild(li);
  }

  li.innerHTML = `
    <span class="user-name-text">${name}</span>
    <div class="user-status-badges">
      ${userIsDeafened ? '<span class="badge-icon badge-deafened" title="Silenciado">🎧</span>' : ''}
      ${userIsMuted && !userIsDeafened ? '<span class="badge-icon badge-muted" title="Mutado">🎤</span>' : ''}
    </div>
  `;
}

function removeUserFromList(userId) {
  const li = document.getElementById(`user-li-${userId}`);
  if (li) li.remove();
}

socket.on('user-connected', ({ userId, username, isMuted: remoteMuted, isDeafened: remoteDeafened }) => {
  playSoundEffect('user-join');
  addUserToList(userId, username, remoteMuted, remoteDeafened);
  createPeerConnection(userId, true);
});

socket.on('existing-users', (users) => {
  users.forEach(({ userId, username, isMuted: remoteMuted, isDeafened: remoteDeafened }) => {
    addUserToList(userId, username, remoteMuted, remoteDeafened);
    createPeerConnection(userId, false);
  });
});

socket.on('user-audio-state-changed', ({ userId, isMuted: remoteMuted, isDeafened: remoteDeafened }) => {
  const li = document.getElementById(`user-li-${userId}`);
  if (li) {
    const nameSpan = li.querySelector('.user-name-text');
    const name = nameSpan ? nameSpan.innerText : 'Anônimo';
    addUserToList(userId, name, remoteMuted, remoteDeafened);
  }
});

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

      // ---> ADICIONE AQUI: Inicia o monitoramento de recepção assim que o quadro remoto for criado
      startReceiverMonitor(userId);
    }

    if (!remoteVideo.srcObject) {
      remoteVideo.srcObject = new MediaStream();
    }

    const stream = remoteVideo.srcObject;
    if (!stream.getTracks().some(t => t.id === event.track.id)) {
      stream.addTrack(event.track);
    }

    remoteVideo.play().catch(e => console.error('Erro na reprodução de mídia remota:', e));

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

      console.log('--- [DEBUG CAPTURA TELA] ---');
      console.log('ID da faixa:', videoTrack.id);
      console.log('Rótulo:', videoTrack.label);
      console.log('Estado da faixa (readyState):', videoTrack.readyState); // Deve ser "live"
      console.log('Ativa/Enabled:', videoTrack.enabled);                   // Deve ser true
      console.log('Mutada/Muted:', videoTrack.muted);                       // Deve ser false
      console.log('Configurações:', videoTrack.getSettings());             // Resolução e FPS
      console.log('----------------------------');

      for (let userId in peers) {
        const pc = peers[userId];
        console.log(`[DEBUG P2P ${userId}] Estado da sinalização:`, pc.signalingState);
        console.log(`[DEBUG P2P ${userId}] Estado da conexão ICE:`, pc.iceConnectionState);

        const senders = pc.getSenders();
        console.log(`[DEBUG P2P ${userId}] Total de Senders ativos:`, senders.length);

        senders.forEach((sender, index) => {
          if (sender.track) {
            console.log(` -> Sender #${index} [${sender.track.kind}]: ID ${sender.track.id}, Estado: ${sender.track.readyState}`);
          } else {
            console.warn(` -> Sender #${index}: Sem faixa vinculada (null)!`);
          }
        });
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

// Diagnóstico de tráfego de saída
function startNetworkMonitor(userId) {
  const pc = peers[userId];
  if (!pc) return;

  const intervalId = setInterval(async () => {
    if (pc.iceConnectionState === 'closed') {
      clearInterval(intervalId);
      return;
    }

    const stats = await pc.getStats();
    stats.forEach(report => {
      // Monitora o envio de vídeo (Transmissor)
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        console.log(`--- [NETWORK STATS ENVIANDO -> ${userId}] ---`);
        console.log(`Pacotes enviados: ${report.packetsSent}`);
        console.log(`Bytes enviados: ${(report.bytesSent / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Quadros codificados (framesEncoded): ${report.framesEncoded}`);
        console.log(`FPS de envio: ${report.framesPerSecond || 0}`);
        console.log(`Resolução enviada: ${report.frameWidth}x${report.frameHeight}`);
        console.log('---------------------------------------------');
      }
    });
  }, 3000); // Exibe no console a cada 3 segundos
}

function startReceiverMonitor(userId) {
  const pc = peers[userId];
  if (!pc) return;

  setInterval(async () => {
    const stats = await pc.getStats();
    stats.forEach(report => {
      // Monitora o recebimento de vídeo (Receptor)
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        console.log(`=== [NETWORK STATS RECEBENDO <- ${userId}] ===`);
        console.log(`Bytes recebidos: ${(report.bytesReceived / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Pacotes recebidos: ${report.packetsReceived}`);
        console.log(`Pacotes perdidos: ${report.packetsLost}`);
        console.log(`Quadros decodificados (framesDecoded): ${report.framesDecoded}`);
        console.log('==============================================');
      }
    });
  }, 3000);
}

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());