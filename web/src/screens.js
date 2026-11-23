// Pure screen model for the 576x288 monochrome display: each screen = {title, body[], footer}. Max 3 body lines.
export const W = 576, H = 288;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const pairScreen = (code, bot) => ({ title: 'HEADS UP · pair', body: [`Send to @${bot}:`, `/pair ${code}`], footer: 'waiting for pairing…' });
export const emptyScreen = () => ({ title: 'HEADS UP', body: ['No group needs you.', 'All quiet.'], footer: 'checking every 5 s' });
export const digestScreen = (item, i, total) => ({
  title: `${clip(item.title, 22)} · ${item.n} msgs  ${i + 1}/${total}`,
  body: item.lines.slice(0, 3),
  footer: item.needsReply ? 'tap: reply  ·  down: next' : 'tap: reply  ·  down: next',
});
export const draftScreen = (item, draft, note = '') => ({
  title: `Reply to ${clip(item.title, 24)}`,
  body: [`“${draft}”`],
  footer: note || 'tap: SEND  ·  hold: speak  ·  2×tap: back',
});
export const statusScreen = (title, line) => ({ title, body: [line], footer: '' });

// 3 text containers: title (y0), body (y44, receives input), footer (y236).
export function pageFor(s) {
  const t = (id, name, y, h, content, cap = 0) => ({ xPosition: 0, yPosition: y, width: W, height: h, containerID: id, containerName: name, content, isEventCapture: cap, zOrderIndex: id });
  return {
    containerTotalNum: 3,
    textObject: [
      t(1, 'title', 0, 40, s.title),
      t(2, 'body', 44, 188, s.body.join('\n'), 1),
      t(3, 'footer', 236, 52, s.footer),
    ],
  };
}
