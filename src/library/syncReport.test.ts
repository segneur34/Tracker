import { describe, expect, it } from 'vitest';
import { emptySyncOutcome, type SyncOutcome } from './syncOutcome';
import { SYNC_GUARD_LIMITS, type SyncCase, type SyncItem, type SyncOp, type SyncPlan } from './syncPlan';
import {
  computerScanText, describeFirstStart, describeNoPhone, describePhoneSync, describeQuestion, describeSync, describeSyncQuestion, describeWait,
  mergeSyncPasses, safetyCopyProgressText, syncHasChangedItems, syncProgressText, syncSubtitle, type SyncQuestion, type SyncReport, type SyncWait,
} from './syncReport';
import type { RouteSyncItem, RouteSyncOp } from './syncRoutes';

/**
 * Ce que dit la fenêtre « Synchroniser » (lot 242-2, d'après celle de Gtracker) : compte rendu rangé par geste,
 * exceptions avec leur suite, question à deux réponses, attente, sur des issues fabriquées à la main.
 */

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const stamp = (name: string) => ({ name, size: 10, mtimeMs: 0 });
const files = { gpx: stamp('a.gpx'), record: stamp('a.json'), imu: null };
const target = { gpx: 'a.gpx', record: 'a.json', imu: null };

const OPS: Record<string, SyncOp> = {
  toPhone: { kind: 'copy', to: 'phone', source: files, target, recordText: null },
  toComputer: { kind: 'copy', to: 'computer', source: files, target, recordText: null },
  record: { kind: 'writeRecord', on: 'phone', file: stamp('a.json'), text: '{}' },
  trash: { kind: 'trash', files: [stamp('a.gpx')], absent: 'a.gpx' },
  remove: { kind: 'removeFromPhone', files: [stamp('a.gpx')], absent: 'a.gpx', keep: 'none', recordText: null, moveTo: 'x' },
};

let next = 0;
const item = (kind: SyncCase, ops: SyncOp[], patch: Partial<SyncItem> = {}): SyncItem => ({
  startMs: T0 + ++next * 3_600_000, case: kind, files: { computer: 'a.gpx', phone: 'a.gpx' }, ops, base: { kind: 'keep' }, left: null,
  conflicts: [], twoTracks: false, withoutAncestor: false, ...patch,
});

const noGuard = { tripped: false, limits: SYNC_GUARD_LIMITS, toTrash: 0, fromPhone: 0, count: { computer: 0, phone: 0 } };
const planOf = (items: SyncItem[]): SyncPlan => ({
  pair: { first: null, base: null, newId: { computer: false, phone: false } }, saveBase: true, items, duplicates: [], unknown: [], guard: noGuard,
});

const outcomeOf = (items: SyncItem[], patch: Partial<SyncOutcome> = {}): SyncOutcome => ({
  ...emptySyncOutcome(null), phoneWritable: true, complete: true, plan: planOf(items), done: items, ...patch,
});

const listed = { base: 'tour', json: stamp('tour.json'), gpx: stamp('tour.gpx') };
const route = (kind: SyncCase, ops: RouteSyncOp[], patch: Partial<RouteSyncItem> = {}): RouteSyncItem => ({
  id: `id-${++next}`, createdAt: null, case: kind, files: { computer: 'tour', phone: 'tour' }, ops, base: { kind: 'keep' }, left: null,
  conflict: false, revived: false, ...patch,
});
const copyTo = (to: 'computer' | 'phone'): RouteSyncOp => ({ kind: 'copy', to, source: listed, base: 'tour', replaces: { json: null, gpx: null } });
const routesOf = (items: RouteSyncItem[], patch: Partial<SyncOutcome['routes']> = {}): Partial<SyncOutcome> => ({
  routes: { ...emptySyncOutcome(null).routes, plan: { items, aside: [], guard: noGuard }, done: items, ...patch },
});

/** Les lignes du compte rendu, « geste : ce qu'il a touché ». */
const rowsOf = (report: SyncReport): string[] => report.rows.map((row) => `${row.label} : ${row.text}`);
const notesOf = (report: SyncReport): string[] => report.notes.map((note) => note.text);

describe('compte rendu : ce qui s’est échangé', () => {
  it('rien à faire : « Tout est à jour », un seul bouton', () => {
    expect(describeSync(outcomeOf([]))).toEqual({
      title: 'Tout est à jour', paragraphs: ['Rien à échanger : les deux appareils ont les mêmes sessions et les mêmes itinéraires.'],
      detail: null, rows: [], notes: [], folder: null, action: 'close',
    });
  });

  it('rangé par geste ; sessions et itinéraires comptés à part, jamais additionnés ; une suppression finit dans les deux corbeilles', () => {
    const items = [
      item('newOnComputer', [OPS.toPhone]), item('newOnComputer', [OPS.toPhone]), item('newOnComputer', [OPS.toPhone]),
      ...Array.from({ length: 5 }, () => item('newOnPhone', [OPS.toComputer])),
      item('followed', [OPS.record]), item('followed', [OPS.record]),
      item('deletedOnPhone', [OPS.trash]), item('deletedOnComputer', [OPS.remove]), item('deletedOnComputer', [OPS.remove]),
    ];
    const routes = [
      route('newOnComputer', [copyTo('phone')]), route('newOnComputer', [copyTo('phone')]), route('newOnPhone', [copyTo('computer')]),
      route('followed', [copyTo('phone')]),
    ];
    const said = describeSync(outcomeOf(items, { ...routesOf(routes), phoneChanged: true }));
    expect(said.title).toBe('Synchronisation terminée');
    expect(rowsOf(said)).toEqual([
      'Reçu du téléphone : 5 sessions, 1 itinéraire',
      'Envoyé au téléphone : 3 sessions, 2 itinéraires',
      "Modifié : 2 sessions, 1 itinéraire, recopiés sur l'autre appareil",
      'Supprimé : 1 session supprimée sur le téléphone : elle est dans la corbeille des deux appareils pour 30 jours',
      "Supprimé : 2 sessions supprimées sur l'ordinateur, retirées du téléphone : elles sont dans la corbeille des deux appareils pour 30 jours",
    ]);
    expect(said.notes).toEqual([]);
    expect(said.action).toBe('close');
    // « Touchez Mettre à jour » est parti : le téléphone se met à jour seul (marqueur `synchro`).
    expect(JSON.stringify(said)).not.toMatch(/Mettre à jour/);
  });

  it('chaque ligne se déplie en noms : le nom montré de l’issue, sinon la date de départ', () => {
    const named = item('deletedOnPhone', [OPS.trash]);
    const dated = item('deletedOnPhone', [OPS.trash]);
    const tour = route('deletedOnPhone', [{ kind: 'trash', files: listed, absent: 'tour.json' }]);
    const said = describeSync(outcomeOf([named, dated], {
      ...routesOf([tour]), names: { sessions: { [named.startMs]: 'sam. 14 nov. · Wing · Carnon-Plage' }, routes: { [tour.id]: 'Tour du cap' } },
    }));
    expect(said.rows).toHaveLength(1);
    expect(said.rows[0].text).toBe('2 sessions, 1 itinéraire supprimés sur le téléphone : ils sont dans la corbeille des deux appareils pour 30 jours');
    expect(said.rows[0].names[0]).toBe('sam. 14 nov. · Wing · Carnon-Plage');
    expect(said.rows[0].names[1]).toMatch(/\d/);
    expect(said.rows[0].names[2]).toBe('Tour du cap');
  });

  it('restaurée : dite « Restauré », jamais « envoyée » ni « supprimée »', () => {
    const back = item('newOnComputer', [OPS.toPhone], { restored: true });
    const both = item('newOnPhone', [OPS.toComputer], { restored: true });
    const tour = route('newOnComputer', [copyTo('phone')], { restored: true });
    const said = describeSync(outcomeOf([back, both], routesOf([tour])));
    expect(rowsOf(said)).toEqual([
      'Restauré : 1 session, 1 itinéraire sortis de la corbeille : renvoyés au téléphone',
      'Restauré : 1 session sortie de la corbeille : de nouveau sur les deux appareils',
    ]);
    expect(JSON.stringify(said)).not.toMatch(/Envoyé au téléphone|Reçu du téléphone|supprimé/i);
  });

  it('« Tout garder » ou « Les garder » : une ligne « Gardé », ces sessions ne sont pas dites envoyées', () => {
    const recopied = item('newOnComputer', [OPS.toPhone]);
    const said = describeSync(outcomeOf([recopied], {
      kept: { sessions: [recopied.startMs, T0], routes: ['r'], fromTrash: { sessions: [T0], routes: [] } },
      names: { sessions: { [T0]: 'Palavas' }, routes: { r: 'Baie' } },
    }));
    expect(rowsOf(said)).toEqual(['Gardé : 2 sessions, 1 itinéraire gardés : remis là où ils manquaient']);
    expect(said.rows[0].names).toEqual([expect.stringMatching(/\d/), 'Palavas', 'Baie']);
  });

  it('première synchronisation : rien n’a été supprimé, et où est la copie de sécurité ; l’écran de départ', () => {
    const said = describeSync(outcomeOf([item('newOnPhone', [OPS.toComputer])], { first: 'noBase', safetyCopy: 'C:\\copies\\x' }));
    expect(said.paragraphs).toEqual(["Première synchronisation : rien n'a été supprimé.", 'Copie de sécurité :']);
    expect(said.folder).toBe('C:\\copies\\x');
    expect(describeFirstStart('Redmi')).toEqual({
      title: 'Première synchronisation avec « Redmi »',
      lead: 'Chaque appareil va recevoir ce qui lui manque. Rien ne sera supprimé.',
      copy: 'Avant de commencer, Tracker copie les deux mémoires par sécurité.',
    });
  });

  it('la synchronisation précédente arrêtée en route est dite terminée, sauf si la reprise s’arrête elle aussi', () => {
    expect(describeSync(outcomeOf([], { interrupted: true })).paragraphs[0]).toBe("La synchronisation précédente s'était arrêtée en route : elle vient d'être terminée.");
    expect(describeSync(outcomeOf([], { interrupted: true, linkLost: 'coupé' })).paragraphs).toEqual([]);
  });

  it('modifiée des deux côtés : l’encadré dit la version gardée', () => {
    const both = item('followed', [OPS.record], { conflicts: ['notes'], conflictWinners: { notes: 'computer' } });
    expect(notesOf(describeSync(outcomeOf([both]))).some((n) => n.endsWith("La version de l'ordinateur a été gardée sur les deux."))).toBe(true);
  });
});

describe('compte rendu : ce qui n’a pas été fait', () => {
  it('garde des brouillons, restes, changée en route : la raison, puis la suite', () => {
    const drafted = item('deletedOnPhone', []);
    const changed = item('followed', []);
    const said = describeSync(outcomeOf([], { drafted: [drafted], cut: 1, skipped: [changed], names: { sessions: { [drafted.startMs]: 'Palavas' }, routes: {} } }));
    expect(notesOf(said)).toEqual([
      '1 session était en cours de modification : elle passera à la prochaine synchronisation.',
      "« Palavas » a des modifications non enregistrées : elle n'a pas été retirée. Enregistrez-la ou annulez, puis synchronisez de nouveau.",
      "1 élément n'a pas pu être traité entièrement cette fois : la prochaine synchronisation s'en chargera.",
    ]);
    expect(said.action).toBe('close');
  });

  it('écriture ratée sur l’ordinateur : « Recommencer », la raison repliée', () => {
    const said = describeSync(outcomeOf([], { failed: [{ item: item('newOnPhone', []), detail: 'disque plein.' }] }));
    expect(said.notes).toEqual([{ text: "1 session n'a pas pu être rangée sur l'ordinateur.", detail: 'disque plein' }]);
    expect(said.action).toBe('restart');
  });

  it('liaison perdue, panne ou enregistrement commencé : arrêtée en route, ce qui est fait est gardé, « Recommencer »', () => {
    const lost = describeSync(outcomeOf([item('newOnComputer', [OPS.toPhone])], { linkLost: 'câble débranché.' }));
    expect(lost).toMatchObject({ title: 'Synchronisation arrêtée', action: 'restart' });
    expect(lost.notes.at(-1)).toEqual({ text: "Le téléphone n'est plus relié : la synchronisation s'est arrêtée en route. Ce qui est fait est gardé.", detail: 'câble débranché' });
    const recording = describeSync(outcomeOf([], { recordingStarted: true }));
    expect(recording.title).toBe('Synchronisation arrêtée');
    expect(notesOf(recording).at(-1)).toMatch(/^Un enregistrement a commencé sur le téléphone/);
  });

  it('coquille qui n’écrit pas : dit une fois', () => {
    expect(notesOf(describeSync(outcomeOf([], { phoneWritable: false })))).toContain("Ce programme n'a rien pu écrire sur le téléphone : installez sa dernière version.");
  });

  it('question fermée sans réponse : ce qui attend, par appareil, et « Répondre »', () => {
    const question: SyncQuestion = {
      kind: 'guard',
      sessions: [{ startMs: 1, side: 'computer', file: 'a.gpx', label: 'a' }, { startMs: 2, side: 'phone', file: 'b.gpx', label: 'b' }],
      routes: [{ id: 'r', side: 'computer', label: 'tour' }],
    };
    const said = describeSync(outcomeOf([]), question);
    expect(notesOf(said)).toEqual(["Des suppressions attendent votre réponse : 1 session, 1 itinéraire sur le téléphone, 1 session sur l'ordinateur."]);
    expect(said.action).toBe('answer');
  });

  it('réponse qui n’a pas pu s’appliquer : la raison', () => {
    const said = describeSync(outcomeOf([]), null, { kind: 'phone', state: 'absent' });
    expect(notesOf(said)[0]).toMatch(/^Votre réponse n'a pas pu s'appliquer : rien n'a été supprimé ni remis\. Le téléphone ne répond plus\./);
  });
});

describe('synchronisation impossible et téléphone pas prêt', () => {
  it('refus : une phrase, avec où agir ; le téléphone qui enregistre, avec « Réessayer »', () => {
    expect(describeSync(emptySyncOutcome('phoneNoMarker'))).toMatchObject({ title: 'Synchronisation impossible', action: 'restart' });
    expect(describeSync(emptySyncOutcome('phoneRecording'))).toMatchObject({
      paragraphs: [expect.stringMatching(/^Le téléphone enregistre une session : rien n'a été fait/)], action: 'retry',
    });
    expect(describeSync({ ...emptySyncOutcome('safetyCopy'), error: 'disque plein.' })).toMatchObject({
      paragraphs: ["La copie de sécurité n'a pas pu être faite : rien n'a été synchronisé."], detail: 'disque plein', action: 'restart',
    });
  });

  it('coquille trop ancienne, panne avant l’échange ; avancement et sous-titre', () => {
    expect(describePhoneSync({ kind: 'cannotWrite' })).toMatchObject({ action: 'close', paragraphs: ['Ce programme ne sait pas encore écrire sur le téléphone : installez sa dernière version.'] });
    expect(describePhoneSync({ kind: 'error', detail: 'lecture impossible.' })).toMatchObject({ title: 'Synchronisation arrêtée', detail: 'lecture impossible', action: 'restart' });
    expect(syncSubtitle('Redmi')).toBe('Redmi · par le câble');
    expect(syncProgressText(12, 50)).toBe('Échange des sessions et des itinéraires : 12 fichiers sur 50.');
    expect(syncProgressText(0, 0)).toBe('Échange des sessions et des itinéraires…');
    expect(safetyCopyProgressText(0, 0)).toBe('Copie de sécurité des deux mémoires…');
    expect(computerScanText(12, 40)).toBe("L'ordinateur finit de mettre à jour ses sessions : 12 sur 40.");
    expect(describeNoPhone().title).toBe('Aucun téléphone relié');
  });
});

describe('la fenêtre qui attend', () => {
  const wait = (patch: Partial<SyncWait> = {}): SyncWait => ({
    reason: 'absent', phone: null, cable: null, count: null, folder: null, midway: false, detail: null, ...patch,
  });

  it('téléphone pas branché : quoi faire, et la synchronisation part seule', () => {
    expect(describeWait(wait({ phone: 'Redmi' }))).toMatchObject({
      title: 'En attente de votre téléphone', subtitle: 'Redmi', lead: null,
      steps: ['branchez-le à cet ordinateur par un câble USB ;', 'déverrouillez son écran.'],
      closing: "La synchronisation démarre toute seule dès qu'il est là.",
    });
    expect(describeWait(wait()).notes[0]).toMatch(/Débogage USB/);
  });

  it('liaison perdue, câble qui attend, ordinateur occupé', () => {
    expect(describeWait(wait({ reason: 'lost', midway: true })).lead).toMatch(/^Le téléphone n'est plus relié : la synchronisation s'est arrêtée en route\. Ce qui est fait est gardé\./);
    expect(describeWait(wait({ cable: 'autorisation' }))).toMatchObject({ steps: [], closing: null, lead: expect.stringMatching(/^Le téléphone branché demande une autorisation/) });
    expect(describeWait(wait({ cable: 'plusieurs', count: 2 })).lead).toMatch(/^Plusieurs appareils sont branchés à l'ordinateur \(2\)\./);
    expect(describeWait(wait({ cable: 'adbIntrouvable', folder: 'C:\\outil' }))).toMatchObject({ folder: 'C:\\outil', lead: expect.stringMatching(/SDK Platform-Tools/) });
    expect(describeWait(wait({ reason: 'busy' }))).toMatchObject({ title: 'Synchronisation en attente', lead: expect.stringMatching(/^L'ordinateur est occupé/) });
  });
});

describe('deux passes, un compte rendu', () => {
  it('la reprise d’une session changée en route : ce que la première a fait reste, la seconde dit l’état final', () => {
    const sent = item('newOnComputer', [OPS.toPhone]);
    const changed = item('followed', [OPS.record]);
    const first = outcomeOf([sent], { skipped: [changed], safetyCopy: 'C:\\copies\\x', first: 'noBase', phoneChanged: true });
    expect(syncHasChangedItems(first)).toBe(true);
    const merged = mergeSyncPasses(first, outcomeOf([changed]));
    expect(merged.done.map((i) => i.startMs)).toEqual([sent.startMs, changed.startMs]);
    expect(merged).toMatchObject({ skipped: [], safetyCopy: 'C:\\copies\\x', first: 'noBase', phoneChanged: true });
    expect(syncHasChangedItems(merged)).toBe(false);
  });

  it('une passe refusée laisse l’issue de la première ; une liaison perdue n’appelle pas de reprise', () => {
    const first = outcomeOf([item('newOnComputer', [OPS.toPhone])]);
    expect(mergeSyncPasses(first, emptySyncOutcome('busy'))).toBe(first);
    expect(syncHasChangedItems(outcomeOf([], { skipped: [item('followed', [])], linkLost: 'x' }))).toBe(false);
  });
});

describe('la question', () => {
  it('suppressions en nombre : rangées par appareil, noms visibles, deux réponses', () => {
    const onPhone = item('deletedOnPhone', [OPS.trash]);
    const onComputer = item('deletedOnComputer', [OPS.remove]);
    const tour = route('deletedOnComputer', []);
    const question = describeSyncQuestion(outcomeOf([], {
      deletions: 'awaitingConfirmation', withheldDeletions: [onPhone, onComputer], routes: { ...emptySyncOutcome(null).routes, withheldDeletions: [tour] },
      names: { sessions: { [onPhone.startMs]: 'Palavas' }, routes: {} },
    }));
    expect(question).toMatchObject({ kind: 'guard', sessions: [{ startMs: onPhone.startMs, side: 'computer', label: 'Palavas' }, { side: 'phone' }], routes: [{ side: 'phone', label: 'tour' }] });
    const text = describeQuestion(question!);
    expect(text).toMatchObject({ title: "Beaucoup de suppressions d'un coup", intro: 'Depuis la dernière synchronisation :', keepLabel: 'Tout garder', removeLabel: 'Supprimer des deux côtés' });
    expect(rowsOf({ rows: text.rows } as SyncReport)).toEqual(['Sur le téléphone : 1 session supprimée', "Sur l'ordinateur : 1 session, 1 itinéraire supprimés"]);
    expect(text.ask).toBe("Faut-il les supprimer aussi de l'autre appareil ? Rien n'est perdu : tout reste 30 jours dans la corbeille des deux appareils.");
    expect(text.hint).toMatch(/Fermer la fenêtre ne décide rien : la question reviendra\.$/);
  });

  it('une seule suppression : le titre et la question s’accordent', () => {
    const text = describeQuestion({ kind: 'guard', sessions: [{ startMs: 1, side: 'computer', file: 'a.gpx', label: 'a' }], routes: [] });
    expect(text.title).toBe('Une suppression à confirmer');
    expect(text.ask).toMatch(/^Faut-il la supprimer aussi de l'autre appareil \?/);
  });

  it('corbeille encore sur le téléphone : seulement si rien ne s’est arrêté ; réponses accordées', () => {
    const held = item('deletedOnComputer', [], { left: 'inTrash' });
    expect(describeSyncQuestion(outcomeOf([held]))).toMatchObject({ kind: 'inTrash', sessions: [{ side: 'phone' }] });
    expect(describeSyncQuestion(outcomeOf([held], { linkLost: 'x' }))).toBeNull();
    expect(describeSyncQuestion(outcomeOf([held], { recordingStarted: true }))).toBeNull();
    const text = describeQuestion(describeSyncQuestion(outcomeOf([held]))!);
    expect(text).toMatchObject({ title: 'Supprimée ici, encore sur le téléphone', keepLabel: 'La garder', removeLabel: 'La retirer du téléphone', ask: null });
  });
});
