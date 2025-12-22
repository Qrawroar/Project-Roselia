const socket = io();

const userForm = document.getElementById('userForm');
const startBtn = document.getElementById('startBtn');
const usernameInput = document.getElementById('username');
const schoolInput = document.getElementById('school');

const loading = document.getElementById('loading');
const chatUI = document.getElementById('chatUI');

const youName = document.getElementById('youName');
const youSchool = document.getElementById('youSchool');
const partnerInfo = document.getElementById('partnerInfo');

const chatBox = document.getElementById('chatBox');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('send');

const stopBtn = document.getElementById('stop');
const pingEl = document.getElementById('ping');

const chime = document.getElementById('chime');
const byeSound = document.getElementById('byeSound');

const typingIndicator = document.getElementById('typingIndicator');
const typingNameEl = document.getElementById('typingName');

let paired = false;
let pingTimer = null;
let typingTimeout = null;
let typingTimer = null;
let storedUsername = '';
let storedSchool = '';

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function checkForm() {
  startBtn.disabled = !(usernameInput.value.trim() && schoolInput.value.trim());
}
usernameInput.addEventListener('input', checkForm);
schoolInput.addEventListener('input', checkForm);

startBtn.onclick = () => {
  storedUsername = usernameInput.value.trim();
  storedSchool = schoolInput.value.trim();
  youName.textContent = storedUsername;
  youSchool.textContent = storedSchool;

  hide(userForm);
  show(loading);
  addSystem('🔍 Searching for a partner...');

  socket.emit('join', { username: storedUsername, school: storedSchool });
};

sendBtn.onclick = sendMessage;
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

msgInput.addEventListener('input', () => {
  if (!paired) return;
  socket.emit('typing');

  // throttle typing events
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {}, 1000);
});

stopBtn.onclick = () => {
  socket.emit('stop');
  chatBox.innerHTML = '';
  addSystem('⛔ You stopped searching.');
  hide(chatUI);
  show(userForm);
  stopPing();
};

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  if (!paired) { alert('Cannot send — searching for a partner.'); return; }

  socket.emit('message', text);
  addYou(text);
  msgInput.value = '';
}

function addYou(text) {
  const msg = document.createElement('div');
  msg.className = 'msg you';
  msg.textContent = 'You: ' + text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addPartner(name, text) {
  hide(typingIndicator);
  const msg = document.createElement('div');
  msg.className = 'msg partner';
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;

  let i = 0;
  const interval = setInterval(() => {
    msg.textContent = name + ': ' + text.substring(0, i);
    i++;
    chatBox.scrollTop = chatBox.scrollHeight;
    if (i > text.length) clearInterval(interval);
  }, 40);
}

function addSystem(text) {
  const msg = document.createElement('div');
  msg.className = 'system';
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showTyping(name) {
  typingNameEl.textContent = name;
  show(typingIndicator);
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => hide(typingIndicator), 2000);
}

socket.on('waiting', () => {
  show(loading);
  hide(chatUI);
  addSystem('🔍 Waiting for a partner...');
  pingEl.textContent = 'Ping: —';
  stopPing();
});

socket.on('paired', partner => {
  try { chime.play().catch(() => {}); } catch (e) {}
  hide(loading);
  show(chatUI);
  partnerInfo.textContent = `Paired with ${partner.username} (${partner.school})`;
  addSystem(`✅ Paired with ${partner.username} from ${partner.school}`);
  paired = true;
  startPing();
});

socket.on('message', m => {
  addPartner(m.from, m.text);
  if (!chatUI.classList.contains('hidden')) {
    try { chime.play().catch(() => {}); } catch (e) {}
  }
});

socket.on('typing', name => showTyping(name));

socket.on('partner_left', () => {
  addSystem('⚠️ Your partner has disconnected.');
  partnerInfo.textContent = 'Partner disconnected';
  paired = false;
  stopPing();
  pingEl.textContent = 'Ping: —';
  try { byeSound.play().catch(() => {}); } catch (e) {}

  show(loading);
  hide(chatUI);
  addSystem('🔍 Searching for a new partner...');
  socket.emit('join', { username: storedUsername, school: storedSchool });
});

socket.on('warning', w => addSystem('⚠️ ' + w));
socket.on('banned', d => { addSystem('⛔ Banned for ' + d.seconds + 's'); socket.disconnect(); });

function startPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (!paired) return;
    const ts = Date.now();
    socket.emit('ping_req', ts);

    const timeout = setTimeout(() => { pingEl.textContent = 'Ping: --'; }, 4000);
    socket.once('ping_res', ({ ts: ret }) => {
      clearTimeout(timeout);
      const rtt = Date.now() - ret;
      pingEl.textContent = 'Ping: ' + rtt + 'ms';
      pingEl.style.color = rtt < 100 ? '#9be564' : rtt < 300 ? '#f0c94a' : '#ff7b7b';
    });
  }, 2000);
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}
