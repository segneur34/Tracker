// Banc de test : le bouton glissant qu'on fait glisser (demande du 22/10), sur le Profil (période) et les
// Statistiques (famille).
// Usage : node glisser.mjs <port> [<dossier des captures>]
// Sur un profil neuf, sans réseau, sans session. À 390×844 en écran tactile, puis sur ordinateur. Le script vérifie :
//  1. à la souris, la case tenue sur le choix en cours et glissée de deux crans : elle suit le pointeur, le choix sous
//     elle s'allume, rien n'est choisi avant le lâcher ; au lâcher, le choix sous la case est pris et la case s'y pose ;
//  2. au doigt, la même chose dans l'autre sens, sans que la page défile de côté ;
//  3. un toucher sur un autre choix le prend toujours (clic) ; un appui qui bouge à peine ne change rien ;
//  4. un glisser parti d'un choix qui n'est pas le choix en cours ne déplace pas la case ;
//  5. Statistiques : la famille glissée ne change l'adresse qu'au lâcher ; la vue choisie est retenue au rechargement.
import { connect } from './lib/cdp.mjs';

const [port, shotDir] = process.argv.slice(2);
if (!port) {
  console.error('Usage : node glisser.mjs <port> [<dossier des captures>]');
  process.exit(1);
}

// --- Protocole (lib/cdp.mjs) ---
const { send, evaluate, go, waitFor, wait, shoot, close, logs: allLogs } = await connect({ port, shotDir });
// Ce script ne relevait que les erreurs de console, pas les avertissements.


let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ` : ${detail}` : ''}`);
};

// --- Lecture d'une rangée ---
/** Choix de la rangée : libellé, centre à l'écran, coché, allumé ; position de la case. */
const readRow = (label) => evaluate(`(() => {
  const row = document.querySelector('.ui-segmented[aria-label=${JSON.stringify(label)}]');
  if (!row) return null;
  const items = [...row.querySelectorAll('[role=radio]')].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, checked: b.getAttribute('aria-checked') === 'true', lit: b.classList.contains('is-lit') };
  });
  const t = row.querySelector('.ui-segmented__thumb')?.getBoundingClientRect();
  return { items, thumbX: t ? t.left + t.width / 2 : null, dragging: row.classList.contains('is-dragging'), scrollX: window.scrollX };
})()`);
const checkedIndex = (row) => row.items.findIndex((it) => it.checked);
const litLabel = (row) => row.items.find((it) => it.lit)?.label ?? null;

// --- Gestes ---
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
/** Glisse de `from` à `to` en dix pas ; `mid` est appelé avant le lâcher. */
const dragWith = async (kind, from, to, mid) => {
  const [down, move, up] = kind === 'souris' ? ['mousePressed', 'mouseMoved', 'mouseReleased'] : ['touchStart', 'touchMove', 'touchEnd'];
  const act = kind === 'souris' ? mouse : touch;
  await act(down, from.x, from.y);
  for (let k = 1; k <= 10; k++) {
    await act(move, from.x + ((to.x - from.x) * k) / 10, from.y);
    await wait(16);
  }
  await wait(50);
  const during = mid ? await mid() : null;
  await act(up, to.x, from.y);
  await wait(400);
  return during;
};

/** Glisse la case de deux crans (vers la gauche si elle est assez à droite) et vérifie avant et après le lâcher. */
const dragTwo = async (label, kind, step = '') => {
  // La page se monte après le chargement (modules à la demande) : on attend la rangée jusqu'à 3 s, comme l'ancien sommeil.
  const before = await waitFor(() => readRow(label), { timeout: 3000, label: `rangée ${label}` });
  if (!before) { check(`${label} : rangée présente`, false); return; }
  const i = checkedIndex(before);
  const j = i >= 2 ? i - 2 : Math.min(before.items.length - 1, i + 2);
  const search = await evaluate('location.search');
  const during = await dragWith(kind, before.items[i], before.items[j], async () => ({ row: await readRow(label), search: await evaluate('location.search') }));
  const after = await readRow(label);
  check(`${step}${label}, ${kind} : rien de choisi pendant le glisser`, checkedIndex(during.row) === i && during.search === search,
    `coché ${during.row.items[checkedIndex(during.row)]?.label}, adresse ${during.search}`);
  check(`${step}${label}, ${kind} : la case suit et le choix sous elle s'allume`,
    during.row.dragging && Math.abs(during.row.thumbX - before.items[j].x) < 30 && litLabel(during.row) === before.items[j].label,
    `case à ${Math.round(during.row.thumbX)} (cible ${Math.round(before.items[j].x)}), allumé ${litLabel(during.row)}`);
  check(`${step}${label}, ${kind} : choix pris au lâcher, case posée dessus`,
    checkedIndex(after) === j && !after.dragging && Math.abs(after.thumbX - after.items[j].x) < 2 && litLabel(after) === after.items[j].label,
    `${before.items[i].label} → ${after.items[checkedIndex(after)]?.label}`);
  check(`${step}${label}, ${kind} : la page ne défile pas de côté`, after.scrollX === 0 && during.row.scrollX === 0, `scrollX ${during.row.scrollX}`);
};

const runOn = async (screen) => {
  console.log(`--- ${screen} ---`);
  // 1-4. Profil : la période.
  await go('/profil');
  await dragTwo('Période', 'souris', `${screen}, Profil, `);
  if (screen === 'téléphone') {
    await dragTwo('Période', 'doigt', `${screen}, Profil, `);
    await shoot('glisser-profil-390');
    // Toucher sur un autre choix : il est pris.
    let row = await readRow('Période');
    let i = checkedIndex(row);
    const k = i === 0 ? 1 : 0;
    await touch('touchStart', row.items[k].x, row.items[k].y);
    await touch('touchEnd', row.items[k].x, row.items[k].y);
    await wait(400);
    row = await readRow('Période');
    check(`${screen} : un toucher sur un autre choix le prend`, checkedIndex(row) === k, row.items[checkedIndex(row)]?.label);
    // Appui qui bouge à peine, sur le choix en cours : rien ne change.
    i = checkedIndex(row);
    await dragWith('doigt', row.items[i], { x: row.items[i].x + 3, y: row.items[i].y });
    const still = await readRow('Période');
    check(`${screen} : un appui qui bouge à peine ne change rien`, checkedIndex(still) === i && !still.dragging);
    // Glisser parti d'un autre choix : la case ne bouge pas.
    const other = i === 0 ? 2 : 0;
    const during = await dragWith('doigt', row.items[other], row.items[i], () => readRow('Période'));
    check(`${screen} : un glisser parti d'un autre choix ne prend pas la case`, !during.dragging);
  }
  // 5. Statistiques : la famille.
  await go('/statistiques');
  await dragTwo('Famille', screen === 'téléphone' ? 'doigt' : 'souris', `${screen}, Statistiques, `);
  const search = await evaluate('location.search');
  check(`${screen}, Statistiques : famille dans l'adresse`, /famille=/.test(search), search);
  await go('/statistiques');
  const resumed = await evaluate('location.search');
  check(`${screen}, Statistiques : vue retenue au rechargement`, resumed === search, resumed);
  // Retour à la vue d'ensemble pour l'écran suivant.
  await evaluate(`localStorage.clear()`);
};

// Téléphone : 390×844, écran tactile.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await runOn('téléphone');
// Ordinateur.
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await runOn('ordinateur');

console.log('--- console ---');
for (const l of allLogs.filter((l) => !l.startsWith('warning:'))) console.log(l);
console.log(failures === 0 ? 'Tout est vert.' : `${failures} échec(s).`);
await close();
process.exit(failures === 0 ? 0 : 1);
