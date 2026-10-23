'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Storage is full — try a smaller background image.'); } };

// ================= state =================
const S = { me: null, servers: {}, users: {}, friends: [], requests: [], dms: [], voice: {}, cur: { type: 'home', sid: null, ch: null }, msgs: {}, typing: {}, unread: {}, replyTo: null, tab: 'online', showPins: false, search: null };
let ws, reconnectT, authMode = 'login';

// ================= preferences / appearance =================
const THEMES = {
  Midnight: { c: ['24,25,31', '30,31,39', '36,38,47', '46,48,60'], text: '#e8e9f0', muted: '#9a9db0' },
  Graphite: { c: ['20,20,20', '28,28,30', '38,38,41', '52,52,56'], text: '#ececec', muted: '#a0a0a8' },
  AMOLED: { c: ['0,0,0', '8,8,10', '14,14,18', '28,28,34'], text: '#f2f2f2', muted: '#8d8d99' },
  Ocean: { c: ['8,22,38', '12,32,54', '16,42,70', '24,60,96'], text: '#e3f2ff', muted: '#8fb4d6' },
  Forest: { c: ['14,26,20', '19,36,28', '25,46,36', '36,66,50'], text: '#e4f5ea', muted: '#93b8a1' },
  Sunset: { c: ['38,16,26', '52,22,34', '66,28,42', '92,40,56'], text: '#ffe9ec', muted: '#d6a0ab' },
  Light: { c: ['227,229,235', '238,239,243', '248,249,251', '226,228,236'], text: '#1c1d24', muted: '#5b5f70' },
};
const GRADS = ['linear-gradient(135deg,#5b2cff,#00c6ff)', 'linear-gradient(135deg,#ff512f,#dd2476)', 'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#232526,#414345)', 'linear-gradient(135deg,#fc4a1a,#f7b733)', 'linear-gradient(135deg,#0f2027,#2c5364)'];
const ACCENTS = ['#7c5cff', '#5865f2', '#ff4fa3', '#2ec4b6', '#ff8a3d', '#3ddc84', '#ff5b6b', '#37a9ff'];
const DEF = { theme: 'Midnight', accent: '#7c5cff', textColor: '', bgType: 'none', bgColor: '#1a1b26', bgGrad: GRADS[0], bgImage: '', alpha: 100, blur: 0, fs: 15, radius: 14, font: 'default', compact: false, sound: true, desk: true, members: true };
let P = Object.assign({}, DEF, lsGet('nimbus_pref', {}));
const FONTS = { default: "'Segoe UI',system-ui,-apple-system,Roboto,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "Consolas,'Courier New',monospace", rounded: "'Trebuchet MS','Comic Sans MS',system-ui,sans-serif" };
function applyPrefs() {
  const r = document.documentElement.style, t = THEMES[P.theme] || THEMES.Midnight;
  t.c.forEach((c, i) => r.setProperty('--c' + (i + 1), c));
  r.setProperty('--text', P.textColor || t.text); r.setProperty('--muted', t.muted);
  r.setProperty('--accent', P.accent); r.setProperty('--accent2', P.accent);
  const hasBg = P.bgType !== 'none';
  r.setProperty('--alpha', hasBg ? P.alpha / 100 : 1);
  r.setProperty('--blur', hasBg ? P.blur + 'px' : '0px');
  r.setProperty('--fs', P.fs + 'px'); r.setProperty('--radius', P.radius + 'px'); r.setProperty('--font', FONTS[P.font] || FONTS.default);
  const bg = $('#bg');
  bg.style.background = P.bgType === 'color' ? P.bgColor : P.bgType === 'gradient' ? P.bgGrad : P.bgType === 'image' && P.bgImage ? `url(${P.bgImage}) center/cover` : '';
  document.body.classList.toggle('compact', P.compact);
  document.body.classList.toggle('nomembers', !P.members);
}
const savePrefs = () => { lsSet('nimbus_pref', P); applyPrefs(); };
applyPrefs();

// ================= network =================
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { const tk = lsGet('nimbus_token', null); if (tk) send('token', { token: tk }); };
  ws.onmessage = e => { const m = JSON.parse(e.data); (H[m.t] || (() => { }))(m.d); };
  ws.onclose = () => { clearTimeout(reconnectT); reconnectT = setTimeout(connect, 1500); };
}
const send = (t, d = {}) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ t, d }));

// ================= helpers =================
const uOf = id => S.users[id] || { id, name: 'Unknown', color: '#777', status: 'offline' };
const initials = n => esc((n || '?').slice(0, 2).toUpperCase());
function avatar(u, cls = '', dot = false) {
  const st = u.online === false || u.status === 'invisible' ? 'offline' : u.status || 'online';
  return `<div class="av ${cls}" data-uid="${esc(u.id)}" style="background-color:${esc(u.color)};${u.avatar ? `background-image:url(${esc(u.avatar)})` : ''}">${u.avatar ? '' : initials(u.name)}${dot ? `<i class="dot ${st}"></i>` : ''}</div>`;
}
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('#toasts').append(d); setTimeout(() => d.remove(), 3500); }
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? 'Today at ' + fmtTime(ts) : d.toLocaleDateString() + ' ' + fmtTime(ts); };
function beep(f = 660, d = 0.12) {
  if (!P.sound) return;
  try { const a = beep.a || (beep.a = new (window.AudioContext || window.webkitAudioContext)()); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.value = 0.05; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + d); } catch { }
}
function dmId(uid) { return 'dm:' + [S.me.id, uid].sort().join(':'); }
const dmPeer = ch => ch.split(':').slice(1).find(x => x !== S.me.id);
const curServer = () => S.servers[S.cur.sid];
function chanName(ch) {
  if (ch.startsWith('dm:')) return uOf(dmPeer(ch)).name;
  for (const s of Object.values(S.servers)) { const c = s.channels.find(c => c.id === ch); if (c) return c.name; }
  return '';
}

// markdown-ish renderer
function md(text, mentionCheck) {
  const blocks = [];
  let t = String(text).replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  t = esc(t);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'show\')">$1</span>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/@(\w+)/g, (m, n) => { const hit = n === 'everyone' || Object.values(S.users).some(u => u.name.toLowerCase() === n.toLowerCase()); return hit ? `<span class="mt">@${n}</span>` : m; });
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

// ================= handlers =================
const H = {
  token: t => lsSet('nimbus_token', t),
  authError(m) { $('#authErr').textContent = m; $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); },
  init(d) {
    S.me = d.me; S.users = {}; d.users.forEach(u => S.users[u.id] = u); S.users[d.me.id] = d.me;
    S.servers = {}; d.servers.forEach(s => S.servers[s.id] = s);
    S.friends = d.friends; S.requests = d.requests; S.dms = d.dms; S.voice = d.voice;
    $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
    const first = S.cur.type === 'home' && !S.cur.ch ? Object.keys(S.servers)[0] : null;
    if (first && !S.booted) go('server', first);
    S.booted = true;
    renderAll();
    if (S.cur.ch) send('history', { ch: S.cur.ch });
    if (call.room) send('joinVoice', { room: call.room }); // reconnected mid-call
  },
  user(u) { S.users[u.id] = u; if (u.id === S.me.id) S.me = u; renderSide(); renderMembers(); renderRail(); if (S.cur.type === 'home') renderFriends(); renderMsgs(true); },
  users(l) { l.forEach(u => S.users[u.id] = u); },
  server(s) { const isNew = !S.servers[s.id]; S.servers[s.id] = s; if (isNew && s.owner === S.me.id) go('server', s.id); renderAll(); },
  serverGone(id) { delete S.servers[id]; if (S.cur.sid === id) go('home'); renderAll(); },
  goto(id) { go('server', id); },
  toast,
  history(d) { S.msgs[d.ch] = d.msgs; if (d.ch === S.cur.ch) renderMsgs(); },
  msg(m) {
    (S.msgs[m.ch] || (S.msgs[m.ch] = [])).push(m);
    if (m.ch === S.cur.ch && document.visibilityState === 'visible') { renderMsgs(); send('typing', {}); }
    else if (m.uid !== S.me.id) { S.unread[m.ch] = (S.unread[m.ch] || 0) + 1; renderRail(); renderSide(); }
    if (m.uid !== S.me.id) {
      const ping = m.ch.startsWith('dm:') || new RegExp('@(' + S.me.name + '|everyone)\\b', 'i').test(m.text);
      if (m.ch !== S.cur.ch || document.visibilityState !== 'visible') { beep(ping ? 880 : 520); if (P.desk && ping && window.Notification && Notification.permission === 'granted') new Notification(uOf(m.uid).name, { body: m.text.slice(0, 100) || 'sent an attachment' }); }
    }
    delete S.typing[m.ch + m.uid];
    if (m.ch === S.cur.ch) renderTyping();
  },
  msgUpdate(m) { const l = S.msgs[m.ch] || []; const i = l.findIndex(x => x.id === m.id); if (i >= 0) l[i] = m; if (m.ch === S.cur.ch) renderMsgs(true); },
  msgDelete(d) { S.msgs[d.ch] = (S.msgs[d.ch] || []).filter(x => x.id !== d.id); if (d.ch === S.cur.ch) renderMsgs(true); },
  typing(d) { const k = d.ch + d.uid; S.typing[k] = Date.now() + 4000; renderTyping(); setTimeout(renderTyping, 4100); },
  dmOpen(d) { S.users[d.user.id] = d.user; if (!S.dms.includes(d.user.id)) S.dms.push(d.user.id); if (d.goto) go('dm', d.user.id); renderAll(); },
  request(d) { S.users[d.from.id] = d.from; if (!S.requests.includes(d.from.id)) S.requests.push(d.from.id); toast(`${d.from.name} sent you a friend request`); beep(700); renderAll(); },
  friends(d) { S.friends = d.friends; S.requests = d.requests; renderAll(); },
  voice(d) { if (d.users.length) S.voice[d.room] = d.users; else delete S.voice[d.room]; renderSide(); if (call.room === d.room) syncPeers(d.users); renderDock(); },
  voiceJoined(d) { startCall(d.room, d.peers); },
  ring(d) { S.users[d.from.id] = d.from; ringModal(d); },
  signal(d) { onSignal(d.from, d.data); },
  searchResults(l) { S.search = l; renderMsgs(); },
};

// ================= navigation =================
function go(type, id) {
  document.body.classList.remove('nav');
  S.search = null; S.showPins = false; S.replyTo = null;
  if (type === 'home') S.cur = { type: 'home', sid: null, ch: null };
  else if (type === 'dm') { S.cur = { type: 'dm', sid: null, ch: dmId(id), peer: id }; }
  else if (type === 'server') {
    const s = S.servers[id]; if (!s) return;
    const last = lsGet('nimbus_lastch', {})[id];
    const ch = s.channels.find(c => c.id === last && c.type === 'text') || s.channels.find(c => c.type === 'text') || s.channels[0];
    S.cur = { type: 'server', sid: id, ch: ch.id };
  }
  if (S.cur.ch) { send('history', { ch: S.cur.ch }); delete S.unread[S.cur.ch]; }
  renderAll();
  if (S.cur.ch) setTimeout(() => $('#input').focus(), 50);
}
function goChannel(ch) {
  S.cur.ch = ch; S.search = null; S.showPins = false; S.replyTo = null; document.body.classList.remove('nav');
  const m = lsGet('nimbus_lastch', {}); m[S.cur.sid] = ch; lsSet('nimbus_lastch', m);
  delete S.unread[ch];
  const c = curServer().channels.find(c => c.id === ch);
  if (c.type === 'text') send('history', { ch });
  renderAll();
}
const isVoiceCh = () => { const s = curServer(); const c = s && s.channels.find(c => c.id === S.cur.ch); return !!(c && c.type === 'voice'); };

// ================= rendering =================
function renderAll() { renderRail(); renderSide(); renderTop(); renderMain(); renderMembers(); renderUserPanel(); renderVoiceBar(); renderDock(); }
function renderRail() {
  const hu = Object.keys(S.unread).filter(c => c.startsWith('dm:')).length + S.requests.length;
  let h = `<div class="ri-wrap ${S.cur.type !== 'server' ? 'on' : ''}"><i class="pill"></i><div class="ri ${S.cur.type !== 'server' ? 'on' : ''}" data-act="home" title="Home">☁${hu ? `<span class="badge">${hu}</span>` : ''}</div></div><div class="sep"></div>`;
  for (const s of Object.values(S.servers)) {
    const un = s.channels.reduce((a, c) => a + (S.unread[c.id] || 0), 0);
    h += `<div class="ri-wrap ${S.cur.sid === s.id ? 'on' : ''} ${un ? 'unread' : ''}"><i class="pill"></i><div class="ri" data-act="srv" data-id="${esc(s.id)}" title="${esc(s.name)}" style="${s.icon ? '' : 'background:' + esc(s.color)}">${s.icon ? `<img src="${esc(s.icon)}">` : esc(s.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3))}${un ? `<span class="badge">${un}</span>` : ''}</div></div>`;
  }
  h += `<div class="ri add" data-act="addsrv" title="Create or join a server">＋</div>`;
  $('#rail').innerHTML = h;
}
function renderSide() {
  const head = $('#sideHead'), list = $('#sideList');
  if (S.cur.type === 'server') {
    const s = curServer(); if (!s) return;
    head.innerHTML = `<span>${esc(s.name)}</span><span>⌄</span>`; head.dataset.act = 'srvmenu';
    const owner = s.owner === S.me.id;
    let h = '';
    for (const type of ['text', 'voice']) {
      h += `<div class="cat"><span>${type === 'text' ? 'Text Channels' : 'Voice Channels'}</span>${owner ? `<button data-act="addch" data-type="${type}" title="Create channel">＋</button>` : ''}</div>`;
      for (const c of s.channels.filter(c => c.type === type)) {
        const un = S.unread[c.id];
        h += `<div class="item ${S.cur.ch === c.id ? 'on' : ''} ${un ? 'unread' : ''}" data-act="ch" data-id="${esc(c.id)}" data-cid="${esc(c.id)}"><span class="hash">${type === 'text' ? '#' : '🔊'}</span><span class="name">${esc(c.name)}</span>${un ? `<span class="badge" style="position:static;border:0">${un}</span>` : ''}${owner && s.channels.length > 1 ? `<span class="x" data-act="delch" data-id="${esc(c.id)}" title="Delete">✕</span>` : ''}</div>`;
        if (type === 'voice' && S.voice[c.id]) h += `<div class="vusers">${S.voice[c.id].map(id => { const u = uOf(id); return `<div class="vuser" data-vu="${esc(id)}">${avatar(u, 'sm')}<span>${esc(u.name)}</span></div>`; }).join('')}</div>`;
      }
    }
    list.innerHTML = h;
  } else {
    head.innerHTML = `<span>Nimbus</span>`; head.dataset.act = '';
    let h = `<div class="item ${S.cur.type === 'home' ? 'on' : ''}" data-act="home"><span class="hash">👥</span><span class="name">Friends</span>${S.requests.length ? `<span class="badge" style="position:static;border:0">${S.requests.length}</span>` : ''}</div><div class="cat"><span>Direct Messages</span></div>`;
    for (const id of S.dms) {
      const u = uOf(id), ch = dmId(id), un = S.unread[ch];
      h += `<div class="item ${S.cur.ch === ch ? 'on' : ''} ${un ? 'unread' : ''}" data-act="dm" data-id="${esc(id)}">${avatar(u, 'sm', true)}<span class="name">${esc(u.name)}</span>${un ? `<span class="badge" style="position:static;border:0">${un}</span>` : ''}${S.voice[ch] ? '<span>📞</span>' : ''}</div>`;
    }
    list.innerHTML = h;
  }
}
function renderUserPanel() {
  const u = S.me;
  $('#userPanel').innerHTML = `${avatar(u, '', true)}<div class="who" data-act="settings"><b>${esc(u.name)}</b><span>${esc(u.custom || (u.status === 'dnd' ? 'Do Not Disturb' : u.status))}</span></div>
  <button class="icon ${call.mute ? 'off' : ''}" data-act="mute" title="Mute">${call.mute ? '🔇' : '🎤'}</button>
  <button class="icon ${call.deaf ? 'off' : ''}" data-act="deaf" title="Deafen">${call.deaf ? '🙉' : '🎧'}</button>
  <button class="icon" data-act="settings" title="User Settings">⚙</button>`;
}
function renderTop() {
  const t = $('#top'); let h = `<button class="icon" id="burger" data-act="burger">☰</button>`;
  if (S.cur.type === 'home') h += `<span class="title">👥 Friends</span>`;
  else if (S.cur.type === 'dm') {
    const u = uOf(S.cur.peer);
    h += `${avatar(u, 'sm', true)}<span class="title">${esc(u.name)}</span><span class="sp"></span><button class="icon" data-act="callDM" title="Voice call">📞</button><button class="icon" data-act="callDM" data-video="1" title="Video call">🎥</button><button class="icon" data-act="pins" title="Pinned messages">📌</button><input id="searchIn" placeholder="Search" value="${esc(S.searchQ || '')}">`;
  } else {
    const s = curServer(); if (!s) return; const c = s.channels.find(c => c.id === S.cur.ch);
    h += `<span class="title">${c.type === 'voice' ? '🔊' : '#'} ${esc(c.name)}</span><span class="topic">${esc(s.topic)}</span><span class="sp"></span>`;
    if (c.type === 'text') h += `<button class="icon" data-act="pins" title="Pinned messages">📌</button><input id="searchIn" placeholder="Search" value="${esc(S.searchQ || '')}">`;
    h += `<button class="icon ${P.members ? 'on' : ''}" data-act="togmembers" title="Member list">👥</button>`;
  }
  t.innerHTML = h;
  const si = $('#searchIn'); if (si) si.onkeydown = e => { if (e.key === 'Enter') { S.searchQ = si.value; if (si.value.trim()) send('search', { ch: S.cur.ch, q: si.value }); else { S.search = null; renderMsgs(); } } };
}
function renderMain() {
  const home = S.cur.type === 'home', voiceView = S.cur.type === 'server' && isVoiceCh();
  $('#friendsView').classList.toggle('hidden', !home);
  $('#chatwrap').classList.toggle('hidden', home || voiceView);
  if (home) renderFriends();
  else if (!voiceView) { $('#input').placeholder = S.cur.type === 'dm' ? `Message @${uOf(S.cur.peer).name}` : `Message #${chanName(S.cur.ch)}`; renderMsgs(); renderTyping(); renderReply(); }
}
function renderMembers() {
  const m = $('#members');
  if (S.cur.type !== 'server' || !curServer()) { m.innerHTML = ''; return; }
  const s = curServer(), us = s.members.map(uOf);
  const on = us.filter(u => u.online !== false && u.status !== 'invisible'), off = us.filter(u => !(u.online !== false && u.status !== 'invisible'));
  const row = u => `<div class="item" data-act="member" data-id="${esc(u.id)}" style="${u.online === false ? 'opacity:.5' : ''}">${avatar(u, 'sm', true)}<span class="name" style="color:${esc(u.color)}">${esc(u.name)}${u.id === s.owner ? ' 👑' : ''}</span></div>`;
  m.innerHTML = `<div class="mgroup">Online — ${on.length}</div>${on.map(row).join('')}<div class="mgroup">Offline — ${off.length}</div>${off.map(row).join('')}`;
}
function renderFriends() {
  const v = $('#friendsView'), tabs = ['online', 'all', 'pending', 'add'];
  let h = `<div class="tabs">${tabs.map(t => `<div class="tab ${S.tab === t ? 'on' : ''} ${t === 'add' ? 'green' : ''}" data-act="ftab" data-id="${t}">${{ online: 'Online', all: 'All', pending: 'Pending' + (S.requests.length ? ` (${S.requests.length})` : ''), add: 'Add Friend' }[t]}</div>`).join('')}</div>`;
  if (S.tab === 'add') h += `<div class="card"><h3 style="margin-top:0">Add Friend</h3><p class="muted">Enter their exact username.</p><div style="display:flex;gap:8px"><input id="addName" placeholder="Username"><button class="btn primary" data-act="sendreq">Send Request</button></div></div>`;
  else if (S.tab === 'pending') h += S.requests.map(id => { const u = uOf(id); return `<div class="frow">${avatar(u, '', true)}<div class="grow"><b>${esc(u.name)}</b><div class="muted small">Incoming friend request</div></div><button class="btn sm primary" data-act="accept" data-id="${esc(id)}">Accept</button><button class="btn sm" data-act="decline" data-id="${esc(id)}">Ignore</button></div>`; }).join('') || '<p class="sys">No pending requests.</p>';
  else {
    let l = S.friends.map(uOf); if (S.tab === 'online') l = l.filter(u => u.online !== false && u.status !== 'invisible');
    h += `<div class="muted small" style="margin-bottom:6px">${S.tab.toUpperCase()} — ${l.length}</div>` + (l.map(u => `<div class="frow">${avatar(u, '', true)}<div class="grow"><b>${esc(u.name)}</b><div class="muted small">${esc(u.custom || u.status)}</div></div><button class="icon" data-act="dm" data-id="${esc(u.id)}" title="Message">💬</button><button class="icon" data-act="rmfriend" data-id="${esc(u.id)}" title="Remove">✕</button></div>`).join('') || '<p class="sys">Nobody here yet. Add a friend, or join a server and say hi!</p>');
  }
  v.innerHTML = h;
}

let lastRenderKey = '';
function renderMsgs(keepScroll) {
  const box = $('#msgs'); if (!S.cur.ch || box.offsetParent === null && !keepScroll && false) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevTop = box.scrollTop;
  let list = S.search || (S.msgs[S.cur.ch] || []);
  if (S.showPins) list = list.filter(m => m.pinned);
  let h = '';
  if (S.search) h += `<div class="sys" style="padding:8px">Search results — ${list.length} <a href="#" data-act="clearsearch">clear</a></div>`;
  if (S.showPins) h += `<div class="sys" style="padding:8px">📌 Pinned messages <a href="#" data-act="pins">close</a></div>`;
  if (!list.length) h += `<div class="sys">${S.search ? 'No results.' : S.showPins ? 'Nothing pinned yet.' : 'This is the beginning of the conversation. Say something nice! 👋'}</div>`;
  let prev = null;
  for (const m of list) {
    const u = uOf(m.uid), first = !prev || prev.uid !== m.uid || m.ts - prev.ts > 300000 || m.reply || S.search;
    prev = m;
    const mention = new RegExp('@(' + S.me.name.replace(/[^\w]/g, '') + '|everyone)\\b', 'i').test(m.text) && m.uid !== S.me.id;
    h += `<div class="msg ${first ? 'first' : ''} ${m.pinned ? 'pinned' : ''} ${mention ? 'mention' : ''}" data-mid="${m.id}">`;
    if (m.reply) { const r = (S.msgs[m.ch] || []).find(x => x.id === m.reply); h += `<div class="reply" data-act="jump" data-id="${esc(m.reply)}">↪ ${r ? `<b style="color:${esc(uOf(r.uid).color)}">${esc(uOf(r.uid).name)}</b> ${esc((r.text || 'attachment').slice(0, 80))}` : 'Original message was deleted'}</div>`; }
    if (first) h += `${avatar(u, '', false)}<div class="head"><span class="nm" data-act="member" data-id="${esc(u.id)}" style="color:${esc(u.color)}">${esc(u.name)}</span><span class="ts">${fmtDay(m.ts)}</span></div>`;
    else h += `<span class="stamp">${fmtTime(m.ts)}</span>`;
    h += `<div class="body">${md(m.text)}${m.edited ? ' <span class="edited">(edited)</span>' : ''}</div>`;
    if (m.attach) h += attachHtml(m.attach);
    if (m.poll) { const tot = m.poll.options.reduce((a, o) => a + o.v.length, 0); h += `<div class="poll"><h4>📊 ${esc(m.poll.q)}</h4>${m.poll.options.map((o, i) => `<div class="opt ${o.v.includes(S.me.id) ? 'me' : ''}" data-act="vote" data-mid="${m.id}" data-i="${i}"><i style="width:${tot ? o.v.length / tot * 100 : 0}%"></i><span>${esc(o.t)}</span><span>${o.v.length}</span></div>`).join('')}<div class="muted small">${tot} vote${tot === 1 ? '' : 's'}</div></div>`; }
    const rs = Object.entries(m.reactions || {});
    if (rs.length) h += `<div class="reacts">${rs.map(([e, us]) => `<button class="react ${us.includes(S.me.id) ? 'me' : ''}" data-act="react" data-mid="${m.id}" data-e="${esc(e)}">${esc(e)} ${us.length}</button>`).join('')}</div>`;
    h += `<div class="tools"><button data-act="rpick" data-mid="${m.id}" title="React">😀</button><button data-act="reply" data-mid="${m.id}" title="Reply">↩</button>${m.uid === S.me.id ? `<button data-act="edit" data-mid="${m.id}" title="Edit">✏</button>` : ''}<button data-act="pin" data-mid="${m.id}" title="Pin">📌</button>${m.uid === S.me.id || (curServer() && curServer().owner === S.me.id) ? `<button data-act="del" data-mid="${m.id}" title="Delete">🗑</button>` : ''}</div></div>`;
  }
  box.innerHTML = h;
  box.scrollTop = atBottom || !keepScroll ? box.scrollHeight : prevTop;
}
function attachHtml(a) {
  const u = esc(a.url);
  if (/^data:image\//.test(a.url)) return `<div class="attach"><img src="${u}" alt="${esc(a.name)}" data-act="zoom"></div>`;
  if (/^data:video\//.test(a.url)) return `<div class="attach"><video src="${u}" controls></video></div>`;
  if (/^data:audio\//.test(a.url)) return `<div class="attach"><audio src="${u}" controls></audio></div>`;
  if (/^data:/.test(a.url)) return `<a class="file" href="${u}" download="${esc(a.name)}">📄 ${esc(a.name || 'file')}</a>`;
  return '';
}
function renderTyping() {
  const now = Date.now(), names = Object.entries(S.typing).filter(([k, t]) => t > now && k.startsWith(S.cur.ch)).map(([k]) => uOf(k.slice(S.cur.ch.length)).name);
  $('#typing').textContent = names.length ? `${names.slice(0, 3).join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
}
function renderReply() {
  const r = $('#replyBar');
  if (!S.replyTo) { r.classList.add('hidden'); return; }
  const m = (S.msgs[S.cur.ch] || []).find(x => x.id === S.replyTo);
  r.classList.remove('hidden'); r.innerHTML = `<span>Replying to <b>${esc(m ? uOf(m.uid).name : '')}</b></span><button data-act="cancelreply">✕</button>`;
}

// ================= composer =================
const input = $('#input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; if (Date.now() - (input.lt || 0) > 2500) { input.lt = Date.now(); send('typing', { ch: S.cur.ch }); } });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  if (e.key === 'ArrowUp' && !input.value) { const mine = [...(S.msgs[S.cur.ch] || [])].reverse().find(m => m.uid === S.me.id); if (mine) editMsg(mine.id); }
  if (e.key === 'Escape') { S.replyTo = null; renderReply(); }
});
input.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); uploadFile(f); } });
$('#msgs').addEventListener('dragover', e => e.preventDefault());
$('#msgs').addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
$('#sendBtn').onclick = sendText;
$('#attachBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; };
$('#emojiBtn').onclick = e => { e.stopPropagation(); pickEmoji(e.currentTarget, em => { input.value += em; input.focus(); }, true); };

const EMOJI = '😀😃😄😁😆😅😂🤣🥲😊😇🙂😉😍🥰😘😋😛😜🤪😎🤓🥳🤩😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👻💀☠️👽🤖💩🙈🙉🙊👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏💪👏🙌👐🤲❤️🧡💛💚💙💜🖤🤍💔❣️💕💞💓💗💖💘💝🔥✨⭐🌟💫💥💯✅❌❓❗🎉🎊🎁🎮🎧🎵🎶🎤🎬📷💻📱⌨️🖥️🍕🍔🍟🌭🍿🍩🍪🎂🍰☕🍺🍻🥂🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦄🐝🦋🐢🐍🐙🐬🐳🌈☀️🌙⚡❄️🌊🌸🌹🌻🍀🌵⚽🏀🏈🎯🏆🥇🚀✈️🚗🏠'.match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu);
function pickEmoji(anchor, cb, above) {
  const p = $('#picker'); p.innerHTML = EMOJI.map(e => `<span>${e}</span>`).join(''); p.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - 340, r.right - 330)) + 'px';
  p.style.top = (above || r.top > 330 ? Math.max(8, r.top - 328) : r.bottom + 6) + 'px';
  p.onclick = e => { if (e.target.tagName === 'SPAN') { cb(e.target.textContent); p.classList.add('hidden'); } };
}
function sendText() {
  let text = input.value; if (!text.trim() || !S.cur.ch) return;
  let poll = null;
  const cmd = text.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (cmd) {
    const [, c, a] = cmd;
    if (c === 'shrug') text = (a + ' ¯\\_(ツ)_/¯').trim();
    else if (c === 'tableflip') text = (a + ' (╯°□°）╯︵ ┻━┻').trim();
    else if (c === 'unflip') text = (a + ' ┬─┬ ノ( ゜-゜ノ)').trim();
    else if (c === 'me') text = `*${a}*`;
    else if (c === 'spoiler') text = `||${a}||`;
    else if (c === 'flip') text = `🪙 **${Math.random() < .5 ? 'Heads' : 'Tails'}**`;
    else if (c === 'roll') text = `🎲 rolled **${1 + Math.floor(Math.random() * (parseInt(a) || 6))}** (d${parseInt(a) || 6})`;
    else if (c === 'poll') { const parts = a.split('|').map(x => x.trim()).filter(Boolean); if (parts.length < 3) return toast('Usage: /poll Question | Option 1 | Option 2'); poll = { q: parts[0], options: parts.slice(1) }; text = ''; }
    else if (c === 'help') { toast('Commands: /shrug /tableflip /unflip /me /spoiler /flip /roll [n] /poll Q | A | B'); input.value = ''; return; }
  }
  send('msg', { ch: S.cur.ch, text, reply: S.replyTo, poll });
  input.value = ''; input.style.height = 'auto'; S.replyTo = null; renderReply();
}
async function uploadFile(f) {
  if (!S.cur.ch) return;
  if (f.size > 5e6 && !f.type.startsWith('image/')) return toast('Files must be under 5 MB.');
  let url;
  if (f.type.startsWith('image/') && f.type !== 'image/gif') url = await shrink(f, 1600, .85); else url = await readAs(f);
  if (url.length > 6.5e6) return toast('File too large.');
  send('msg', { ch: S.cur.ch, text: '', reply: S.replyTo, attach: { url, name: f.name, type: f.type } });
  S.replyTo = null; renderReply();
}
const readAs = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
async function shrink(f, max, q) {
  const src = await readAs(f);
  return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL(f.type === 'image/png' && k === 1 && f.size < 1.5e6 ? 'image/png' : 'image/jpeg', q)); }; im.onerror = () => res(src); im.src = src; });
}
function editMsg(id) {
  const m = (S.msgs[S.cur.ch] || []).find(x => x.id === id); if (!m) return;
  const el = document.querySelector(`[data-mid="${id}"] .body`); if (!el) return;
  el.innerHTML = `<textarea id="editBox" rows="2">${esc(m.text)}</textarea><div class="muted small">Enter to save • Esc to cancel</div>`;
  const t = $('#editBox'); t.focus();
  t.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send('edit', { ch: m.ch, id, text: t.value }); } if (e.key === 'Escape') renderMsgs(true); };
}

// ================= click delegation =================
const A = {
  home: () => go('home'),
  srv: el => go('server', el.dataset.id),
  addsrv: () => serverModal(),
  ch: el => { const c = curServer().channels.find(c => c.id === el.dataset.id); if (c.type === 'voice') { goChannel(c.id); if (call.room !== c.id) send('joinVoice', { room: c.id }); } else goChannel(c.id); },
  dm: el => go('dm', el.dataset.id),
  addch: el => channelModal(el.dataset.type),
  delch: (el, e) => { e.stopPropagation(); if (confirm('Delete this channel?')) send('delChannel', { sid: S.cur.sid, id: el.dataset.id }); },
  srvmenu: el => { const s = curServer(), o = s.owner === S.me.id; const r = el.getBoundingClientRect(); ctx(r.left + 8, r.bottom, [['Invite People', () => inviteModal()], ...(o ? [['Server Settings', () => serverSettings()]] : []), [o && s.id !== 'hub' ? 'Delete Server' : 'Leave Server', () => { if (confirm(o && s.id !== 'hub' ? 'Delete this server for everyone?' : 'Leave this server?')) send('leaveServer', { id: s.id }); }, true]]); },
  member: el => profileModal(el.dataset.id),
  settings: () => settingsModal(),
  mute: () => toggleMute(), deaf: () => toggleDeaf(),
  burger: () => document.body.classList.toggle('nav'),
  togmembers: () => { P.members = !P.members; savePrefs(); renderTop(); },
  pins: e => { S.showPins = !S.showPins; renderMsgs(); },
  clearsearch: () => { S.search = null; S.searchQ = ''; renderTop(); renderMsgs(); },
  ftab: el => { S.tab = el.dataset.id; renderFriends(); },
  sendreq: () => { const v = $('#addName').value; if (v) send('addFriend', { name: v }); $('#addName').value = ''; },
  accept: el => send('acceptFriend', { uid: el.dataset.id, accept: true }),
  decline: el => send('acceptFriend', { uid: el.dataset.id, accept: false }),
  rmfriend: el => { if (confirm('Remove friend?')) send('removeFriend', { uid: el.dataset.id }); },
  callDM: el => { if (call.room) leaveCall(); send('joinVoice', { room: S.cur.ch, video: !!el.dataset.video }); call.wantVideo = !!el.dataset.video; },
  react: el => send('react', { ch: S.cur.ch, id: el.dataset.mid, emoji: el.dataset.e }),
  rpick: (el, e) => pickEmoji(el, em => send('react', { ch: S.cur.ch, id: el.dataset.mid, emoji: em })),
  reply: el => { S.replyTo = el.dataset.mid; renderReply(); input.focus(); },
  cancelreply: () => { S.replyTo = null; renderReply(); },
  edit: el => editMsg(el.dataset.mid),
  pin: el => send('pin', { ch: S.cur.ch, id: el.dataset.mid }),
  del: el => send('del', { ch: S.cur.ch, id: el.dataset.mid }),
  vote: el => send('vote', { ch: S.cur.ch, id: el.dataset.mid, opt: +el.dataset.i }),
  jump: el => { const t = document.querySelector(`[data-mid="${el.dataset.id}"]`); if (t) { t.scrollIntoView({ block: 'center' }); t.style.background = 'rgba(124,92,255,.25)'; setTimeout(() => t.style.background = '', 1200); } },
  zoom: el => modal(`<img src="${esc(el.src)}" style="max-width:100%;border-radius:10px">`, true),
  // call controls
  cmute: () => toggleMute(), cdeaf: () => toggleDeaf(), ccam: () => toggleCam(), cscreen: () => toggleScreen(), chang: () => leaveCall(),
  openCall: () => { if (call.room.startsWith('dm:')) go('dm', dmPeer(call.room)); else { const s = Object.values(S.servers).find(s => s.channels.some(c => c.id === call.room)); if (s) { if (S.cur.sid !== s.id) go('server', s.id); goChannel(call.room); } } },
};
document.addEventListener('click', e => {
  if (!e.target.closest('#picker') && !e.target.closest('[data-act=rpick]') && e.target.id !== 'emojiBtn') $('#picker').classList.add('hidden');
  $('#ctx').classList.add('hidden');
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('contextmenu', e => {
  const m = e.target.closest('.msg'); const c = e.target.closest('[data-cid]');
  if (m) { e.preventDefault(); const id = m.dataset.mid, mine = (S.msgs[S.cur.ch] || []).find(x => x.id === id)?.uid === S.me.id; ctx(e.clientX, e.clientY, [['Reply', () => { S.replyTo = id; renderReply(); }], ['Pin / Unpin', () => send('pin', { ch: S.cur.ch, id })], ['Copy Text', () => navigator.clipboard?.writeText((S.msgs[S.cur.ch] || []).find(x => x.id === id)?.text || '')], ...(mine ? [['Edit', () => editMsg(id)], ['Delete', () => send('del', { ch: S.cur.ch, id }), true]] : [])]); }
});
function ctx(x, y, items) {
  const c = $('#ctx'); c.innerHTML = ''; c.classList.remove('hidden');
  items.forEach(([t, fn, red]) => { const d = document.createElement('div'); d.textContent = t; if (red) d.className = 'red'; d.onclick = () => { fn(); }; c.append(d); });
  c.style.left = Math.min(x, innerWidth - 200) + 'px'; c.style.top = Math.min(y, innerHeight - items.length * 36 - 20) + 'px';
}
function modal(html, plain) {
  const o = $('#overlay'); o.innerHTML = plain ? html : `<div class="modal">${html}</div>`; o.classList.remove('hidden');
  o.onclick = e => { if (e.target === o) closeModal(); };
}
const closeModal = () => { $('#overlay').classList.add('hidden'); $('#overlay').innerHTML = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#overlay').classList.contains('hidden')) closeModal(); });

// ================= modals =================
function serverModal() {
  modal(`<h2>Create or join a server</h2><p class="muted">Your server is where you and your friends hang out.</p>
  <label>Create a server</label><input id="sName" placeholder="Server name" maxlength="32"><div class="row" style="margin-top:8px"><button class="btn primary" id="sCreate">Create</button></div>
  <label>Or join with an invite code</label><input id="sCode" placeholder="e.g. HQ or 9F2A11CC"><div class="row" style="margin-top:8px"><button class="btn primary" id="sJoin">Join Server</button></div>
  <p class="muted small">Tip: the public starter server's invite code is <b>HQ</b>.</p>`);
  $('#sCreate').onclick = () => { send('createServer', { name: $('#sName').value || `${S.me.name}'s server` }); closeModal(); };
  $('#sJoin').onclick = () => { send('joinServer', { code: $('#sCode').value }); closeModal(); };
}
function channelModal(type) {
  modal(`<h2>Create ${type} channel</h2><label>Channel name</label><input id="chName" maxlength="32" placeholder="new-channel"><div class="row"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="chOk">Create</button></div>`);
  $('#chOk').onclick = () => { send('addChannel', { sid: S.cur.sid, name: $('#chName').value, type }); closeModal(); };
}
function inviteModal() {
  const s = curServer();
  modal(`<h2>Invite friends to ${esc(s.name)}</h2><p class="muted">Share this code or link. Anyone with it can join.</p><label>Invite code</label><input readonly value="${esc(s.invite)}" id="invCode"><label>Link</label><input readonly value="${esc(location.origin + '/?invite=' + s.invite)}" id="invLink">
  <div class="row">${s.owner === S.me.id ? '<button class="btn" id="invNew">New code</button>' : ''}<button class="btn primary" id="invCopy">Copy link</button></div>`);
  $('#invCopy').onclick = () => { navigator.clipboard?.writeText($('#invLink').value); toast('Link copied!'); };
  if ($('#invNew')) $('#invNew').onclick = () => { send('newInvite', { sid: s.id }); closeModal(); };
}
function serverSettings() {
  const s = curServer();
  modal(`<h2>Server Settings</h2><label>Name</label><input id="ssName" value="${esc(s.name)}"><label>Topic</label><input id="ssTopic" value="${esc(s.topic)}" maxlength="200"><label>Icon</label><input type="file" id="ssIcon" accept="image/*"><label>Color</label><input type="color" id="ssColor" value="${esc(s.color.length === 7 ? s.color : '#7c5cff')}">
  <label>Members (click to kick)</label><div>${s.members.filter(m => m !== S.me.id).map(m => `<div class="frow" style="padding:4px"><span class="grow">${esc(uOf(m).name)}</span><button class="btn sm danger" data-kick="${esc(m)}">Kick</button></div>`).join('') || '<span class="muted small">Just you.</span>'}</div>
  <div class="row"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="ssOk">Save</button></div>`);
  $('#overlay').querySelectorAll('[data-kick]').forEach(b => b.onclick = () => { send('kick', { sid: s.id, uid: b.dataset.kick }); b.closest('.frow').remove(); });
  $('#ssOk').onclick = async () => { const f = $('#ssIcon').files[0]; send('updateServer', { id: s.id, name: $('#ssName').value, topic: $('#ssTopic').value, color: $('#ssColor').value, ...(f ? { icon: await shrink(f, 128, .85) } : {}) }); closeModal(); };
}
function profileModal(id) {
  const u = uOf(id), isF = S.friends.includes(id), me = id === S.me.id;
  modal(`<div class="banner" style="background:${esc(u.color)}"></div><div style="margin-top:-40px;padding-left:8px">${avatar(u, 'lg', true)}</div><h2 style="margin:10px 0 0;color:${esc(u.color)}">${esc(u.name)}</h2><div class="muted">${esc(u.custom || u.status)}</div>${u.bio ? `<div class="card"><b class="small muted">ABOUT ME</b><div>${esc(u.bio)}</div></div>` : ''}
  <div class="row" style="justify-content:flex-start">${me ? '<button class="btn primary" id="pEdit">Edit Profile</button>' : `<button class="btn primary" id="pMsg">Message</button>${isF ? '' : '<button class="btn" id="pAdd">Add Friend</button>'}`}</div>`);
  if ($('#pMsg')) $('#pMsg').onclick = () => { closeModal(); send('openDM', { uid: id }); };
  if ($('#pAdd')) $('#pAdd').onclick = () => { send('addFriend', { name: u.name }); closeModal(); };
  if ($('#pEdit')) $('#pEdit').onclick = () => settingsModal('account');
}

function settingsModal(tab = 'account') {
  const tabs = [['account', '👤 My Account'], ['appearance', '🎨 Appearance'], ['voice', '🎙 Voice & Video'], ['notif', '🔔 Notifications'], ['out', '🚪 Log Out']];
  modal(`<div class="modal wide"><div class="snav">${tabs.map(([k, n]) => `<div class="item ${k === tab ? 'on' : ''}" data-tab="${k}">${n}</div>`).join('')}</div><div class="spane" id="spane"></div></div>`, true);
  $('#overlay').querySelectorAll('[data-tab]').forEach(el => el.onclick = () => settingsModal(el.dataset.tab));
  const pane = $('#spane'), set = (k, v) => { P[k] = v; savePrefs(); };
  const sw = (k, label) => `<div class="line"><span>${label}</span><div class="switch ${P[k] ? 'on' : ''}" data-sw="${k}"></div></div>`;
  const wireSw = () => pane.querySelectorAll('[data-sw]').forEach(el => el.onclick = () => { set(el.dataset.sw, !P[el.dataset.sw]); el.classList.toggle('on'); renderTop(); });
  if (tab === 'account') {
    const u = S.me;
    pane.innerHTML = `<h2>My Account</h2><div class="card" style="display:flex;gap:16px;align-items:center">${avatar(u, 'lg')}<div><b style="font-size:20px;color:${esc(u.color)}">${esc(u.name)}</b><div><button class="btn sm" id="avUp">Change avatar</button> <button class="btn sm" id="avRm">Remove</button></div><input type="file" id="avFile" accept="image/*" class="hidden"></div></div>
    <label class="muted small">STATUS</label><select id="stSel">${[['online', '🟢 Online'], ['idle', '🟡 Idle'], ['dnd', '🔴 Do Not Disturb'], ['invisible', '⚪ Invisible']].map(([v, n]) => `<option value="${v}" ${u.status === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <label class="muted small" style="display:block;margin-top:14px">CUSTOM STATUS</label><input id="cust" maxlength="60" value="${esc(u.custom)}" placeholder="What's up?">
    <label class="muted small" style="display:block;margin-top:14px">ABOUT ME</label><textarea id="bio" rows="3" maxlength="190">${esc(u.bio)}</textarea>
    <label class="muted small" style="display:block;margin-top:14px">NAME COLOR</label><div class="swatches">${['#7c5cff', '#5865f2', '#ff4fa3', '#2ec4b6', '#ff8a3d', '#3ddc84', '#ff5b6b', '#37a9ff', '#ffd166', '#c77dff'].map(c => `<div class="sw ${u.color === c ? 'on' : ''}" data-nc="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="ncCustom" value="${esc(u.color.length === 7 ? u.color : '#7c5cff')}"></div>
    <div class="row"><button class="btn primary" id="accSave">Save Changes</button></div>`;
    let color = u.color, avatarData;
    pane.querySelectorAll('[data-nc]').forEach(el => el.onclick = () => { color = el.dataset.nc; pane.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === el)); });
    $('#ncCustom').oninput = e => color = e.target.value;
    $('#avUp').onclick = () => $('#avFile').click();
    $('#avFile').onchange = async e => { avatarData = await shrink(e.target.files[0], 256, .85); toast('Avatar selected — press Save.'); };
    $('#avRm').onclick = () => { avatarData = null; toast('Avatar will be removed — press Save.'); };
    $('#accSave').onclick = () => { send('profile', { status: $('#stSel').value, custom: $('#cust').value, bio: $('#bio').value, color, ...(avatarData !== undefined ? { avatar: avatarData } : {}) }); toast('Saved!'); };
  } else if (tab === 'appearance') {
    pane.innerHTML = `<h2>Appearance</h2>
    <label class="muted small">THEME</label><div class="swatches">${Object.entries(THEMES).map(([n, t]) => `<div class="themebox ${P.theme === n ? 'on' : ''}" data-theme="${n}" style="background:rgb(${t.c[2]});color:${t.text}">${n}</div>`).join('')}</div>
    <label class="muted small" style="display:block;margin-top:18px">ACCENT COLOR</label><div class="swatches">${ACCENTS.map(c => `<div class="sw ${P.accent === c ? 'on' : ''}" data-acc="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="accC" value="${P.accent}"></div>
    <label class="muted small" style="display:block;margin-top:18px">TEXT COLOR</label><div class="swatches"><div class="sw ${!P.textColor ? 'on' : ''}" data-tc="" style="background:linear-gradient(135deg,#fff 50%,#222 50%)" title="Theme default"></div>${['#ffffff', '#ffd166', '#7dffb2', '#7fd4ff', '#ffa6e7', '#ff9a8b', '#111111'].map(c => `<div class="sw ${P.textColor === c ? 'on' : ''}" data-tc="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="tcC" value="${P.textColor || '#ffffff'}"></div>
    <label class="muted small" style="display:block;margin-top:18px">BACKGROUND</label>
    <div class="tabs" style="margin:6px 0">${['none', 'color', 'gradient', 'image'].map(t => `<div class="tab ${P.bgType === t ? 'on' : ''}" data-bg="${t}">${t[0].toUpperCase() + t.slice(1)}</div>`).join('')}</div>
    ${P.bgType === 'color' ? `<input type="color" id="bgC" value="${P.bgColor}">` : ''}
    ${P.bgType === 'gradient' ? `<div class="swatches">${GRADS.map((g, i) => `<div class="sw ${P.bgGrad === g ? 'on' : ''}" data-grad="${i}" style="background:${g};width:70px"></div>`).join('')}</div>` : ''}
    ${P.bgType === 'image' ? `<button class="btn" id="bgUp">Upload image…</button> <input type="file" id="bgFile" accept="image/*" class="hidden"> <span class="muted small">${P.bgImage ? 'Image set.' : 'Pick any picture (a URL works too):'}</span><input id="bgUrl" placeholder="…or paste an image URL" style="margin-top:8px" value="${P.bgImage.startsWith('http') ? esc(P.bgImage) : ''}">` : ''}
    ${P.bgType !== 'none' ? `<div class="line"><span>Panel opacity</span><input type="range" id="alpha" min="20" max="100" value="${P.alpha}" style="width:180px"></div><div class="line"><span>Background blur</span><input type="range" id="blur" min="0" max="30" value="${P.blur}" style="width:180px"></div>` : ''}
    <div class="line"><span>Font size</span><input type="range" id="fs" min="12" max="22" value="${P.fs}" style="width:180px"></div>
    <div class="line"><span>Corner roundness</span><input type="range" id="rad" min="0" max="28" value="${P.radius}" style="width:180px"></div>
    <div class="line"><span>Font</span><select id="fontSel" style="width:180px">${Object.keys(FONTS).map(f => `<option ${P.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
    ${sw('compact', 'Compact message layout')}
    <div class="row" style="justify-content:flex-start"><button class="btn" id="resetAp">Reset appearance</button></div>`;
    const re = () => settingsModal('appearance');
    pane.querySelectorAll('[data-theme]').forEach(el => el.onclick = () => { set('theme', el.dataset.theme); re(); });
    pane.querySelectorAll('[data-acc]').forEach(el => el.onclick = () => { set('accent', el.dataset.acc); re(); });
    $('#accC').oninput = e => set('accent', e.target.value);
    pane.querySelectorAll('[data-tc]').forEach(el => el.onclick = () => { set('textColor', el.dataset.tc); re(); });
    $('#tcC').oninput = e => set('textColor', e.target.value);
    pane.querySelectorAll('[data-bg]').forEach(el => el.onclick = () => { set('bgType', el.dataset.bg); re(); });
    pane.querySelectorAll('[data-grad]').forEach(el => el.onclick = () => { set('bgGrad', GRADS[el.dataset.grad]); re(); });
    if ($('#bgC')) $('#bgC').oninput = e => set('bgColor', e.target.value);
    if ($('#bgUp')) { $('#bgUp').onclick = () => $('#bgFile').click(); $('#bgFile').onchange = async e => { set('bgImage', await shrink(e.target.files[0], 1600, .7)); re(); }; $('#bgUrl').onchange = e => { set('bgImage', e.target.value.trim()); re(); }; }
    const rg = (id, k) => { if ($(id)) $(id).oninput = e => set(k, +e.target.value); };
    rg('#alpha', 'alpha'); rg('#blur', 'blur'); rg('#fs', 'fs'); rg('#rad', 'radius');
    $('#fontSel').onchange = e => set('font', e.target.value);
    $('#resetAp').onclick = () => { P = Object.assign({}, DEF); savePrefs(); re(); };
    wireSw();
  } else if (tab === 'voice') {
    pane.innerHTML = `<h2>Voice & Video</h2><label class="muted small">MICROPHONE</label><select id="micSel"></select><label class="muted small" style="display:block;margin-top:14px">CAMERA</label><select id="camSel"></select>
    <div class="line"><span>Echo cancellation & noise suppression</span><div class="switch ${call.dsp ? 'on' : ''}" id="dspSw"></div></div><p class="muted small">Changes apply the next time you join a call. Browsers only show device names after you've granted mic/camera permission once.</p><button class="btn" id="testMic">Grant access / refresh devices</button>`;
    const fill = async () => { try { const d = await navigator.mediaDevices.enumerateDevices(); const f = (kind, el, key) => { $(el).innerHTML = '<option value="">Default</option>' + d.filter(x => x.kind === kind).map(x => `<option value="${esc(x.deviceId)}" ${P[key] === x.deviceId ? 'selected' : ''}>${esc(x.label || kind)}</option>`).join(''); $(el).onchange = e => set(key, e.target.value); }; f('audioinput', '#micSel', 'mic'); f('videoinput', '#camSel', 'cam'); } catch { } };
    fill();
    $('#testMic').onclick = async () => { try { (await navigator.mediaDevices.getUserMedia({ audio: true, video: true })).getTracks().forEach(t => t.stop()); } catch (e) { toast('Could not access devices: ' + e.message); } fill(); };
    $('#dspSw').onclick = e => { call.dsp = !call.dsp; e.target.classList.toggle('on'); set('dsp', call.dsp); };
  } else if (tab === 'notif') {
    pane.innerHTML = `<h2>Notifications</h2>${sw('sound', 'Play sounds for new messages')}${sw('desk', 'Desktop notifications for DMs & mentions')}<button class="btn" id="askN">Allow desktop notifications</button>`;
    $('#askN').onclick = () => window.Notification ? Notification.requestPermission().then(p => toast('Permission: ' + p)) : toast('Not supported in this browser');
    wireSw();
  } else if (tab === 'out') {
    pane.innerHTML = `<h2>Log Out</h2><p class="muted">You'll need your password to log back in.</p><button class="btn danger" id="logout">Log Out</button>`;
    $('#logout').onclick = () => { try { localStorage.removeItem('nimbus_token'); } catch { } location.reload(); };
  }
}

// ================= voice / video calls (WebRTC mesh) =================
const call = { room: '', peers: {}, local: null, mute: false, deaf: false, cam: null, screen: null, dsp: P.dsp !== false, wantVideo: false, speaking: {} };
const RTC_CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }] };

async function startCall(room, existing) {
  call.room = room; call.peers = {}; call.mute = call.deaf = false;
  const dsp = call.dsp;
  try { call.local = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: P.mic ? { ideal: P.mic } : undefined, echoCancellation: dsp, noiseSuppression: dsp, autoGainControl: dsp } }); }
  catch (e) { call.local = null; toast('Mic unavailable (' + (e.name || 'error') + ') — joined as listener.'); }
  if (call.local) watchLevel(call.local, S.me.id);
  existing.forEach(id => makePeer(id, true));
  beep(760, .08);
  renderAll();
  if (call.wantVideo) { call.wantVideo = false; toggleCam(); }
}
function syncPeers(users) {
  for (const id of Object.keys(call.peers)) if (!users.includes(id)) closePeer(id);
  renderDock();
}
function makePeer(id, initiator) {
  if (call.peers[id]) return call.peers[id];
  const pc = new RTCPeerConnection(RTC_CFG);
  const p = call.peers[id] = { id, pc, stream: new MediaStream(), polite: S.me.id < id, making: false, ignore: false, pending: [], remote: { cam: false, screen: false } };
  // Fixed slots (audio, camera, screen) so toggling media never needs renegotiation: the joiner offers them, tracks are swapped with replaceTrack.
  if (initiator) { pc.addTransceiver('audio', { direction: 'sendrecv' }); pc.addTransceiver('video', { direction: 'sendrecv' }); pc.addTransceiver('video', { direction: 'sendrecv' }); applyLocal(p); }
  pc.onicecandidate = e => e.candidate && send('signal', { to: id, data: { ice: e.candidate } });
  pc.onnegotiationneeded = async () => {
    try { p.making = true; await pc.setLocalDescription(); send('signal', { to: id, data: { desc: pc.localDescription } }); } catch (e) { console.warn(e); } finally { p.making = false; }
  };
  pc.ontrack = e => {
    if (e.track.kind === 'audio') { p.stream.addTrack(e.track); watchLevel(p.stream, id); }
    e.track.onmute = e.track.onunmute = e.track.onended = () => { pickVideo(p); renderDock(); };
    pickVideo(p); renderDock();
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); if (pc.connectionState === 'connected') sendMedia(id); };
  return p;
}
async function onSignal(from, data) {
  if (!call.room) return;
  const p = makePeer(from, false);
  try {
    if (data.state) { p.remote = data.state; pickVideo(p); renderDock(); }
    else if (data.desc) {
      const collision = data.desc.type === 'offer' && (p.making || p.pc.signalingState !== 'stable');
      p.ignore = !p.polite && collision; if (p.ignore) return;
      await p.pc.setRemoteDescription(data.desc);
      if (data.desc.type === 'offer') { p.pc.getTransceivers().forEach(t => { if (t.currentDirection !== 'stopped') t.direction = 'sendrecv'; }); applyLocal(p); }
      for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => { });
      if (data.desc.type === 'offer') { await p.pc.setLocalDescription(); send('signal', { to: from, data: { desc: p.pc.localDescription } }); }
    } else if (data.ice) {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(e => { if (!p.ignore) console.warn(e); }); else p.pending.push(data.ice);
    }
  } catch (e) { console.warn(e); }
}
function closePeer(id) { const p = call.peers[id]; if (p) { p.pc.close(); delete call.peers[id]; } delete call.speaking[id]; }
function leaveCall() {
  if (!call.room) return;
  send('leaveVoice'); Object.keys(call.peers).forEach(closePeer);
  [call.local, call.cam, call.screen].forEach(s => s && s.getTracks().forEach(t => t.stop()));
  call.local = call.cam = call.screen = null; call.room = ''; call.mute = call.deaf = false;
  beep(380, .1); renderAll();
}
const slots = p => { const t = p.pc.getTransceivers(), v = t.filter(x => x.receiver.track.kind === 'video'); return { audio: t.find(x => x.receiver.track.kind === 'audio'), cam: v[0], screen: v[1] }; };
function applyLocal(p) {
  const s = slots(p), swap = (tr, track) => tr && tr.sender.replaceTrack(track || null).catch(() => { });
  swap(s.audio, call.local && call.local.getAudioTracks()[0]);
  swap(s.cam, call.cam && call.cam.getVideoTracks()[0]);
  swap(s.screen, call.screen && call.screen.getVideoTracks()[0]);
}
function pickVideo(p) { // show the peer's screen share if live, otherwise their camera
  const s = slots(p), live = (tr, on) => tr && on && tr.receiver.track.readyState === 'live' ? tr.receiver.track : null;
  const want = live(s.screen, p.remote.screen) || live(s.cam, p.remote.cam);
  p.stream.getVideoTracks().forEach(t => t !== want && p.stream.removeTrack(t));
  if (want && !p.stream.getTracks().includes(want)) p.stream.addTrack(want);
}
const sendMedia = to => send('signal', { to, data: { state: { cam: !!call.cam, screen: !!call.screen } } });
const setSenders = () => Object.values(call.peers).forEach(p => { applyLocal(p); sendMedia(p.id); });
async function toggleCam() {
  if (!call.room) return toast('Join a call first.');
  if (call.cam) { call.cam.getTracks().forEach(t => t.stop()); call.cam = null; setSenders(); }
  else { try { call.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: P.cam ? { ideal: P.cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } }); setSenders(); } catch (e) { toast('Camera unavailable: ' + e.name); } }
  renderDock();
}
async function toggleScreen() {
  if (!call.room) return toast('Join a call first.');
  if (call.screen) { call.screen.getTracks().forEach(t => t.stop()); call.screen = null; setSenders(); }
  else {
    if (!navigator.mediaDevices.getDisplayMedia) return toast('Screen sharing is not supported in this browser.');
    try { call.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); call.screen.getVideoTracks()[0].onended = () => { if (call.screen) toggleScreen(); }; setSenders(); } catch { }
  }
  renderDock();
}
function toggleMute() { if (!call.room) { call.mute = !call.mute; } else { call.mute = !call.mute; } if (call.local) call.local.getAudioTracks().forEach(t => t.enabled = !call.mute); renderUserPanel(); renderDock(); }
function toggleDeaf() { call.deaf = !call.deaf; if (call.deaf && !call.mute) toggleMute(); renderUserPanel(); renderDock(); }
let actx;
function watchLevel(stream, id) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    if (!stream.getAudioTracks().length) return;
    const an = actx.createAnalyser(); an.fftSize = 512; actx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const tick = () => {
      if (!call.room || (id !== S.me.id && !call.peers[id])) { delete call.speaking[id]; return; }
      an.getByteFrequencyData(buf); const lvl = buf.reduce((a, b) => a + b, 0) / buf.length;
      const on = lvl > 14 && !(id === S.me.id && call.mute);
      if (!!call.speaking[id] !== on) { call.speaking[id] = on; document.querySelectorAll(`[data-tile="${id}"]`).forEach(t => t.classList.toggle('speak', on)); document.querySelectorAll(`[data-vu="${id}"] .av`).forEach(t => t.classList.toggle('speaking', on)); }
      setTimeout(tick, 120);
    };
    tick();
  } catch { }
}
function renderDock() {
  const dock = $('#dock');
  const inRoomView = call.room && ((S.cur.type === 'dm' && S.cur.ch === call.room) || (S.cur.type === 'server' && S.cur.ch === call.room));
  const voiceView = S.cur.type === 'server' && isVoiceCh();
  if (voiceView && !call.room) {
    dock.className = ''; dock.innerHTML = `<div class="sys" style="margin:auto"><h2>🔊 ${esc(chanName(S.cur.ch))}</h2><p>${(S.voice[S.cur.ch] || []).length} in voice. Join to talk, share your camera or your screen.</p><button class="btn primary" data-act="ch" data-id="${esc(S.cur.ch)}">Join Voice</button></div>`;
    dock.querySelector('button').onclick = () => send('joinVoice', { room: S.cur.ch }); return;
  }
  if (!inRoomView) { dock.classList.add('hidden'); renderVoiceBar(); return; }
  dock.className = voiceView ? '' : 'half';
  const ids = [S.me.id, ...Object.keys(call.peers)];
  const tile = id => {
    const u = uOf(id), st = id === S.me.id ? [call.screen, call.cam].find(Boolean) : call.peers[id]?.stream;
    const vid = st && st.getVideoTracks().length > 0;
    return `<div class="tile ${vid ? '' : 'novid'} ${call.speaking[id] ? 'speak' : ''}" data-tile="${esc(id)}">${avatar(u)}<video autoplay playsinline ${id === S.me.id ? 'muted' : ''}></video><div class="label">${esc(u.name)}${id === S.me.id && call.mute ? ' 🔇' : ''}</div></div>`;
  };
  const keep = dock.querySelector('#grid'), sig = ids.join() + [call.cam, call.screen].map(Boolean) + ids.map(i => (i === S.me.id ? '' : call.peers[i]?.stream.getVideoTracks().map(t => t.id).join())).join('|');
  if (!keep || keep.dataset.sig !== sig) {
    dock.innerHTML = `<div id="grid" data-sig="${esc(sig)}">${ids.map(tile).join('')}</div><div id="ctrls"></div>`;
    ids.forEach(id => { const v = dock.querySelector(`[data-tile="${CSS.escape(id)}"] video`); const st = id === S.me.id ? [call.screen, call.cam].find(Boolean) : call.peers[id]?.stream; if (v && st) { v.srcObject = st; v.muted = id === S.me.id || call.deaf; v.play?.().catch(() => { }); } });
  }
  dock.querySelectorAll('video').forEach((v, i) => { if (ids[i] !== S.me.id) v.muted = call.deaf; });
  $('#ctrls').innerHTML = `<button data-act="cmute" class="${call.mute ? 'off' : ''}" title="Mute">${call.mute ? '🔇' : '🎤'}</button><button data-act="cdeaf" class="${call.deaf ? 'off' : ''}" title="Deafen">🎧</button><button data-act="ccam" class="${call.cam ? 'off' : ''}" title="Camera">🎥</button><button data-act="cscreen" class="${call.screen ? 'off' : ''}" title="Share screen">🖥</button><button data-act="chang" class="hang" title="Leave call">📞</button>`;
  renderVoiceBar();
}
function renderVoiceBar() {
  const b = $('#voiceBar');
  if (!call.room) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.innerHTML = `<div class="t" data-act="openCall">● Voice Connected</div><div class="muted small">${esc(chanName(call.room))}</div><div style="display:flex;gap:4px;margin-top:4px"><button class="icon ${call.cam ? 'on' : ''}" data-act="ccam" title="Camera">🎥</button><button class="icon ${call.screen ? 'on' : ''}" data-act="cscreen" title="Share screen">🖥</button><button class="icon off" data-act="chang" title="Disconnect">📞</button></div>`;
}
function ringModal(d) {
  if (call.room) return;
  let n = 0; const iv = setInterval(() => { if ($('#overlay').querySelector('.ring')) beep(840, .15); else clearInterval(iv); if (++n > 20) { clearInterval(iv); closeModal(); } }, 1200);
  modal(`<div class="ring">${avatar(d.from, 'lg')}<h2>${esc(d.from.name)} is calling…</h2><p class="muted">${d.video ? 'Video call' : 'Voice call'}</p><div class="row" style="justify-content:center"><button class="btn danger" id="rDec">Decline</button><button class="btn primary" id="rAcc">Accept</button></div></div>`);
  $('#rDec').onclick = () => { clearInterval(iv); closeModal(); };
  $('#rAcc').onclick = () => { clearInterval(iv); closeModal(); go('dm', d.from.id); call.wantVideo = d.video; send('joinVoice', { room: d.room }); };
}

// ================= auth UI =================
function setAuthMode(m) {
  authMode = m; const reg = m === 'register';
  $('#authTitle').textContent = reg ? 'Create an account' : 'Welcome back!'; $('#authSub').textContent = reg ? 'Join the party — it takes 10 seconds.' : "We're so excited to see you again.";
  $('#authBtn').textContent = reg ? 'Continue' : 'Log In'; $('#authSwitchText').textContent = reg ? 'Already have an account?' : 'Need an account?'; $('#authSwitch').textContent = reg ? 'Log In' : 'Register';
  $('#authPass').autocomplete = reg ? 'new-password' : 'current-password'; $('#authErr').textContent = '';
}
$('#authSwitch').onclick = e => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'register' : 'login'); };
$('#authForm').onsubmit = e => { e.preventDefault(); send(authMode, { name: $('#authName').value, pass: $('#authPass').value }); };

// invite links
const inv = new URLSearchParams(location.search).get('invite');
if (inv) { const old = H.init; H.init = d => { old(d); send('joinServer', { code: inv }); history.replaceState({}, '', '/'); H.init = old; }; }

setInterval(renderTyping, 1500);
window.addEventListener('beforeunload', () => { try { ws.close(); } catch { } });
connect();

