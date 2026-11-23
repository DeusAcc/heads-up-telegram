// Heads Up backend: Telegram groups -> 3-line digests + AI draft replies for Even G2 glasses.
// Privacy: messages live in RAM only (60 min TTL), nothing is written to disk, API keys never reach the app.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const llm = require('./llm');
const tg = require('./telegram');

const TTL_MS = 60 * 60 * 1000, PAIR_TTL_MS = 10 * 60 * 1000, MAX_MSGS = 40;

function createApp({ transport, brain = llm, now = () => Date.now() } = {}) {
  const chats = new Map();     // chatId -> {title, msgs[], users:Set}
  const sessions = new Map();  // sid -> {code, userId, createdAt, done:Set}
  const cache = new Map();     // `${chatId}:${lastId}` -> digest result (RAM)
  const clean = () => {
    for (const [id, c] of chats) { c.msgs = c.msgs.filter((m) => now() - m.at < TTL_MS); if (!c.msgs.length) chats.delete(id); }
    for (const [sid, s] of sessions) if (!s.userId && now() - s.createdAt > PAIR_TTL_MS) sessions.delete(sid);
  };

  async function onUpdate(u) {
    const m = u.message;
    if (!m || !m.text) return;
    const cmd = m.text.match(/^\/pair(?:@\w+)?\s+(\d{6})\b/);
    if (cmd) {
      const s = [...sessions.values()].find((x) => x.code === cmd[1] && !x.userId);
      if (s && m.from) { s.userId = m.from.id; await transport.send(m.chat.id, 'Paired ✓ — your glasses now get digests of the groups you are in.', m.message_id); }
      else await transport.send(m.chat.id, 'Unknown or expired code.', m.message_id);
      return;
    }
    if (m.chat.type === 'private') return;           // only groups are digested
    if (m.text.startsWith('/')) return;
    let c = chats.get(m.chat.id);
    if (!c) chats.set(m.chat.id, (c = { title: m.chat.title || String(m.chat.id), msgs: [], users: new Set() }));
    if (m.from) c.users.add(m.from.id);
    c.msgs.push({ id: m.message_id, from: m.from ? (m.from.first_name || m.from.username || 'someone') : 'someone', fromId: m.from && m.from.id, text: m.text.slice(0, 1000), at: now() });
    if (c.msgs.length > MAX_MSGS) c.msgs.shift();
  }

  const session = (sid) => { const s = sessions.get(sid); if (!s) throw Object.assign(new Error('unknown session'), { status: 401 }); return s; };

  async function digestFor(s) {
    clean();
    const items = [];
    for (const [chatId, c] of chats) {
      const last = c.msgs[c.msgs.length - 1];
      if (!last || last.fromId === s.userId) continue;                       // my own last word: nothing to answer
      if (!c.users.has(s.userId) && !(await transport.isMember(chatId, s.userId))) continue;
      const id = `${chatId}:${last.id}`;
      if (s.done.has(id)) continue;
      let d = cache.get(id);
      if (!d) { d = await brain.digest(c.title, c.msgs.slice(-20)); cache.set(id, d); }
      items.push({ id, chatId, title: c.title, replyTo: last.id, n: c.msgs.length, ...d });
    }
    return items.sort((a, b) => b.importance - a.importance);
  }

  async function api(method, url, body) {
    if (method === 'POST' && url === '/api/session') {
      const sid = crypto.randomBytes(16).toString('hex');
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      sessions.set(sid, { code, userId: null, createdAt: now(), done: new Set() });
      return { sid, code, bot: (await transport.me()).username };
    }
    if (method === 'GET' && url.pathname === '/api/digest') {
      const s = session(url.searchParams.get('sid'));
      if (!s.userId) return { paired: false, items: [] };
      return { paired: true, items: await digestFor(s) };
    }
    if (method === 'POST' && url === '/api/send') {
      const s = session(body.sid);
      const item = (await digestFor(s)).find((i) => i.id === body.id);
      const text = String(body.text || '').trim().slice(0, 500);
      if (!item || !text) throw Object.assign(new Error('item gone or empty text'), { status: 404 });
      await transport.send(item.chatId, text, item.replyTo);
      s.done.add(item.id);
      return { sent: true };
    }
    if (method === 'POST' && url === '/api/voice') {   // pcm16k mono s16le, base64 → transcript → polished draft (NOT sent: user confirms on glasses)
      const s = session(body.sid);
      const item = (await digestFor(s)).find((i) => i.id === body.id);
      if (!item) throw Object.assign(new Error('item gone'), { status: 404 });
      const pcm = Buffer.from(String(body.pcm || ''), 'base64');
      if (pcm.length < 3200) throw Object.assign(new Error('audio too short'), { status: 400 });
      const transcript = await brain.transcribe(pcm);
      const ctx = chats.get(item.chatId).msgs.slice(-6).map((m) => `${m.from}: ${m.text}`).join('\n');
      return { transcript, draft: await brain.polishReply(item.title, ctx, transcript) };
    }
    throw Object.assign(new Error('not found'), { status: 404 });
  }

  const WEB = path.join(__dirname, '..', 'web', 'dist');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.pcm': 'application/octet-stream' };
  const server = http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const send = (code, obj, type = 'application/json') => { res.writeHead(code, { ...cors, 'content-type': type }); res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
    try {
      if (url.pathname === '/api/health') return send(200, { ok: true, mode: transport.mode, chats: chats.size, sessions: sessions.size });
      let body = {};
      if (req.method === 'POST') { const parts = []; let n = 0; for await (const p of req) { n += p.length; if (n > 4e6) throw Object.assign(new Error('too big'), { status: 413 }); parts.push(p); } body = parts.length ? JSON.parse(Buffer.concat(parts)) : {}; }
      if (transport.mode === 'demo' && url.pathname.startsWith('/demo/')) {
        if (url.pathname === '/demo/update' && req.method === 'POST') { await onUpdate(body); return send(200, { ok: true }); }
        if (url.pathname === '/demo/outbox') return send(200, transport.outbox);
        if (url.pathname === '/demo/reset') { chats.clear(); sessions.clear(); cache.clear(); transport.outbox.length = 0; return send(200, { ok: true }); }
      }
      if (url.pathname.startsWith('/api/')) return send(200, await api(req.method, req.method === 'GET' ? url : url.pathname, body));
      const file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, ''));
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      send(404, { error: 'not found' });
    } catch (e) { send(e.status || 500, { error: e.message }); }
  });
  return { server, onUpdate, chats, sessions };
}

if (require.main === module) {
  const demo = process.env.DEMO === '1';
  let app;
  const transport = demo ? tg.demoTransport() : tg.realTransport(process.env.TELEGRAM_BOT_TOKEN, (u) => app.onUpdate(u));
  app = createApp({ transport });
  const port = Number(process.env.PORT || 8787);
  app.server.listen(port, '127.0.0.1', () => console.log(`heads-up backend on :${port} (${transport.mode})`));
}
module.exports = { createApp };
