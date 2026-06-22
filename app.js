const chatLog = document.getElementById('chatLog');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const talkBtn = document.getElementById('talkBtn');
const stopTalkBtn = document.getElementById('stopTalkBtn');
const muteBtn = document.getElementById('muteBtn');
const voiceSelect = document.getElementById('voiceSelect');
const rateRange = document.getElementById('rateRange');
const statusEl = document.getElementById('status');
const serialStatusEl = document.getElementById('serialStatus');
const serialLog = document.getElementById('serialLog');
const serialPort = document.getElementById('serialPort');
const serialBaud = document.getElementById('serialBaud');
const serialCommand = document.getElementById('serialCommand');
const connectSerialBtn = document.getElementById('connectSerialBtn');
const refreshSerialBtn = document.getElementById('refreshSerialBtn');
const sendSerialBtn = document.getElementById('sendSerialBtn');

let messages = [];
let muted = false;
let recognition = null;
let listening = false;
let voices = [];

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(text, mode = '') {
  statusEl.textContent = text;
  statusEl.className = `status-pill ${mode}`;
}

function loadVoices() {
  voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  voices.forEach((voice, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' — default' : ''}`;
    voiceSelect.appendChild(option);
  });
}

function speak(text) {
  if (muted || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const selected = voices[Number(voiceSelect.value)];
  if (selected) utterance.voice = selected;
  utterance.rate = Number(rateRange.value || 1);
  utterance.pitch = 1.05;
  speechSynthesis.speak(utterance);
}

async function sendMessage(textFromVoice = '') {
  const text = (textFromVoice || messageInput.value).trim();
  if (!text) return;

  messageInput.value = '';
  addMessage('user', text);
  messages.push({ role: 'user', content: text });
  sendBtn.disabled = true;
  setStatus('Thinking...', 'badge-warn');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Chat request failed');

    const answer = data.answer || 'No answer returned.';
    addMessage('assistant', answer);
    messages.push({ role: 'assistant', content: answer });
    speak(answer);
    setStatus(data.aiEnabled ? 'AI online' : 'Fallback mode: add API key', data.aiEnabled ? 'badge-ok' : 'badge-warn');
    updateSerialStatus(data.microcontroller);
  } catch (err) {
    const errorText = `Error: ${err.message}`;
    addMessage('assistant', errorText);
    speak('I had an error. Please check the server console.');
    setStatus('Error', 'badge-warn');
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    talkBtn.disabled = true;
    talkBtn.textContent = 'Mic not supported';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    talkBtn.textContent = '🎙️ Listening...';
    setStatus('Listening...', 'badge-ok');
  };

  recognition.onend = () => {
    listening = false;
    talkBtn.textContent = '🎙️ Start Talking';
    if (statusEl.textContent === 'Listening...') setStatus('Ready');
  };

  recognition.onerror = (event) => {
    addMessage('assistant', `Microphone error: ${event.error}. Make sure microphone permission is allowed.`);
    setStatus('Mic error', 'badge-warn');
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join(' ');
    sendMessage(transcript);
  };
}

function updateSerialStatus(status) {
  if (!status) return;
  serialStatusEl.innerHTML = status.connected
    ? `<span class="badge-ok">Connected</span> to ${status.port} at ${status.baud} baud.`
    : `<span class="badge-warn">Not connected</span>. ${status.error || 'No serial port configured.'}`;
  if (status.port) serialPort.value = status.port;
  if (status.baud) serialBaud.value = status.baud;
}

async function refreshSerial() {
  try {
    const res = await fetch('/api/serial/status');
    const data = await res.json();
    updateSerialStatus(data.status);
    serialLog.textContent = (data.messages || []).map((m) => `[${m.time}] ${m.message}`).join('\n');
  } catch (err) {
    serialStatusEl.textContent = `Serial status failed: ${err.message}`;
  }
}

async function connectSerial() {
  const res = await fetch('/api/serial/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: serialPort.value.trim(), baud: Number(serialBaud.value || 9600) }),
  });
  const data = await res.json();
  updateSerialStatus(data.status);
  setTimeout(refreshSerial, 800);
}

async function sendSerialCommand() {
  const command = serialCommand.value.trim();
  if (!command) return;
  const res = await fetch('/api/serial/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  const data = await res.json();
  if (!res.ok) {
    addMessage('assistant', `Microcontroller command failed: ${data.error}`);
    speak(`Microcontroller command failed. ${data.error}`);
  } else {
    addMessage('assistant', `Sent command to microcontroller: ${data.command}`);
  }
  serialCommand.value = '';
  refreshSerial();
}

sendBtn.addEventListener('click', () => sendMessage());
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

talkBtn.addEventListener('click', () => {
  if (!recognition || listening) return;
  recognition.start();
});

stopTalkBtn.addEventListener('click', () => {
  if (recognition && listening) recognition.stop();
});

muteBtn.addEventListener('click', () => {
  muted = !muted;
  if (muted) speechSynthesis.cancel();
  muteBtn.textContent = muted ? '🔇 Voice Off' : '🔊 Voice On';
});

connectSerialBtn.addEventListener('click', connectSerial);
refreshSerialBtn.addEventListener('click', refreshSerial);
sendSerialBtn.addEventListener('click', sendSerialCommand);
serialCommand.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendSerialCommand();
});

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
setupSpeechRecognition();
refreshSerial();
setInterval(refreshSerial, 5000);
setStatus('Ready');
addMessage('assistant', 'Hi, I am Ava. Type a message or press Start Talking. If you add your AI API key, I will give real model-powered answers and speak them aloud.');

