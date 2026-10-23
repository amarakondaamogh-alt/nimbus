const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');

// ---------- persistence ----------
let db = { users: {}, servers: {}, messages: {}, friends: {}, requests: {}, dms: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db), () => {}), 400);
}
const id = () => crypto.randomBytes(6).toString('hex');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

// ---------- http (static) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- realtime ----------
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });
const online = new Map(); // userId -> Set(ws)
const voice = new Map(); // roomId -> Set(userId)

const pub = u => u && ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar || null, status: u.status || 'online', bio: u.bio || '', online: online.has(u.id) && u.status !== 'invisible', custom: u.custom || '' });
const send = (ws, t, d) => ws.readyState === 1 && ws.send(JSON.stringify({ t, d }));
const sendUser = (uid, t, d) => (online.get(uid) || []).forEach(ws => send(ws, t, d));
const serversOf = uid => Object.values(db.servers).filter(s => s.members.includes(uid));
const friendsOf = uid => db.friends[uid] || (db.friends[uid] = []);
const dmKey = (a, b) => 'dm:' + [a, b].sort().join(':');
const peersOf = uid => {
  const set = new Set([uid, ...friendsOf(uid)]);
  serversOf(uid).forEach(s => s.members.forEach(m => set.add(m)));
  (db.dms[uid] || []).forEach(m => set.add(m));
  return set;
};
function broadcastPresence(uid) {
  const u = db.users[uid];
  peersOf(uid).forEach(p => sendUser(p, 'user', pub(u)));
}
function serverView(s) {
  return { id: s.id, name: s.name, color: s.color, icon: s.icon || null, owner: s.owner, channels: s.channels, members: s.members, invite: s.invite, roles: s.roles || {}, topic: s.topic || '' };
}
function usersFor(uid) {
  const set = peersOf(uid);
  return [...set].map(i => pub(db.users[i])).filter(Boolean);
}
function sendInit(ws) {
  const uid = ws.uid;
  send(ws, 'init', {
    me: { ...pub(db.users[uid]) },
    servers: serversOf(uid).map(serverView),
    users: usersFor(uid),
    friends: friendsOf(uid),
    requests: db.requests[uid] || [],
    dms: db.dms[uid] || [],
    voice: Object.fromEntries([...voice].map(([k, v]) => [k, [...v]])),
  });
}
const mkChannels = () => [
  { id: id(), name: 'general', type: 'text' },
  { id: id(), name: 'random', type: 'text' },
  { id: id(), name: 'Lounge', type: 'voice' },
  { id: id(), name: 'Gaming', type: 'voice' },
];
function canAccessChannel(uid, ch) {
  if (ch.startsWith('dm:')) return ch.split(':').slice(1).includes(uid);
  return serversOf(uid).some(s => s.channels.some(c => c.id === ch));
}
function channelAudience(ch) {
  if (ch.startsWith('dm:')) return ch.split(':').slice(1);
  const s = Object.values(db.servers).find(s => s.channels.some(c => c.id === ch));
  return s ? s.members : [];
}
const COLORS = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#3ba7c9', '#f0883e', '#9b59b6'];
const rnd = a => a[Math.floor(Math.random() * a.length)];

function leaveVoice(uid) {
  for (const [room, set] of voice) {
    if (set.delete(uid)) {
      if (!set.size) voice.delete(room);
      channelAudience(room).forEach(m => sendUser(m, 'voice', { room, users: [...(voice.get(room) || [])] }));
    }
  }
}

const handlers = {
  register(ws, d) {
    const name = String(d.name || '').trim().slice(0, 24);
    if (name.length < 2) return send(ws, 'authError', 'Username must be at least 2 characters.');
    if (String(d.pass || '').length < 4) return send(ws, 'authError', 'Password must be at least 4 characters.');
    if (Object.values(db.users).some(u => u.name.toLowerCase() === name.toLowerCase())) return send(ws, 'authError', 'That username is taken.');
    const salt = crypto.randomBytes(8).toString('hex');
    const u = { id: id(), name, salt, pass: hash(d.pass, salt), color: rnd(COLORS), token: crypto.randomBytes(24).toString('hex'), status: 'online' };
    db.users[u.id] = u;
    // everyone starts in a public Welcome server
    let hub = db.servers.hub;
    if (!hub) hub = db.servers.hub = { id: 'hub', name: 'Nimbus HQ', color: '#5865f2', owner: u.id, members: [], channels: mkChannels(), invite: 'HQ', roles: {}, topic: 'The official hangout' };
    hub.members.push(u.id);
    save();
    auth(ws, u);
  },
  login(ws, d) {
    const u = Object.values(db.users).find(x => x.name.toLowerCase() === String(d.name || '').trim().toLowerCase());
    if (!u || hash(String(d.pass || ''), u.salt) !== u.pass) return send(ws, 'authError', 'Wrong username or password.');
    auth(ws, u);
  },
  token(ws, d) {
    const u = Object.values(db.users).find(x => x.token === d.token);
    if (!u) return send(ws, 'authError', '');
    auth(ws, u);
  },
};
function auth(ws, u) {
  ws.uid = u.id;
  if (!online.has(u.id)) online.set(u.id, new Set());
  online.get(u.id).add(ws);
  send(ws, 'token', u.token);
  sendInit(ws);
  broadcastPresence(u.id);
}

const authed = {
  history(ws, d) {
    if (!canAccessChannel(ws.uid, d.ch)) return;
    const list = (db.messages[d.ch] || []).slice(-150);
    send(ws, 'history', { ch: d.ch, msgs: list });
  },
  msg(ws, d) {
    const text = String(d.text || '').slice(0, 4000);
    if (!canAccessChannel(ws.uid, d.ch) || (!text.trim() && !d.attach && !d.poll)) return;
    const m = { id: id(), ch: d.ch, uid: ws.uid, text, ts: Date.now(), reactions: {} };
    if (d.reply) m.reply = d.reply;
    if (d.attach && typeof d.attach.url === 'string' && d.attach.url.length < 7e6) m.attach = { url: d.attach.url, name: String(d.attach.name || '').slice(0, 80), type: String(d.attach.type || '') };
    if (d.poll && Array.isArray(d.poll.options)) m.poll = { q: String(d.poll.q || '').slice(0, 200), options: d.poll.options.slice(0, 8).map(o => ({ t: String(o).slice(0, 80), v: [] })) };
    (db.messages[d.ch] || (db.messages[d.ch] = [])).push(m);
    if (db.messages[d.ch].length > 1000) db.messages[d.ch].shift();
    if (d.ch.startsWith('dm:')) {
      const [a, b] = d.ch.split(':').slice(1);
      for (const [x, y] of [[a, b], [b, a]]) {
        const l = db.dms[x] || (db.dms[x] = []);
        if (!l.includes(y)) { l.push(y); sendUser(x, 'dmOpen', { user: pub(db.users[y]) }); }
      }
    }
    channelAudience(d.ch).forEach(u => sendUser(u, 'msg', m));
    save();
  },
  edit(ws, d) {
    const m = (db.messages[d.ch] || []).find(x => x.id === d.id);
    if (!m || m.uid !== ws.uid) return;
    m.text = String(d.text || '').slice(0, 4000); m.edited = true;
    channelAudience(d.ch).forEach(u => sendUser(u, 'msgUpdate', m)); save();
  },
  del(ws, d) {
    const list = db.messages[d.ch] || [];
    const i = list.findIndex(x => x.id === d.id);
    if (i < 0) return;
    const s = Object.values(db.servers).find(s => s.channels.some(c => c.id === d.ch));
    if (list[i].uid !== ws.uid && !(s && s.owner === ws.uid)) return;
    list.splice(i, 1);
    channelAudience(d.ch).forEach(u => sendUser(u, 'msgDelete', { ch: d.ch, id: d.id })); save();
  },
  react(ws, d) {
    const m = (db.messages[d.ch] || []).find(x => x.id === d.id);
    if (!m || !canAccessChannel(ws.uid, d.ch)) return;
    const arr = m.reactions[d.emoji] || (m.reactions[d.emoji] = []);
    const i = arr.indexOf(ws.uid);
    i >= 0 ? arr.splice(i, 1) : arr.push(ws.uid);
    if (!arr.length) delete m.reactions[d.emoji];
    channelAudience(d.ch).forEach(u => sendUser(u, 'msgUpdate', m)); save();
  },
  pin(ws, d) {
    const m = (db.messages[d.ch] || []).find(x => x.id === d.id);
    if (!m || !canAccessChannel(ws.uid, d.ch)) return;
    m.pinned = !m.pinned;
    channelAudience(d.ch).forEach(u => sendUser(u, 'msgUpdate', m)); save();
  },
  vote(ws, d) {
    const m = (db.messages[d.ch] || []).find(x => x.id === d.id);
    if (!m || !m.poll || !canAccessChannel(ws.uid, d.ch)) return;
    m.poll.options.forEach((o, i) => { o.v = o.v.filter(x => x !== ws.uid); if (i === d.opt) o.v.push(ws.uid); });
    channelAudience(d.ch).forEach(u => sendUser(u, 'msgUpdate', m)); save();
  },
  typing(ws, d) {
    if (!canAccessChannel(ws.uid, d.ch)) return;
    channelAudience(d.ch).forEach(u => u !== ws.uid && sendUser(u, 'typing', { ch: d.ch, uid: ws.uid }));
  },
  createServer(ws, d) {
    const name = String(d.name || '').trim().slice(0, 32) || 'New Server';
    const s = { id: id(), name, color: rnd(COLORS), icon: d.icon || null, owner: ws.uid, members: [ws.uid], channels: mkChannels(), invite: crypto.randomBytes(4).toString('hex').toUpperCase(), roles: {}, topic: '' };
    db.servers[s.id] = s; save();
    sendUser(ws.uid, 'server', serverView(s));
  },
  joinServer(ws, d) {
    const code = String(d.code || '').trim().replace(/.*\//, '').toUpperCase();
    const s = Object.values(db.servers).find(x => x.invite.toUpperCase() === code);
    if (!s) return send(ws, 'toast', 'Invalid invite code.');
    if (!s.members.includes(ws.uid)) {
      s.members.push(ws.uid); save();
      s.members.forEach(m => sendUser(m, 'server', serverView(s)));
      s.members.forEach(m => sendUser(m, 'user', pub(db.users[ws.uid])));
      sendUser(ws.uid, 'users', usersFor(ws.uid));
    }
    send(ws, 'toast', `Joined ${s.name}!`);
    send(ws, 'goto', s.id);
  },
  leaveServer(ws, d) {
    const s = db.servers[d.id];
    if (!s) return;
    if (s.owner === ws.uid && s.id !== 'hub') { // owner leaving deletes the server
      delete db.servers[s.id];
      s.members.forEach(m => sendUser(m, 'serverGone', s.id));
    } else {
      s.members = s.members.filter(m => m !== ws.uid);
      sendUser(ws.uid, 'serverGone', s.id);
      s.members.forEach(m => sendUser(m, 'server', serverView(s)));
    }
    save();
  },
  kick(ws, d) {
    const s = db.servers[d.sid];
    if (!s || s.owner !== ws.uid || d.uid === ws.uid) return;
    s.members = s.members.filter(m => m !== d.uid);
    sendUser(d.uid, 'serverGone', s.id);
    s.members.forEach(m => sendUser(m, 'server', serverView(s))); save();
  },
  updateServer(ws, d) {
    const s = db.servers[d.id];
    if (!s || s.owner !== ws.uid) return;
    if (d.name) s.name = String(d.name).slice(0, 32);
    if (d.color) s.color = String(d.color).slice(0, 9);
    if (d.icon !== undefined) s.icon = d.icon;
    if (d.topic !== undefined) s.topic = String(d.topic).slice(0, 200);
    s.members.forEach(m => sendUser(m, 'server', serverView(s))); save();
  },
  addChannel(ws, d) {
    const s = db.servers[d.sid];
    if (!s || s.owner !== ws.uid) return;
    const name = String(d.name || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
    if (!name) return;
    s.channels.push({ id: id(), name, type: d.type === 'voice' ? 'voice' : 'text' });
    s.members.forEach(m => sendUser(m, 'server', serverView(s))); save();
  },
  delChannel(ws, d) {
    const s = db.servers[d.sid];
    if (!s || s.owner !== ws.uid || s.channels.length < 2) return;
    s.channels = s.channels.filter(c => c.id !== d.id);
    delete db.messages[d.id];
    s.members.forEach(m => sendUser(m, 'server', serverView(s))); save();
  },
  newInvite(ws, d) {
    const s = db.servers[d.sid];
    if (!s || s.owner !== ws.uid) return;
    s.invite = crypto.randomBytes(4).toString('hex').toUpperCase();
    s.members.forEach(m => sendUser(m, 'server', serverView(s))); save();
  },
  profile(ws, d) {
    const u = db.users[ws.uid];
    if (d.status && ['online', 'idle', 'dnd', 'invisible'].includes(d.status)) u.status = d.status;
    if (d.bio !== undefined) u.bio = String(d.bio).slice(0, 190);
    if (d.custom !== undefined) u.custom = String(d.custom).slice(0, 60);
    if (d.avatar !== undefined) u.avatar = d.avatar && d.avatar.length < 3e6 ? d.avatar : null;
    if (d.color) u.color = String(d.color).slice(0, 9);
    save(); broadcastPresence(u.id);
  },
  addFriend(ws, d) {
    const t = Object.values(db.users).find(x => x.name.toLowerCase() === String(d.name || '').trim().toLowerCase());
    if (!t || t.id === ws.uid) return send(ws, 'toast', 'User not found.');
    if (friendsOf(ws.uid).includes(t.id)) return send(ws, 'toast', 'Already friends.');
    const r = db.requests[t.id] || (db.requests[t.id] = []);
    if (!r.includes(ws.uid)) r.push(ws.uid);
    save();
    sendUser(t.id, 'request', { from: pub(db.users[ws.uid]) });
    send(ws, 'toast', `Friend request sent to ${t.name}.`);
  },
  acceptFriend(ws, d) {
    const r = db.requests[ws.uid] || [];
    if (!r.includes(d.uid)) return;
    db.requests[ws.uid] = r.filter(x => x !== d.uid);
    if (d.accept) { friendsOf(ws.uid).push(d.uid); friendsOf(d.uid).push(ws.uid); }
    save();
    [ws.uid, d.uid].forEach(x => { sendUser(x, 'friends', { friends: friendsOf(x), requests: db.requests[x] || [] }); });
    sendUser(ws.uid, 'user', pub(db.users[d.uid])); sendUser(d.uid, 'user', pub(db.users[ws.uid]));
  },
  removeFriend(ws, d) {
    db.friends[ws.uid] = friendsOf(ws.uid).filter(x => x !== d.uid);
    db.friends[d.uid] = friendsOf(d.uid).filter(x => x !== ws.uid); save();
    [ws.uid, d.uid].forEach(x => sendUser(x, 'friends', { friends: friendsOf(x), requests: db.requests[x] || [] }));
  },
  openDM(ws, d) {
    if (!db.users[d.uid] || d.uid === ws.uid) return;
    const l = db.dms[ws.uid] || (db.dms[ws.uid] = []);
    if (!l.includes(d.uid)) l.push(d.uid);
    save();
    send(ws, 'dmOpen', { user: pub(db.users[d.uid]), goto: true });
  },
  // ----- voice / calls (WebRTC signalling) -----
  joinVoice(ws, d) {
    if (!canAccessChannel(ws.uid, d.room)) return;
    leaveVoice(ws.uid);
    const set = voice.get(d.room) || new Set();
    const others = [...set];
    set.add(ws.uid); voice.set(d.room, set);
    send(ws, 'voiceJoined', { room: d.room, peers: others });
    channelAudience(d.room).forEach(m => sendUser(m, 'voice', { room: d.room, users: [...set] }));
    if (d.room.startsWith('dm:') && !others.length) {
      const other = d.room.split(':').slice(1).find(x => x !== ws.uid);
      sendUser(other, 'ring', { room: d.room, from: pub(db.users[ws.uid]), video: !!d.video });
    }
  },
  leaveVoice(ws) { leaveVoice(ws.uid); },
  signal(ws, d) {
    const set = [...voice.values()].find(s => s.has(ws.uid) && s.has(d.to));
    if (set) sendUser(d.to, 'signal', { from: ws.uid, data: d.data });
  },
  speaking(ws, d) {
    for (const [room, set] of voice) if (set.has(ws.uid)) set.forEach(u => u !== ws.uid && sendUser(u, 'speaking', { uid: ws.uid, on: !!d.on }));
  },
  search(ws, d) {
    const q = String(d.q || '').toLowerCase();
    if (!q || !canAccessChannel(ws.uid, d.ch)) return;
    send(ws, 'searchResults', (db.messages[d.ch] || []).filter(m => m.text.toLowerCase().includes(q)).slice(-50));
  },
};

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try {
      if (!ws.uid) return handlers[m.t] && handlers[m.t](ws, m.d || {});
      if (authed[m.t]) authed[m.t](ws, m.d || {});
    } catch (e) { console.error(e); }
  });
  ws.on('close', () => {
    if (!ws.uid) return;
    const set = online.get(ws.uid);
    set.delete(ws);
    if (!set.size) { online.delete(ws.uid); leaveVoice(ws.uid); broadcastPresence(ws.uid); }
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 25000);

server.listen(PORT, () => console.log(`Nimbus running on http://localhost:${PORT}`));
