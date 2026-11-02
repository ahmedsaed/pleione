// Read the Tizen probe's results over DevTools once its checks finish.
//   node scripts/tizen-probe/collect.mjs <devtools-port> [out.json] [keySeconds]
// keySeconds (default 0) keeps listening for remote keys after the checks.
import { writeFileSync } from 'node:fs';

const [port, out, keySecondsArg] = process.argv.slice(2);
const keySeconds = Number(keySecondsArg || 0);
if (!port) {
  console.error('usage: collect.mjs <devtools-port> [out.json] [keySeconds]');
  process.exit(2);
}

async function target() {
  for (let i = 0; i < 20; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = pages.find((p) => p.type === 'page');
      if (page) return page;
    } catch { /* the forward comes up a moment after the launch */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No DevTools page on port ${port}`);
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const evaluate = (expression) => new Promise((resolve) => {
  const my = ++id;
  const on = (m) => {
    const r = JSON.parse(m.data);
    if (r.id !== my) return;
    ws.removeEventListener('message', on);
    resolve(r.result?.result?.value);
  };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});
await new Promise((r) => { ws.onopen = r; });

const deadline = Date.now() + 180_000;
let probe;
for (;;) {
  probe = await evaluate('JSON.stringify(window.__probe || null)').then((s) => JSON.parse(s ?? 'null'));
  if (probe?.done || Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 2000));
}
if (!probe) throw new Error('The probe page reported nothing');
if (keySeconds > 0) {
  console.error(`Checks done. Press remote keys for the next ${keySeconds} s...`);
  await new Promise((r) => setTimeout(r, keySeconds * 1000));
  probe = JSON.parse(await evaluate('JSON.stringify(window.__probe)'));
}
ws.close();

const json = JSON.stringify(probe, null, 2);
if (out) writeFileSync(out, json + '\n');
console.log(json);
if (!probe.done) {
  console.error('The media checks did not finish in time; is npm run xtream:demo running?');
  process.exit(1);
}
