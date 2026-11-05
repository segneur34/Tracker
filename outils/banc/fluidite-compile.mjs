// Mesure de `fluidite.mjs` sur la version compilée, la seule qui compte pour l'APK (lot 164 : le serveur de développement
// allonge les durées de 3 à 9 fois) : build dans un dossier de travail, `vite preview`, Chrome sans fenêtre.
// Usage : node outils/banc/fluidite-compile.mjs <étiquette> ; variables FLUIDITE_* transmises. Relevé : <travail>/releves/prod-<étiquette>.txt
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = process.argv[2] ?? 'essai';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = join(tmpdir(), 'tracker-banc', 'compile');
const dist = join(SP, `dist-${label}`);
const work = join(SP, `prod-${label}`);
const shots = join(SP, `captures-prod-${label}`);
const profile = join(SP, `prod-profil-${label}`);
const VITE = join(REPO, 'node_modules/vite/bin/vite.js');
const PORT = 4193;
const CDP = 9410;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`].find(existsSync);

for (const d of [work, shots, profile]) { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); mkdirSync(d, { recursive: true }); }
mkdirSync(join(SP, 'releves'), { recursive: true });
console.error('build…');
execFileSync(process.execPath, [VITE, 'build', '--outDir', dist, '--emptyOutDir'], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
const server = spawn(process.execPath, [VITE, 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const kill = (p) => { try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* déjà fini */ } };
const ready = async (url) => { for (let k = 0; k < 120; k++) { try { if ((await fetch(url)).ok) return true; } catch { /* pas encore */ } await new Promise((r) => setTimeout(r, 500)); } return false; };
let code = 1;
try {
  if (!(await ready(`http://127.0.0.1:${PORT}/`)) || !(await ready(`http://127.0.0.1:${CDP}/json/version`))) throw new Error('serveur ou Chrome absent');
  const out = createWriteStream(join(SP, 'releves', `prod-${label}.txt`));
  const child = spawn(process.execPath, [join(REPO, 'outils/banc/fluidite.mjs'), String(CDP), work, shots], {
    cwd: work, env: { ...process.env, BASE: `http://127.0.0.1:${PORT}`, MSYS_NO_PATHCONV: '1', BANC_DIAG: '0', TEMP: work, TMP: work }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.pipe(out);
  code = await new Promise((r) => child.on('close', r));
} finally {
  kill(chrome);
  kill(server);
}
console.log(`fini, code ${code}`);
process.exit(code);
