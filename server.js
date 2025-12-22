import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { ExpressPeerServer } from "peer";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import ipaddr from "ipaddr.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const http = createServer(app);
const io = new Server(http, { pingTimeout: 30000 });

// PeerJS server
const peerServer = ExpressPeerServer(http, { debug: false, path: '/' });
app.use('/peerjs', peerServer);

app.use(helmet());
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({
  windowMs: 15 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests"
});
app.use(apiLimiter);

const ipMeta = new Map();
const BAN_MS = 10 * 60 * 1000;
const CONNECT_LIMIT = 12;
const CONNECT_WINDOW = 60 * 1000;

function now() { return Date.now(); }

function getIP(socket) {
  const xff = socket.handshake.headers["x-forwarded-for"];
  let ip = socket.handshake.address;
  if (xff) ip = xff.split(",")[0].trim();
  try { if (ip && ipaddr.isValid(ip) && ip.includes("::ffff:")) ip = ip.split("::ffff:")[1]; } catch (e) {}
  return ip || "unknown";
}

function registerAttempt(ip) {
  const t = now();
  let meta = ipMeta.get(ip);
  if (!meta) { meta = { attempts: [], bannedUntil: 0 }; ipMeta.set(ip, meta); }

  meta.attempts = meta.attempts.filter(ts => t - ts < CONNECT_WINDOW);
  meta.attempts.push(t);

  if (meta.bannedUntil && meta.bannedUntil <= t) {
    meta.bannedUntil = 0;
    meta.attempts = [];
  }

  if (meta.bannedUntil && meta.bannedUntil > t) return { allowed: false, reason: 'banned' };
  if (meta.attempts.length > CONNECT_LIMIT) {
    meta.bannedUntil = t + BAN_MS;
    return { allowed: false, reason: 'too_many' };
  }

  return { allowed: true };
}

setInterval(() => {
  const t = now();
  for (const [ip, meta] of ipMeta.entries()) {
    if ((!meta.attempts || meta.attempts.length === 0) && (!meta.bannedUntil || meta.bannedUntil < t))
      ipMeta.delete(ip);
  }
}, 60 * 1000);

function createBucket(capacity = 8, refill = 4, interval = 1000) {
  return {
    tokens: capacity,
    capacity,
    refill,
    interval,
    last: now(),
    consume(n = 1) {
      const t = now();
      const elapsed = Math.floor((t - this.last) / this.interval);
      if (elapsed > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refill);
        this.last = t;
      }
      if (this.tokens >= n) {
        this.tokens -= n;
        return true;
      }
      return false;
    }
  };
}

const waitingQueue = [];

io.use((socket, next) => {
  const ip = getIP(socket);
  const ok = registerAttempt(ip);
  socket.data.ip = ip;
  if (!ok.allowed) {
    const err = new Error('Connection rejected'); 
    err.data = ok; 
    return next(err);
  }
  next();
});

io.on("connection", (socket) => {
  socket.data.bucket = createBucket();
  socket.data.username = null;
  socket.data.school = null;
  socket.partner = null;

  socket.on("join", ({ username, school } = {}) => {
    if (typeof username !== "string" || username.length > 50) return socket.emit("errorMsg", "Invalid username");
    if (typeof school !== "string" || school.length > 100) return socket.emit("errorMsg", "Invalid school");

    socket.data.username = username.trim();
    socket.data.school = school.trim();

    autoSearch(socket);
  });

  socket.on("message", (text) => {
    if (!socket.data.bucket.consume(1)) {
      socket.emit("warning", "You are sending messages too quickly");
      return;
    }
    if (typeof text !== "string" || text.length > 1000) return;
    const clean = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (socket.partner) socket.partner.emit("message", { from: socket.data.username, text: clean });
    else socket.emit("errorMsg", "No partner connected");
  });

  socket.on("typing", () => {
    if (socket.partner) socket.partner.emit("typing", socket.data.username);
  });

  socket.on("ping_req", (ts) => {
    if (socket.partner) socket.partner.emit("ping_req", { fromId: socket.id, ts });
  });
  socket.on("ping_res", ({ toId, ts }) => {
    const dest = io.sockets.sockets.get(toId);
    if (dest) dest.emit("ping_res", { ts, fromId: socket.id });
  });

  socket.on("stop", () => {
    disconnectPartner(socket);
    removeFromQueue(socket);
    socket.emit("stopped");
  });

  socket.on("disconnect", () => {
    disconnectPartner(socket);
    removeFromQueue(socket);
  });
});


function autoSearch(socket) {
  if (socket.partner) return;

  while (waitingQueue.length > 0) {
    const potentialPartner = waitingQueue.shift();
    if (!potentialPartner.connected) continue;
    if (potentialPartner.id === socket.id) continue;

    socket.partner = potentialPartner;
    potentialPartner.partner = socket;

    socket.emit("paired", {
      username: potentialPartner.data.username,
      school: potentialPartner.data.school,
      id: potentialPartner.id
    });
    potentialPartner.emit("paired", {
      username: socket.data.username,
      school: socket.data.school,
      id: socket.id
    });
    return;
  }

  waitingQueue.push(socket);
  socket.emit("waiting");
}

function disconnectPartner(socket) {
  if (socket.partner) {
    const partner = socket.partner;
    socket.partner = null;
    partner.partner = null;

    partner.emit("partner_left");
    autoSearch(partner);
  }
}

function removeFromQueue(socket) {
  const index = waitingQueue.indexOf(socket);
  if (index !== -1) waitingQueue.splice(index, 1);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`✅ Rosalia001 Random Chatroom running on http://localhost:${PORT}`));
