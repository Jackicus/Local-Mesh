// Minimal CDP driver for a running Local Mesh instance started with
//   ./node_modules/.bin/electron . --remote-debugging-port=9222
// Usage: node scripts/drive-app.mjs <cmd> [arg]   (screenshots -> .shots/ or $SHOTS_DIR)
//   ss <name>          screenshot -> <name>.png
//   eval <js>          evaluate JS in the page, print JSON
//   text [sel]         innerText of selector (or body)
//   click <sel>        DOM click
//   click-text <text>  click first button/a whose text includes <text>
//   nav <view>         dockStore-style nav: clicks the dock item with that label
//   drop <path>        drop a real file onto the centre of the window (Input.dispatchDragEvent)
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9222;
const SHOTS = process.env.SHOTS_DIR || path.join(import.meta.dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) {
  console.log('NO_PAGE', targets.map((t) => t.url));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? 'error' };
  return r.result?.result?.value;
}

const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
switch (cmd) {
  case 'ss': {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, `${arg || Date.now()}.png`);
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log('screenshot:', f);
    break;
  }
  case 'eval':
    console.log(JSON.stringify(await evaluate(arg)));
    break;
  case 'text':
    console.log(await evaluate(`(${JSON.stringify(arg)} ? document.querySelector(${JSON.stringify(arg)}) : document.body)?.innerText ?? '(null)'`));
    break;
  case 'click':
    console.log(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(arg)}); if (!el) return 'NOT_FOUND'; el.click(); return 'OK'; })()`));
    break;
  case 'click-text':
    console.log(await evaluate(`(() => { const els = [...document.querySelectorAll('button, a, [role="button"], .dock-item')]; const el = els.find(e => e.textContent?.trim() === ${JSON.stringify(arg)}) ?? els.find(e => e.textContent?.includes(${JSON.stringify(arg)})); if (!el) return 'NOT_FOUND'; el.click(); return 'OK: ' + el.tagName + ' ' + el.className; })()`));
    break;
  case 'nav':
    console.log(await evaluate(`(() => { const el = [...document.querySelectorAll('.dock-item')].find(e => e.textContent?.trim() === ${JSON.stringify(arg)}); if (!el) return 'NOT_FOUND'; el.click(); return 'OK'; })()`));
    break;
  case 'drop': {
    const { result } = await send('Runtime.evaluate', { expression: 'JSON.stringify({w: innerWidth, h: innerHeight})', returnByValue: true });
    const { w, h } = JSON.parse(result.result.value);
    const data = { items: [], files: [arg], dragOperationsMask: 1 };
    const x = Math.round(w * 0.4);
    const y = Math.round(h * 0.5);
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      const r = await send('Input.dispatchDragEvent', { type, x, y, data });
      if (r.error) console.log(type, 'error:', r.error.message);
    }
    console.log('dropped', arg);
    break;
  }
  default:
    console.log('unknown command');
}
ws.close();
