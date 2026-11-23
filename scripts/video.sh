#!/usr/bin/env bash
# Demo video: records the e2e run in the simulator, then cuts scenes + edge-tts narration into docs/demo.mp4 (~62 s).
# needs: GROQ_API_KEY, Xvfb, ffmpeg, edge-tts (pip install edge-tts). usage: bash scripts/video.sh
set -euo pipefail
cd "$(dirname "$0")/.."; R=out/raw.mp4; W=$(mktemp -d); TTS=${TTS:-edge-tts}
node scripts/demo.js --rec "$R"
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf; FR=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
T=("Heads Up turns busy Telegram groups into a glance on your Even Realities G 2 glasses, and lets you answer without touching your phone."
"Pairing is one message. Send the six digit code to the bot, and the glasses are linked. No API keys, no extra app."
"When a group gets busy, an AI digest squeezes the thread into three short lines that fit the display. Here, the dev team: a failed deploy, and a rollback that needs your approval before a customer demo."
"One tap, and Heads Up drafts a reply from the conversation."
"Want to say something else? Hold the touchpad and speak. Whisper transcribes it, the reply is tidied up, and shown for you to confirm."
"Tap again to send. It lands in the Telegram group, as a reply to the right person."
"And the next group is already waiting. Read, decide, reply, all from the glasses. Built during hackathon week on the Even Hub S D K, with Groq for summaries and speech.")
# scene cuts (s) in the raw run: pairing, digest, AI draft, voice, sent, next group
S=(0 1 5 11.3 13.5 21 22.5); E=(0 5 11.3 13.5 21 22.5 27.3)
dur(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
for i in "${!T[@]}"; do for k in 1 2 3; do "$TTS" --voice en-US-AndrewNeural --rate=+5% --text "${T[$i]}" --write-media "$W/a$i.mp3" && dur "$W/a$i.mp3" >/dev/null 2>&1 && break; done; done
d0=$(echo "$(dur $W/a0.mp3)+1.2" | bc)
ffmpeg -v error -y -f lavfi -i color=c=black:s=1280x720:r=30:d=$d0 -i $W/a0.mp3 -vf "drawtext=fontfile=$F:text='HEADS UP':fontcolor=0x33ff66:fontsize=96:x=(w-tw)/2:y=250,drawtext=fontfile=$FR:text='Telegram groups on Even Realities G2 - read and reply in one tap':fontcolor=white:fontsize=28:x=(w-tw)/2:y=390,drawtext=fontfile=$FR:text='Track 01 Messaging + Best Telegram':fontcolor=0x888888:fontsize=24:x=(w-tw)/2:y=450" -af apad -t $d0 -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 $W/p0.mp4
for i in 1 2 3 4 5 6; do
  a=$(dur $W/a$i.mp3); clip=$(echo "${E[$i]}-${S[$i]}" | bc); d=$(echo "if ($a+0.8 > $clip) $a+0.8 else $clip" | bc)
  ffmpeg -v error -y -ss ${S[$i]} -to ${E[$i]} -i $R -i $W/a$i.mp3 -filter_complex "[0:v]crop=596:335:644:0,scale=1192:-2,fps=30,tpad=stop_mode=clone:stop_duration=15,pad=1280:720:44:(720-ih)/2-15:black,drawtext=fontfile=$FR:text='live in the Even Hub simulator':fontcolor=0x777777:fontsize=20:x=w-tw-30:y=h-34,trim=duration=$d[v];[1:a]apad,atrim=duration=$d[a]" -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -ar 44100 -ac 2 $W/p$i.mp4
done
for i in 0 1 2 3 4 5 6; do echo "file $W/p$i.mp4"; done > $W/l.txt
ffmpeg -v error -y -f concat -safe 0 -i $W/l.txt -c copy docs/demo.mp4 && echo "docs/demo.mp4 $(dur docs/demo.mp4)s"
