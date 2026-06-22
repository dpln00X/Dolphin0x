require('dotenv').config();

const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_api_key_here') {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

let serial = null;
let serialParser = null;
let serialMessages = [];
let serialStatus = {
  connected: false,
  port: process.env.SERIAL_PORT || '',
  baud: Number(process.env.SERIAL_BAUD || 9600),
  error: '',
};

function rememberSerialMessage(message) {
  const item = { time: new Date().toISOString(), message: String(message) };
  serialMessages.push(item);
  if (serialMessages.length > 50) serialMessages.shift();
}

function connectSerial(portPath = serialStatus.port, baudRate = serialStatus.baud) {
  if (!portPath) {
    serialStatus = { ...serialStatus, connected: false, error: 'No serial port configured.' };
    return false;
  }

  try {
    if (serial && serial.isOpen) serial.close();

    serial = new SerialPort({ path: portPath, baudRate: Number(baudRate), autoOpen: false });
    serialParser = serial.pipe(new ReadlineParser({ delimiter: '\n' }));

    serial.on('open', () => {
      serialStatus = { connected: true, port: portPath, baud: Number(baudRate), error: '' };
      rememberSerialMessage(`Connected to ${portPath} at ${baudRate} baud.`);
    });

    serial.on('error', (err) => {
      serialStatus = { ...serialStatus, connected: false, error: err.message };
      rememberSerialMessage(`Serial error: ${err.message}`);
    });

    serial.on('close', () => {
      serialStatus = { ...serialStatus, connected: false };
      rememberSerialMessage('Serial port closed.');
    });

    serialParser.on('data', (line) => {
      rememberSerialMessage(line.trim());
    });

    serial.open((err) => {
      if (err) {
        serialStatus = { connected: false, port: portPath, baud: Number(baudRate), error: err.message };
        rememberSerialMessage(`Failed to open serial port: ${err.message}`);
      }
    });

    serialStatus = { connected: false, port: portPath, baud: Number(baudRate), error: 'Connecting...' };
    return true;
  } catch (err) {
    serialStatus = { connected: false, port: portPath, baud: Number(baudRate), error: err.message };
    rememberSerialMessage(`Serial exception: ${err.message}`);
    return false;
  }
}

if (process.env.SERIAL_PORT) {
  connectSerial(process.env.SERIAL_PORT, Number(process.env.SERIAL_BAUD || 9600));
}

function safeFallbackAnswer(userText) {
  return `I can run, listen, and speak now, but real AI answers need an OPENAI_API_KEY in the .env file. You said: "${userText}". Add your API key, restart the server, and I will answer with the configured AI model.`;
}

function buildSystemPrompt() {
  return `You are Ava, a friendly, accurate voice AI assistant. Give correct, practical answers. If you are unsure, say so and explain how to verify. Do not invent facts. Keep answers clear enough to be spoken aloud. You can also help the user control a microcontroller when they ask, but never claim hardware action succeeded unless the system reports it.`;
}

app.post('/api/chat', async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (!latestUserMessage.trim()) {
    return res.status(400).json({ error: 'Please send a message.' });
  }

  const microContext = serialStatus.connected
    ? `Microcontroller is connected on ${serialStatus.port}. Recent messages: ${serialMessages.slice(-5).map((x) => x.message).join(' | ') || 'none'}.`
    : `Microcontroller is not connected. Serial status: ${serialStatus.error || 'not configured'}.`;

  if (!openai) {
    return res.json({
      answer: safeFallbackAnswer(latestUserMessage),
      aiEnabled: false,
      microcontroller: serialStatus,
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'system', content: microContext },
        ...messages.slice(-12),
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || 'I did not receive a valid answer from the AI model.';
    res.json({ answer, aiEnabled: true, microcontroller: serialStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'AI request failed.',
      detail: err.message,
      answer: 'I had trouble contacting the AI service. Please check your API key, model name, network connection, and server logs.',
    });
  }
});

app.get('/api/serial/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ ports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/serial/status', (req, res) => {
  res.json({ status: serialStatus, messages: serialMessages.slice(-20) });
});

app.post('/api/serial/connect', (req, res) => {
  const port = req.body.port || serialStatus.port;
  const baud = Number(req.body.baud || serialStatus.baud || 9600);
  connectSerial(port, baud);
  res.json({ status: serialStatus });
});

app.post('/api/serial/send', (req, res) => {
  const command = String(req.body.command || '').trim();
  if (!command) return res.status(400).json({ error: 'Command is required.' });
  if (!serial || !serial.isOpen) return res.status(400).json({ error: 'Serial port is not connected.', status: serialStatus });

  serial.write(`${command}\n`, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    rememberSerialMessage(`Sent: ${command}`);
    res.json({ ok: true, command, status: serialStatus });
  });
});

app.listen(PORT, () => {
  console.log(`AI voice chatbot running at http://localhost:${PORT}`);
  console.log(openai ? `AI enabled with model ${AI_MODEL}` : 'AI fallback mode: add OPENAI_API_KEY to .env for real AI answers.');
});

