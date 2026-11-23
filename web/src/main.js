import {
  waitForEvenAppBridge, OsEventTypeList, StartUpPageCreateResult, AudioInputSource,
} from '@evenrealities/even_hub_sdk';
import { pairScreen, emptyScreen, digestScreen, draftScreen, statusScreen, pageFor } from './screens.js';

const q = new URLSearchParams(location.search);
const API = (q.get('api') || location.origin).replace(/\/$/, '');   // backend base URL (whitelisted in app.json)
const FAKE_MIC = q.get('fakeMic');                                   // test hook: replay a recorded PCM file instead of the mic
const j = async (path, body) => {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await r.json(); if (!r.ok) throw new Error(out.error || r.status); return out;
};

const st = { sid: null, items: [], i: 0, mode: 'pair', draft: '', busy: false, pcm: [], created: false, bridge: null };

async function show(screen) {
  const page = pageFor(screen);
  if (!st.created) { st.created = (await st.bridge.createStartUpPageContainer(page)) === StartUpPageCreateResult.success; }
  else await st.bridge.rebuildPageContainer(page);
  console.log('screen', JSON.stringify(screen));
}
const cur = () => st.items[st.i];

async function refresh() {
  if (st.busy) return;
  const d = await j(`/api/digest?sid=${st.sid}`);
  if (!d.paired) return;
  const prev = cur() && cur().id;
  st.items = d.items;
  if (st.mode === 'pair' || st.mode === 'empty' || st.mode === 'digest') {
    st.i = Math.max(0, st.items.findIndex((x) => x.id === prev));
    if (!st.items.length) { st.mode = 'empty'; return show(emptyScreen()); }
    if (st.mode !== 'digest' || prev !== cur().id) { st.mode = 'digest'; return show(digestScreen(cur(), st.i, st.items.length)); }
  }
}

async function onSend() {
  st.busy = true;
  try {
    await show(statusScreen('Sending…', st.draft));
    await j('/api/send', { sid: st.sid, id: cur().id, text: st.draft });
    await show(statusScreen('Sent', `to ${cur().title}`));
    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) { await show(statusScreen('Not sent', e.message)); await new Promise((r) => setTimeout(r, 2000)); }
  st.busy = false; st.mode = 'digest'; await refresh(); if (st.mode === 'digest' && cur()) await show(digestScreen(cur(), st.i, st.items.length));
}

async function startVoice() {
  st.pcm = [];
  st.mode = 'listening';
  await show(statusScreen('Listening…', 'release to finish'));
  if (!FAKE_MIC) await st.bridge.audioControl(true, AudioInputSource.Glasses);
}
async function stopVoice() {
  st.busy = true;
  try {
    let b64;
    if (FAKE_MIC) { const buf = new Uint8Array(await (await fetch(FAKE_MIC)).arrayBuffer()); b64 = btoa(String.fromCharCode(...buf)); }
    else {
      await st.bridge.audioControl(false);
      const n = st.pcm.reduce((a, c) => a + c.length, 0), all = new Uint8Array(n); let o = 0;
      for (const c of st.pcm) { all.set(c, o); o += c.length; }
      b64 = btoa(Array.from(all, (x) => String.fromCharCode(x)).join(''));
    }
    await show(statusScreen('Understanding…', ''));
    const r = await j('/api/voice', { sid: st.sid, id: cur().id, pcm: b64 });
    st.draft = r.draft; st.mode = 'draft';
    await show(draftScreen(cur(), st.draft, 'tap: SEND  ·  hold: re-speak  ·  2×tap: back'));
  } catch (e) { st.mode = 'draft'; await show(draftScreen(cur(), st.draft, 'voice failed: ' + e.message.slice(0, 30))); }
  st.busy = false;
}

async function onInput(kind) {
  if (st.busy && kind !== 'longRelease') return;
  const items = st.items;
  if (st.mode === 'digest' && cur()) {
    if (kind === 'click') { st.draft = cur().draft; st.mode = 'draft'; return show(draftScreen(cur(), st.draft)); }
    if (kind === 'down' || kind === 'up') { st.i = (st.i + (kind === 'down' ? 1 : items.length - 1)) % items.length; return show(digestScreen(cur(), st.i, items.length)); }
  } else if (st.mode === 'draft') {
    if (kind === 'click') return onSend();
    if (kind === 'doubleClick') { st.mode = 'digest'; return show(digestScreen(cur(), st.i, items.length)); }
    if (kind === 'longPress') return startVoice();
  } else if (st.mode === 'listening' && kind === 'longRelease') return stopVoice();
}

function classify(ev) {
  const t = (ev.sysEvent || ev.textEvent || ev.listEvent || {}).eventType;
  if (ev.sysEvent || ev.textEvent || ev.listEvent) {
    if (t === undefined || t === OsEventTypeList.CLICK_EVENT) return 'click';   // proto3 omits the 0 value
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'doubleClick';
    if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'down';
    if (t === OsEventTypeList.SCROLL_TOP_EVENT) return 'up';
    if (t === OsEventTypeList.LONG_PRESS_EVENT) return 'longPress';
    if (t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return 'longRelease';
  }
  return null;
}

(async function main() {
  st.bridge = await waitForEvenAppBridge();
  st.bridge.onEvenHubEvent((ev) => {
    if (ev.audioEvent && st.mode === 'listening' && !FAKE_MIC) { st.pcm.push(ev.audioEvent.audioPcm); return; }
    const k = classify(ev); console.log('input', k);
    if (k) onInput(k).catch((e) => console.error('input error', e.message));
  });
  const s = await j('/api/session', {});
  st.sid = s.sid;
  await show(pairScreen(s.code, s.bot));
  setInterval(() => refresh().catch((e) => console.error('refresh', e.message)), 5000);
  const quick = setInterval(() => { if (st.mode === 'pair') refresh().catch(() => {}); else clearInterval(quick); }, 1000);
})();
