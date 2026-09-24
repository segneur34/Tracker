// Banc : module course ouvert depuis la bibliothèque, puis rechargé. Usage : node library3.mjs <port> <dossier des GPX>
const [port, workDir] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const win = (name) => `${workDir.replace(/\//g, '\\')}\\${name}`;

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).split('\n')[0]}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0].slice(0, 300)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERREUR: ${res.result.exceptionDetails.exception?.description?.split('\n')[0]}`;
  return res.result?.result?.value;
};
const go = async (path, ms = 3000) => { await send('Page.navigate', { url: `${BASE}${path}` }); await wait(ms); };
const setFiles = async (selector, paths) => {
  const { result: { root } } = await send('DOM.getDocument', { depth: -1 });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return 'absent';
  await send('DOM.setFileInputFiles', { nodeId, files: paths });
  return 'ok';
};

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await go('/course');
console.log('import :', await setFiles('input[type=file][accept=".gpx"][multiple]', [win('course.gpx')]));
await wait(3000);
console.log('Ouvrir :', await evaluate(`(() => { const b = document.querySelector('.lib-row__main'); if (!b) return 'absent'; b.click(); return 'ok'; })()`));
await wait(4000);
console.log('url :', await evaluate('location.pathname + location.search'));
console.log('h1 :', await evaluate(`document.querySelector('h1')?.textContent`), '| segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`), '| graphes :', await evaluate(`document.querySelectorAll('.recharts-surface').length`));
console.log(await evaluate(`document.body.innerText.split('\n').filter((l) => /Distance|D\\+|Sessions course/.test(l)).slice(0, 5).join(' | ')`));
await send('Page.reload'); await wait(4000);
console.log('après rechargement, segments :', await evaluate(`document.querySelectorAll('path.leaflet-interactive').length`));
console.log('--- console ---'); [...new Set(logs)].forEach((l) => console.log(l));
await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); ws.close();
