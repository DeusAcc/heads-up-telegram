# Heads Up — Telegram groups on your G2, answered in one tap

**Track 01 (Messaging & News) + Best Telegram.** Your busy Telegram groups become a 3-line digest on the glasses.
One tap sends an AI-drafted reply; hold the temple and *speak* to change it. Read **and** write, no phone in hand.

> Built 23–29 Nov 2026 for the Even Realities × TVM × Daos Hub hackathon. **Nothing existed before 23 Nov** except
> dependencies from npm (`@evenrealities/even_hub_sdk`, esbuild, dev tools).

## The one moment it solves
Marta writes in *Dev Team*: "deploy failed, rollback?" — Luca: "@you approve before 5pm". You are walking.
Glasses: `Dev Team · 2 msgs` / `Marta: v2.3 deploy failed` / `Luca: Alex approve rollback by 5p…`.
Tap → draft appears → tap again → it is in the group, as a reply to Luca. Two taps, about 3 seconds.
Or: hold, say *"approve the rollback, lunch at one works"*, release, tap to send.

## Screens (576×288, 3 containers, max 3 body lines)
| Pair | Digest | Draft | Sent |
|---|---|---|---|
| ![](docs/01-pairing.png) | ![](docs/02-digest.png) | ![](docs/03-draft.png) | ![](docs/05-sent.png) |

Controls: **tap** open draft / send · **scroll** next group · **hold** dictate (release = done) · **double tap** back.
The voice path shows the transcription-polished draft first; nothing is sent without a deliberate tap.

## Architecture
```
Telegram groups ─► bot (long polling) ─► backend (Node, zero deps) ─► Groq (gpt-oss-120b digest, Whisper STT)
                                              ▲   │ HTTPS/JSON, session id only
                                   G2 app (WebView, SDK 0.0.16) ◄┘
```
* `server/` – bot transport, RAM-only message buffer, digest/draft/voice endpoints. **All keys live here**; the app holds none.
* `web/` – the glasses app (ES modules → one bundle). `screens.js` is pure and unit-tested against device limits.
* **Pairing:** the app shows a 6-digit code; you send `/pair 123456` to the bot. The code binds your Telegram user id to
  that app session (10 min, single use). Digests only include groups you are a member of (`getChatMember`).
* **Voice:** glasses mic PCM 16 kHz → backend → Whisper → rewritten as a short message in your voice → shown as a draft.

## Privacy & safety
* Group messages are kept **in memory only**, 60 min TTL, capped at 40 per group; nothing is written to disk or logged.
* Private chats are ignored entirely. Only groups where the bot was added are read; the bot cannot read other chats.
* Chat text is passed to the model as data with an instruction not to follow it (prompt-injection guard); output is clipped.
* The device can only call the backend (`app.json` network whitelist). No Telegram or AI key ships in the app.
* Replies are always user-confirmed (tap). The app never sends on its own.

## Run it
```bash
npm install && npm run build
export TELEGRAM_BOT_TOKEN=…  GROQ_API_KEY=…      # server side only
npm start                                          # backend on 127.0.0.1:8787, real Telegram
npx evenhub-simulator http://127.0.0.1:8787        # or load the packed app: npm run pack
```
Add the bot to a group, open the app, send the code to the bot.

### Reproducible demo (what the video shows)
`npm run demo` starts the backend in `DEMO=1`, Xvfb and the EvenHub simulator, then drives it through the simulator's
automation API and saves glasses screenshots to `out/`. **Honest note:** in demo mode Telegram updates are injected as
Telegram `Update` JSON through `/demo/update` (same handler as long polling) and sends go to an outbox instead of the
network, because a hackathon repo cannot ship a private group full of real people. The simulator has no microphone,
so `?fakeMic=` replays a recorded 16 kHz PCM clip (spoken by a TTS voice) through the real `/api/voice` → Whisper path.
The Groq calls (digest, draft, transcription) are real.

**Video** (62 s, narrated by a TTS voice): [docs/demo.mp4](docs/demo.mp4) — rebuilt from scratch by `bash scripts/video.sh`.

`npm test` — 4 tests covering pairing, ordering, send target (reply-to), session isolation, private chats ignored, voice never auto-sending,
device-limit checks on every page.

## Feature requests for the APIs we used
1. **Simulator:** an input to inject microphone audio from a file (we had to add a test hook).
2. **SDK:** export `CLICK_EVENT = 0` explicitly in events — proto3 omits it, apps must treat `eventType === undefined` as a click.
3. **Display:** a small built-in glyph set (✓ ✗ ▸ ↑ ↓) — U+2713 renders as a missing-glyph box.
4. **SDK:** a documented text-container font-size or line-count option, so apps can fit 3 lines predictably.
5. **Hub:** an `app.json` network whitelist that accepts a user-entered backend URL at install time (self-hosted backends).

## Limits
Telegram bots in groups see only commands and mentions unless privacy mode is off (BotFather → `/setprivacy` → Disable).
Free-tier Groq rate limits apply. English UI; digests follow the chat's language.

MIT licensed.
