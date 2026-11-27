import { describe, expect, it } from 'vitest';
import { formatSessionDate } from '../core/units';
import type { SyncStamp } from './syncBase';
import type { SyncExtrasPlan } from './syncExtras';
import { SYNC_GUARD_LIMITS, type SyncItem, type SyncOp, type SyncPlan } from './syncPlan';
import { emptySyncOutcome, type SyncOutcome } from './syncOutcome';
import { describePhoneProblem, describeSyncConfirmation, describeSyncOutcome, describeSyncPreview, syncCounts, syncCountsText, syncGuardQuestion } from './syncReport';
import type { RouteSyncItem, RouteSyncPlan } from './syncRoutes';

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const stamp = (name: string): SyncStamp => ({ name, size: 10, mtimeMs: 5 });
const files = (name: string) => ({ gpx: stamp(`${name}.gpx`), record: stamp(`${name}.json`), imu: null });
const names = (name: string) => ({ gpx: `${name}.gpx`, record: `${name}.json`, imu: null });

const item = (k: number, patch: Partial<SyncItem>): SyncItem => ({
  startMs: T0 + k, case: 'followed', files: { computer: `${k}.gpx`, phone: `${k}.gpx` }, ops: [], base: { kind: 'keep' }, left: null,
  conflicts: [], twoTracks: false, withoutAncestor: false, ...patch,
});

const copyTo = (to: 'computer' | 'phone', k: number): SyncOp => ({ kind: 'copy', to, source: files(String(k)), target: names(String(k)), recordText: null });

const planOf = (items: SyncItem[], patch: Partial<SyncPlan> = {}): SyncPlan => ({
  pair: { first: null, base: null, newId: { computer: false, phone: false } }, saveBase: true, items, duplicates: [], unknown: [],
  guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 10, phone: 10 } }, ...patch,
});

const route = (id: string, patch: Partial<RouteSyncItem>): RouteSyncItem => ({
  id, createdAt: id, case: 'followed', files: { computer: id, phone: id }, ops: [], base: { kind: 'keep' }, left: null, conflict: false, revived: false, ...patch,
});
const routeFiles = (base: string) => ({ base, json: stamp(`${base}.json`), gpx: null });
const routesOf = (items: RouteSyncItem[]): RouteSyncPlan => ({
  items, aside: [], guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 1, phone: 1 } },
});

describe('comptes de la synchronisation', () => {
  it('« N à copier vers le téléphone, M vers l’ordinateur, K à retirer », chaque session ou itinéraire compté une fois', () => {
    const sessions = planOf([
      item(1, { case: 'newOnComputer', ops: [copyTo('phone', 1)] }),
      item(2, { case: 'newOnPhone', ops: [copyTo('computer', 2)] }),
      item(3, { case: 'newOnPhone', ops: [copyTo('computer', 3)] }),
      // Fiche fondue écrite des deux côtés : comptée de chaque côté.
      item(4, { ops: [{ kind: 'writeRecord', on: 'computer', file: stamp('4.json'), text: '{}' }, { kind: 'writeRecord', on: 'phone', file: stamp('4.json'), text: '{}' }] }),
      item(5, { case: 'deletedOnPhone', ops: [{ kind: 'trash', files: [stamp('5.gpx')], absent: '5.gpx' }] }),
      item(6, { case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: [stamp('6.gpx')], absent: null, keep: 'none', recordText: null, moveTo: 'x' }] }),
      // Les restes d'une session absente des deux côtés ne comptent pas.
      item(7, { case: 'deletedOnBoth', ops: [{ kind: 'trash', files: [stamp('7.json')], absent: null }] }),
    ]);
    const routes = routesOf([
      route('r1', { case: 'newOnComputer', ops: [{ kind: 'copy', to: 'phone', source: routeFiles('r1'), base: 'r1', replaces: { json: null, gpx: null } }] }),
      route('r2', { case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: routeFiles('r2'), absent: null, keep: false, moveTo: 'x' }] }),
    ]);
    const counts = syncCounts({ sessions, routes });
    expect(counts).toEqual({ toPhone: 3, toComputer: 3, toRemove: 3 });
    expect(syncCountsText(counts)).toBe("3 à copier vers le téléphone, 3 vers l'ordinateur, 3 à retirer");
  });

  it('les parties nulles se taisent ; rien du tout : rien à échanger', () => {
    expect(syncCountsText({ toPhone: 0, toComputer: 2, toRemove: 0 })).toBe("2 à copier vers l'ordinateur");
    expect(syncCountsText({ toPhone: 1, toComputer: 0, toRemove: 4 })).toBe('1 à copier vers le téléphone, 4 à retirer');
    expect(syncCountsText({ toPhone: 0, toComputer: 0, toRemove: 0 })).toBeNull();
    expect(describeSyncPreview({ sessions: planOf([]) })).toEqual({
      counts: { toPhone: 0, toComputer: 0, toRemove: 0 }, headline: 'Rien à échanger : les deux appareils ont les mêmes sessions.', notes: [],
    });
  });
});

describe('ce qu’on dit avant de synchroniser', () => {
  it('première synchronisation : rien ne sera supprimé', () => {
    const preview = describeSyncPreview({ sessions: planOf([], { pair: { first: 'noBase', base: null, newId: { computer: false, phone: false } } }) });
    expect(preview.notes).toEqual(['Première synchronisation avec ce téléphone : rien ne sera supprimé, chaque appareil reçoit ce qui lui manque.']);
  });

  it('garde-fou : le nombre retenu, rien d’encore supprimé ; les sessions nommées pour la question', () => {
    const deletions = Array.from({ length: 12 }, (_, k) =>
      item(k, { case: 'deletedOnPhone', ops: [{ kind: 'trash', files: [stamp(`${k}.gpx`)], absent: `${k}.gpx` }] }));
    const full = planOf(deletions, { guard: { tripped: true, limits: SYNC_GUARD_LIMITS, toTrash: 12, fromPhone: 0, count: { computer: 40, phone: 28 } } });
    const restricted = planOf(deletions.map((i) => ({ ...i, ops: [], left: 'outOfScope' as const })));
    const preview = describeSyncPreview({ sessions: restricted }, { sessions: full }, { [T0 + 3]: 'Mistral' });
    expect(preview.headline).toBe('Rien à échanger : les deux appareils ont les mêmes sessions.');
    expect(preview.notes).toEqual(["Cette synchronisation retirerait 12 sessions. Rien n'est encore supprimé : il faut le confirmer."]);
    const asked = syncGuardQuestion({ sessions: full }, { [T0 + 3]: 'Mistral' });
    expect(asked.sessions).toHaveLength(12);
    expect(asked.routes).toEqual([]);
    expect(asked.sessions[3]).toEqual({ startMs: T0 + 3, side: 'computer', label: 'Mistral' });
    expect(asked.sessions[0].label).toBe(formatSessionDate(T0));
    expect(syncGuardQuestion({ sessions: restricted })).toEqual({ sessions: [], routes: [] });
  });

  it('garde-fou : sessions et itinéraires comptés ensemble, les itinéraires nommés aussi', () => {
    // 6 sessions sur 100 et 6 itinéraires sur 100 : aucune des deux sortes ne dépasse seule, ensemble elles dépassent 10.
    const deletions = Array.from({ length: 6 }, (_, k) =>
      item(k, { case: 'deletedOnPhone', ops: [{ kind: 'trash', files: [stamp(`${k}.gpx`)], absent: `${k}.gpx` }] }));
    const sessions = planOf(deletions, { guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 6, fromPhone: 0, count: { computer: 100, phone: 94 } } });
    const removedRoutes = Array.from({ length: 6 }, (_, k) => route(`r${k}`, {
      case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: routeFiles(`r${k}`), absent: null, keep: false, moveTo: 'x' }],
    }));
    const routes: RouteSyncPlan = { ...routesOf(removedRoutes), guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 6, count: { computer: 94, phone: 100 } } };
    const asked = syncGuardQuestion({ sessions, routes });
    expect(asked.sessions).toHaveLength(6);
    expect(asked.routes[0]).toEqual({ id: 'r0', side: 'phone', label: 'r0' });
    const restricted = { sessions: planOf(deletions.map((i) => ({ ...i, ops: [] }))), routes: routesOf(removedRoutes.map((i) => ({ ...i, ops: [] }))) };
    expect(describeSyncPreview(restricted, { sessions, routes }).notes).toEqual([
      "Cette synchronisation retirerait 6 sessions et 6 itinéraires. Rien n'est encore supprimé : il faut le confirmer.",
    ]);
    // Confirmé : rien n'est plus retenu, la phrase se tait.
    expect(describeSyncPreview({ sessions, routes }).notes.some((n) => n.startsWith('Cette synchronisation retirerait'))).toBe(false);
  });

  it('session supprimée d’un côté mais modifiée de l’autre : gardée, et c’est dit', () => {
    const preview = describeSyncPreview({
      sessions: planOf([
        item(1, { case: 'deletedOnPhone', revived: true, ops: [copyTo('phone', 1)] }),
        item(2, { case: 'deletedOnComputer', revived: true, ops: [copyTo('computer', 2)] }),
        item(3, { case: 'deletedOnComputer', revived: true, ops: [copyTo('computer', 3)] }),
      ]),
    });
    expect(preview.headline).toBe("1 à copier vers le téléphone, 2 vers l'ordinateur");
    expect(preview.notes).toEqual([
      "1 session supprimée sur le téléphone avait été modifiée sur l'ordinateur : elle est gardée et revient sur le téléphone.",
      "2 sessions supprimées sur l'ordinateur avaient été modifiées sur le téléphone : elles sont gardées et reviennent sur l'ordinateur.",
    ]);
  });

  it('conflits nommés en clair, la version gardée dite ; retrait du téléphone : mis de côté, jamais effacé', () => {
    const preview = describeSyncPreview({
      sessions: planOf([
        item(1, { conflicts: ['name', 'notes.comment', 'notes.rating'], ops: [{ kind: 'writeRecord', on: 'phone', file: stamp('1.json'), text: '{}' }] }),
        item(2, { case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', files: [stamp('2.gpx')], absent: null, keep: 'all', recordText: null, moveTo: 'x' }] }),
      ], { guard: { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 1, count: { computer: 10, phone: 10 } } }),
    }, undefined, { [T0 + 1]: 'Sortie du matin' });
    expect(preview.headline).toBe('1 à copier vers le téléphone, 1 à retirer');
    expect(preview.notes).toEqual([
      "Rien n'est effacé du téléphone : ce qui en est retiré va dans sa corbeille, où il reste 30 jours (Réglages › Mémoire du téléphone).",
      "« Sortie du matin » : nom, notes changés sur les deux appareils. La version de l'ordinateur est gardée.",
    ]);
  });

  it('ce qui attend : pas fini sur le téléphone, trace différente, version plus récente, corbeille', () => {
    const preview = describeSyncPreview({
      sessions: planOf([
        item(1, { case: 'newOnPhone', files: { computer: null, phone: '1.gpx' }, left: 'unfinishedGpx' }),
        item(2, { left: 'changedGpx' }),
        item(3, { left: 'futureRecord' }),
        item(4, { case: 'newOnPhone', files: { computer: null, phone: '4.gpx' }, left: 'inTrash', base: { kind: 'hold' } }),
      ], { unknown: [{ side: 'phone', file: 'x.gpx', reason: 'noRecord' }] }),
    });
    expect(preview.notes).toEqual([
      '2 sessions du téléphone pas encore finies de ranger : elles viendront la prochaine fois.',
      "1 session laissée de côté : sa trace n'est plus la même sur les deux appareils. Rien n'est choisi à votre place.",
      "1 élément d'une version plus récente de Tracker : laissé tel quel. Mettez ce programme à jour.",
      "1 élément dans la corbeille de l'ordinateur et encore sur le téléphone : laissé sur le téléphone, ni ramené ni supprimé.",
    ]);
  });

  it('réglages, FC repos et journaux', () => {
    const extras: SyncExtrasPlan = {
      ops: [
        { kind: 'settings', to: 'phone', path: 'reglages/PC.json', text: '{}', replaces: null, added: 0 },
        { kind: 'restingHr', to: 'computer', path: 'fc-repos.json', text: '{}', replaces: null, added: 2 },
      ],
      copies: [{ kind: 'journal', to: 'computer', path: 'journaux/a.json', source: stamp('a.json') }, { kind: 'journal', to: 'computer', path: 'journaux/b.json', source: stamp('b.json') }],
      left: [{ kind: 'settings', path: 'reglages/Pixel.json', side: null, reason: 'otherDevice' }],
    };
    expect(describeSyncPreview({ sessions: planOf([]), extras }).notes).toEqual([
      '1 fichier de réglages recopié, sans rien changer aux réglages de chaque appareil.',
      'Tests de FC repos mis en commun.',
      "2 journaux d'enregistrement copiés vers l'ordinateur.",
      "Deux appareils s'appellent « Pixel » : renommez-en un dans Réglages › Mémoire pour que leurs réglages s'échangent.",
    ]);
  });
});

describe('compte rendu et confirmation', () => {
  const outcomeOf = (patch: Partial<SyncOutcome>): SyncOutcome => ({ ...emptySyncOutcome(null), phoneWritable: true, ...patch });
  const removeOp: SyncOp = { kind: 'removeFromPhone', files: [stamp('2.gpx')], absent: null, keep: 'none', recordText: null, moveTo: '2' };

  it('dit ce qui a été copié dans chaque sens, mis de côté, et rappelle « Mettre à jour » sur le téléphone', () => {
    const done = [item(1, { case: 'newOnComputer', ops: [copyTo('phone', 1)] }), item(2, { case: 'deletedOnComputer', ops: [removeOp] }), item(3, { case: 'newOnPhone', ops: [copyTo('computer', 3)] })];
    const report = describeSyncOutcome(outcomeOf({ done, plan: planOf(done), phoneChanged: true, complete: true }));
    expect(report.title).toBe('Synchronisation faite');
    expect(report.rows.map((r) => `${r.label} : ${r.text}`)).toEqual([
      'Copié vers l’ordinateur : 1 session',
      'Copié vers le téléphone : 1 session',
      "Mis de côté sur le téléphone : 1 session supprimée sur l'ordinateur : retirée de la mémoire du téléphone, dans sa corbeille pour 30 jours",
    ]);
    expect(report.notes).toEqual(['Sur le téléphone, touchez « Mettre à jour » dans Réglages › Mémoire (ou relancez Tracker) pour voir les changements.']);
  });

  it('dit les conflits et qui l’a emporté, ce qui attend, et la première fois', () => {
    const done = [item(1, { conflicts: ['name'], ops: [{ kind: 'writeRecord', on: 'phone', file: stamp('1.json'), text: '{}' }] })];
    const report = describeSyncOutcome(outcomeOf({
      first: 'noBase', done, plan: planOf(done), deletions: 'excluded', withheldDeletions: [item(4, { case: 'deletedOnComputer' })],
    }));
    expect(report.paragraphs[0]).toBe("Première synchronisation avec ce téléphone : rien n'a été supprimé, chaque appareil a reçu ce qui lui manquait.");
    expect(report.notes.some((n) => /changé sur les deux appareils\. La version de l'ordinateur a été gardée sur les deux\./.test(n))).toBe(true);
    expect(report.notes.some((n) => n.startsWith("Rien n'a été supprimé : 1 session supprimée sur un appareil est encore sur l'autre."))).toBe(true);
  });

  it('refus, coupure et enregistrement commencé : dits en clair, « Réessayer » quand il y a lieu', () => {
    expect(describeSyncOutcome(emptySyncOutcome('phoneRecording'))).toMatchObject({ retry: true, title: 'Synchronisation impossible' });
    expect(describeSyncOutcome(emptySyncOutcome('newerBase')).retry).toBe(false);
    expect(describeSyncOutcome(outcomeOf({ linkLost: 'device not found' }))).toMatchObject({ retry: true, title: 'Synchronisation arrêtée' });
    expect(describeSyncOutcome(outcomeOf({ recordingStarted: true })).notes[0]).toMatch(/^Un enregistrement a commencé sur le téléphone/);
    expect(describeSyncOutcome(outcomeOf({ complete: true })).paragraphs).toEqual(['Les deux appareils étaient déjà à jour.']);
  });

  it('la confirmation chiffre le plan entier permis et nomme chaque retrait, sans la phrase du garde-fou', () => {
    const items = [item(1, { case: 'newOnComputer', ops: [copyTo('phone', 1)] }), item(2, { case: 'deletedOnComputer', ops: [removeOp] })];
    const confirmation = describeSyncConfirmation(outcomeOf({ preview: true, plan: planOf(items), names: { sessions: { [T0 + 2]: 'Sortie' }, routes: {} } }));
    expect(confirmation.counts).toBe('1 à copier vers le téléphone, 1 à retirer');
    expect(confirmation.removals.sessions).toEqual([{ startMs: T0 + 2, side: 'phone', label: 'Sortie' }]);
    expect(confirmation.notes.some((n) => n.startsWith('Cette synchronisation retirerait'))).toBe(false);
  });

  it('un téléphone pas prêt : une phrase et « Réessayer », le dossier de l’outil à part', () => {
    expect(describePhoneProblem({ kind: 'toolMissing', folder: 'C:\\profil' })).toMatchObject({ retry: true, folder: 'C:\\profil' });
    expect(describePhoneProblem({ kind: 'phone', state: 'plusieurs', count: 2 }).paragraphs[0]).toMatch(/^Plusieurs appareils sont branchés à l'ordinateur \(2\)/);
    expect(describePhoneProblem({ kind: 'cannotWrite' }).retry).toBe(false);
  });
});

describe('titres du compte rendu', () => {
  const outcomeOf = (patch: Partial<SyncOutcome>): SyncOutcome => ({ ...emptySyncOutcome(null), phoneWritable: true, ...patch });
  const one = item(1, { case: 'followed' });

  it('« faite », « incomplète » (échoué, laissé, en attente), « arrêtée » ; « Réessayer » aussi pour ce qui a été laissé', () => {
    expect(describeSyncOutcome(outcomeOf({ complete: true }))).toMatchObject({ title: 'Synchronisation faite', retry: false });
    expect(describeSyncOutcome(outcomeOf({ failed: [{ item: one, detail: 'disque plein' }] }))).toMatchObject({ title: 'Synchronisation incomplète', retry: true });
    expect(describeSyncOutcome(outcomeOf({ skipped: [one] }))).toMatchObject({ title: 'Synchronisation incomplète', retry: true });
    expect(describeSyncOutcome(outcomeOf({ deletions: 'awaitingConfirmation', withheldDeletions: [one] }))).toMatchObject({ title: 'Synchronisation incomplète', retry: false });
    expect(describeSyncOutcome(outcomeOf({ linkLost: 'device offline', skipped: [one] }))).toMatchObject({ title: 'Synchronisation arrêtée', retry: true });
    // « Sans rien supprimer » choisi : ce qui attend est dit, sans que la synchronisation soit dite incomplète.
    expect(describeSyncOutcome(outcomeOf({ deletions: 'excluded', withheldDeletions: [one] })).title).toBe('Synchronisation faite');
  });

  it('la reprise d’une synchronisation coupée ne se dit terminée que si elle l’est', () => {
    const resumed = "La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée.";
    expect(describeSyncOutcome(outcomeOf({ interrupted: true, complete: true })).paragraphs).toContain(resumed);
    expect(describeSyncOutcome(outcomeOf({ interrupted: true, skipped: [one] })).paragraphs).not.toContain(resumed);
    expect(describeSyncOutcome(outcomeOf({ interrupted: true, failed: [{ item: one, detail: 'x' }] })).paragraphs).not.toContain(resumed);
  });
});
