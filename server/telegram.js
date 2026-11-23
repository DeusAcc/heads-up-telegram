// Telegram transport. Real mode: Bot API long polling. Demo mode (DEMO=1): same handler fed by POST /demo/update,
// sends are recorded in an outbox instead of leaving the machine.
const API = (t, m) => `https://api.telegram.org/bot${t}/${m}`;

function realTransport(token, onUpdate) {
  let stop = false, offset = 0;
  const call = async (m, body) => {
    const r = await fetch(API(token, m), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j.ok) throw new Error(`telegram ${m}: ${j.description}`);
    return j.result;
  };
  (async function loop() {
    while (!stop) {
      try {
        const ups = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const u of ups) { offset = u.update_id + 1; try { await onUpdate(u); } catch (e) { console.error('update', e.message); } }
      } catch (e) { console.error('poll', e.message); await new Promise((r) => setTimeout(r, 3000)); }
    }
  })();
  return {
    mode: 'telegram',
    me: () => call('getMe'),
    send: (chatId, text, replyTo) => call('sendMessage', { chat_id: chatId, text, reply_to_message_id: replyTo, allow_sending_without_reply: true }),
    isMember: async (chatId, userId) => { try { const m = await call('getChatMember', { chat_id: chatId, user_id: userId }); return !['left', 'kicked'].includes(m.status); } catch { return false; } },
    close: () => { stop = true; },
  };
}

function demoTransport() {
  const outbox = [];
  return {
    mode: 'demo', outbox,
    me: async () => ({ username: 'Deus_Flight_bot' }),
    send: async (chatId, text, replyTo) => { outbox.push({ at: new Date().toISOString(), chatId, text, replyTo }); return { message_id: 9000 + outbox.length }; },
    isMember: async () => true,
    close() {},
  };
}

module.exports = { realTransport, demoTransport };
