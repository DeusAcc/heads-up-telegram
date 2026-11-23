const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server/server');
const { demoTransport } = require('../server/telegram');
const { pageFor, digestScreen } = require('./screens-shim');

const brain = {
  digest: async (title, msgs) => ({ lines: [msgs[msgs.length - 1].text.slice(0, 34)], importance: title === 'Dev' ? 9 : 2, needsReply: true, draft: 'ok' }),
  transcribe: async () => 'tell them yes',
  polishReply: async () => 'Yes, I am in.',
};
const msg = (id, chat, from, text) => ({ update_id: id, message: { message_id: id, chat, from, text } });

async function setup() {
  const transport = demoTransport();
  const app = createApp({ transport, brain });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (p, b) => (await fetch(base + p, b ? { method: 'POST', body: JSON.stringify(b) } : undefined)).json();
  return { app, transport, api, close: () => app.server.close() };
}

test('pair → digest sorted by importance → send writes to the right chat, replying to the last message', async () => {
  const { app, transport, api, close } = await setup();
  const s = await api('/api/session', {});
  assert.equal((await api(`/api/digest?sid=${s.sid}`)).paired, false);
  await app.onUpdate(msg(1, { id: 1, type: 'private' }, { id: 42 }, `/pair ${s.code}`));
  await app.onUpdate(msg(2, { id: -1, type: 'group', title: 'Family' }, { id: 7, first_name: 'Mum' }, 'dinner?'));
  await app.onUpdate(msg(3, { id: -2, type: 'group', title: 'Dev' }, { id: 8, first_name: 'Marta' }, 'rollback?'));
  const d = await api(`/api/digest?sid=${s.sid}`);
  assert.equal(d.paired, true);
  assert.deepEqual(d.items.map((i) => i.title), ['Dev', 'Family']);
  const sent = await api('/api/send', { sid: s.sid, id: d.items[0].id, text: 'approved' });
  assert.equal(sent.sent, true);
  assert.equal(transport.outbox.at(-1).chatId, -2);
  assert.equal(transport.outbox.at(-1).replyTo, 3);
  assert.deepEqual((await api(`/api/digest?sid=${s.sid}`)).items.map((i) => i.title), ['Family']);
  close();
});

test('a wrong session id or code is refused; private chats are never digested', async () => {
  const { app, api, close } = await setup();
  assert.match((await api('/api/digest?sid=nope')).error, /unknown session/);
  const s = await api('/api/session', {});
  await app.onUpdate(msg(1, { id: 1, type: 'private' }, { id: 42 }, '/pair 000000'));
  assert.equal((await api(`/api/digest?sid=${s.sid}`)).paired, false);
  await app.onUpdate(msg(2, { id: 1, type: 'private' }, { id: 42 }, 'secret chat'));
  assert.equal(app.chats.size, 0);
  close();
});

test('voice: pcm → transcript → polished draft, and nothing is sent until the user confirms', async () => {
  const { app, transport, api, close } = await setup();
  const s = await api('/api/session', {});
  await app.onUpdate(msg(1, { id: 1, type: 'private' }, { id: 42 }, `/pair ${s.code}`));
  await app.onUpdate(msg(2, { id: -2, type: 'group', title: 'Dev' }, { id: 8, first_name: 'Marta' }, 'coming?'));
  const [item] = (await api(`/api/digest?sid=${s.sid}`)).items;
  const r = await api('/api/voice', { sid: s.sid, id: item.id, pcm: Buffer.alloc(6400).toString('base64') });
  assert.equal(r.draft, 'Yes, I am in.');
  assert.equal(transport.outbox.length, 1);  // only the "Paired ✓" confirmation
  close();
});

test('glasses pages respect device limits: 3 containers, one event capture, unique z-order, ≤3 body lines', () => {
  const p = pageFor(digestScreen({ title: 'A very long group title that overflows', n: 12, lines: ['a', 'b', 'c', 'd'] }, 0, 2));
  assert.equal(p.textObject.length, 3);
  assert.equal(p.textObject.filter((t) => t.isEventCapture === 1).length, 1);
  assert.equal(new Set(p.textObject.map((t) => t.zOrderIndex)).size, 3);
  assert.ok(p.textObject[1].content.split('\n').length <= 3);
  assert.ok(p.textObject[0].content.length <= 45);
});
