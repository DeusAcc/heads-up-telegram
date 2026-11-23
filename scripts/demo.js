// End-to-end demo driver: backend (DEMO=1, real Groq) + Xvfb + EvenHub simulator, driven over its automation API.
// Telegram updates are injected in Telegram's own Update JSON shape; sends are recorded in the outbox, not delivered.
// usage: GROQ_API_KEY=… node scripts/demo.js [--rec out/demo.mp4]
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out');
const SIM = process.env.SIM_BIN || path.join(ROOT, 'node_modules/@evenrealities/sim-linux-arm64/bin/evenhub-simulator');
const PORT = 8787, AUTO = 9898, DISPLAY = ':98';
const rec = process.argv.includes('--rec') ? process.argv[process.argv.indexOf('--rec') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => (await fetch(u)).json();
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const procs = [];
const run = (cmd, args, env = {}, name) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', fs.openSync(path.join(OUT, `${name}.log`), 'w'), 'inherit'] }); procs.push(p); return p; };

let n = 0;
const shot = async (label) => {
  await sleep(700);
  const buf = Buffer.from(await (await fetch(`http://127.0.0.1:${AUTO}/api/screenshot/glasses`)).arrayBuffer());
  const f = path.join(OUT, `${String(++n).padStart(2, '0')}-${label}.png`); fs.writeFileSync(f, buf); console.log('shot', f); return f;
};
const key = async (action, wait = 1500) => { await post(`http://127.0.0.1:${AUTO}/api/input`, { action }); await sleep(wait); };
const tgUpdate = (id, chat, from, text) => post(`http://127.0.0.1:${PORT}/demo/update`, { update_id: id, message: { message_id: id, date: 0, chat, from, text } });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  run('Xvfb', [DISPLAY, '-screen', '0', '1280x800x24'], {}, 'xvfb'); await sleep(1500);
  run('node', [path.join(ROOT, 'server/server.js')], { DEMO: '1', PORT: String(PORT) }, 'backend'); await sleep(1000);
  await get(`http://127.0.0.1:${PORT}/demo/reset`);
  run(SIM, ['--automation-port', String(AUTO), `http://127.0.0.1:${PORT}/?fakeMic=/demo-voice.pcm`], { DISPLAY }, 'simulator');
  for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${AUTO}/api/ping`); break; } catch { await sleep(500); } }
  if (rec) run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '15', '-video_size', '1280x800', '-i', DISPLAY, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', rec], {}, 'ffmpeg');
  await sleep(3000);
  const con = await get(`http://127.0.0.1:${AUTO}/api/console`);
  const pairMsg = JSON.stringify(con);
  const code = (pairMsg.match(/\/pair (\d{6})/) || [])[1];
  if (!code) throw new Error('no pairing code on screen: ' + pairMsg.slice(0, 500));
  await shot('pairing');

  const alex = { id: 42, first_name: 'Alex' };
  await tgUpdate(1, { id: 42, type: 'private' }, alex, `/pair ${code}`);
  const dev = { id: -1001, type: 'supergroup', title: 'Dev Team' }, fam = { id: -1002, type: 'group', title: 'Family' };
  await tgUpdate(2, fam, { id: 7, first_name: 'Mum' }, 'Dinner on Sunday? Bring the dessert please');
  await tgUpdate(3, dev, { id: 8, first_name: 'Marta' }, 'Deploy of v2.3 failed on staging. Rollback?');
  await tgUpdate(4, dev, { id: 9, first_name: 'Luca' }, '@Alex can you approve the rollback before 5pm? Customer demo at 5:30');
  await sleep(7000);
  await shot('digest');
  await key('click'); await shot('draft');
  await key('long_press', 800); await key('long_press_release', 6000); await shot('voice-draft');
  await key('click', 3500); await shot('sent');
  console.log('outbox', JSON.stringify(await get(`http://127.0.0.1:${PORT}/demo/outbox`)));
  await shot('next-digest');
  console.log('console', JSON.stringify((await get(`http://127.0.0.1:${AUTO}/api/console`)).slice?.(-5) || ''));
})().catch((e) => { console.error('FAIL', e); process.exitCode = 1; }).finally(async () => {
  await sleep(1500); procs.reverse().forEach((p) => p.kill('SIGINT')); await sleep(1500); process.exit(process.exitCode || 0);
});
