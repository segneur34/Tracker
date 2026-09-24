// Pilote la WebView du téléphone par le protocole DevTools : charge des URL et lit la page.
const [wsUrl, ...paths] = process.argv.slice(2);
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Log.entryAdded') logs.push(`log ${msg.params.entry.level}: ${msg.params.entry.text}`);
};
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onopen = async () => {
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  for (const path of paths) {
    await send('Page.navigate', { url: `https://localhost${path}` });
    await wait(2500);
    const r = await send('Runtime.evaluate', { expression: `JSON.stringify({ url: location.href, h1: document.querySelector('h1')?.textContent ?? null, bodyLen: document.body.innerText.length, nav: [...document.querySelectorAll('nav a')].map(a => a.textContent) })`, returnByValue: true });
    console.log(path, '→', r.result?.result?.value);
  }
  console.log('--- console ---'); logs.forEach((l) => console.log(l));
  ws.close();
};
