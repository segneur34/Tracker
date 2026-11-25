import { describe, expect, it } from 'vitest';
import { restingHrFileText, type StoredRestingResult } from './restingHrStore';
import { buildSettingsFile, serializeSettingsFile } from './settingsFile';
import { planSyncExtras, unknownSyncActivity, type SyncExtrasInput } from './syncExtras';

const PC = 'appareil-ordinateur';
const TEL = 'appareil-telephone';

/** Texte d'un fichier de réglages écrit par l'appareil `id`, à l'instant `savedAt`. */
const settings = (id: string | null, name: string, savedAt: number, activities: string[] = ['wingfoil'], version?: number): string => {
  const file = buildSettingsFile(
    { 'tracker.sportSettings': { activities: activities.map((a) => ({ id: a, name: a, base: 'wingfoil' })) } },
    savedAt, null, id === null ? null : { id, name },
  );
  return serializeSettingsFile(version ? { ...file, version } : file);
};

const input = (patch: Partial<SyncExtrasInput>): SyncExtrasInput => ({
  settings: { computer: [], phone: [] }, restingHr: { computer: null, phone: null },
  computerDeviceId: PC, ...patch,
});

const resting = (startedAtMs: number): StoredRestingResult => ({
  startedAtMs, version: 1, lowestBpm: 48, fromS: 60, toS: 120, meanBpm: 52, maxBpm: 60, coverage: 1, series: [50, 49, 48],
});


describe('fichiers de réglages', () => {
  it('chaque côté reçoit le fichier que l’autre a et qu’il n’a pas, sans rien écraser', () => {
    const pc = settings(PC, 'PC', 100);
    const tel = settings(TEL, 'Téléphone', 200);
    const plan = planSyncExtras(input({ settings: { computer: [{ name: 'PC.json', text: pc }], phone: [{ name: 'Telephone.json', text: tel }] } }));
    expect(plan.ops).toEqual([
      { kind: 'settings', to: 'phone', path: 'reglages/PC.json', text: pc, replaces: null, added: 0 },
      { kind: 'settings', to: 'computer', path: 'reglages/Telephone.json', text: tel, replaces: null, added: 0 },
    ]);
    expect(plan.left).toEqual([]);
  });

  it('changé chez son propriétaire : la copie de l’ordinateur suit celle du téléphone', () => {
    const old = settings(TEL, 'Téléphone', 200);
    const fresh = settings(TEL, 'Téléphone', 300, ['wingfoil', 'a-moth']);
    const toComputer = planSyncExtras(input({ settings: { computer: [{ name: 'Telephone.json', text: old }], phone: [{ name: 'Telephone.json', text: fresh }] } }));
    expect(toComputer.ops).toEqual([{ kind: 'settings', to: 'computer', path: 'reglages/Telephone.json', text: fresh, replaces: old, added: 0 }]);
    expect(toComputer.left).toEqual([]);
  });

  it('date du fichier du téléphone qui a reculé : la copie de l’ordinateur, plus datée, ne l’écrase jamais', () => {
    // Téléphone neuf qui a repris la date d'un fichier de l'ordinateur, ou horloge du téléphone remise en arrière.
    const computerCopy = settings(TEL, 'Téléphone', 500);
    const phoneOwn = settings(TEL, 'Téléphone', 100, ['wingfoil', 'a-moth']);
    for (const phoneDeviceId of [TEL, null]) {
      const plan = planSyncExtras(input({ phoneDeviceId, settings: { computer: [{ name: 'Telephone.json', text: computerCopy }], phone: [{ name: 'Telephone.json', text: phoneOwn }] } }));
      expect(plan.ops).toEqual([{ kind: 'settings', to: 'computer', path: 'reglages/Telephone.json', text: phoneOwn, replaces: computerCopy, added: 0 }]);
      expect(plan.left).toEqual([]);
    }
    // Même date, contenus différents : la copie du téléphone fait foi de même.
    const sameDate = settings(TEL, 'Téléphone', 500, ['kite']);
    const same = planSyncExtras(input({ phoneDeviceId: TEL, settings: { computer: [{ name: 'Telephone.json', text: computerCopy }], phone: [{ name: 'Telephone.json', text: sameDate }] } }));
    expect(same.ops.map((op) => [op.to, op.text])).toEqual([['computer', sameDate]]);
  });

  it('deux téléphones : la vieille copie du fichier de l’un, gardée par l’autre, ne remplace pas la copie récente de l’ordinateur', () => {
    // Le téléphone A a changé ses réglages et s'est synchronisé (500) ; le téléphone B, relié, tient encore l'ancienne copie (100).
    const B = 'appareil-telephone-b';
    const computerCopy = settings(TEL, 'Téléphone A', 500, ['wingfoil', 'a-moth']);
    const staleOnB = settings(TEL, 'Téléphone A', 100);
    const plan = planSyncExtras(input({ phoneDeviceId: B, settings: { computer: [{ name: 'A.json', text: computerCopy }], phone: [{ name: 'A.json', text: staleOnB }] } }));
    expect(plan.ops).toEqual([{ kind: 'settings', to: 'phone', path: 'reglages/A.json', text: computerCopy, replaces: staleOnB, added: 0 }]);
    expect(plan.left).toEqual([]);
    // La copie la plus récente vient de B : elle passe à l'ordinateur ; à même date, celle de B l'emporte.
    const fresherOnB = settings(TEL, 'Téléphone A', 900, ['kite']);
    const up = planSyncExtras(input({ phoneDeviceId: B, settings: { computer: [{ name: 'A.json', text: computerCopy }], phone: [{ name: 'A.json', text: fresherOnB }] } }));
    expect(up.ops.map((op) => [op.to, op.text])).toEqual([['computer', fresherOnB]]);
    const sameDate = settings(TEL, 'Téléphone A', 500, ['kite']);
    const same = planSyncExtras(input({ phoneDeviceId: B, settings: { computer: [{ name: 'A.json', text: computerCopy }], phone: [{ name: 'A.json', text: sameDate }] } }));
    expect(same.ops.map((op) => [op.to, op.text])).toEqual([['computer', sameDate]]);
    // B d'une version qui ne dit pas qui il est : la copie du téléphone l'emporte, comme avant.
    const unknown = planSyncExtras(input({ phoneDeviceId: null, settings: { computer: [{ name: 'A.json', text: computerCopy }], phone: [{ name: 'A.json', text: staleOnB }] } }));
    expect(unknown.ops.map((op) => [op.to, op.text])).toEqual([['computer', staleOnB]]);
    // Le fichier propre de l'ordinateur, lui, n'est jamais écrit par le téléphone, même daté d'avant sa copie.
    const pcOwn = settings(PC, 'PC', 100);
    const pcCopy = settings(PC, 'PC', 500, ['kite']);
    const back = planSyncExtras(input({ phoneDeviceId: B, settings: { computer: [{ name: 'PC.json', text: pcOwn }], phone: [{ name: 'PC.json', text: pcCopy }] } }));
    expect(back.ops.map((op) => [op.to, op.text])).toEqual([['phone', pcOwn]]);
  });

  it('même nom sans identifiant d’appareil : pas pris pour le même appareil, rien n’est écrasé, c’est dit', () => {
    const older = settings(null, 'PC', 100);
    const newer = settings(null, 'PC', 900, ['kite']);
    for (const [computer, phone] of [[older, newer], [newer, older]] as const) {
      const plan = planSyncExtras(input({ settings: { computer: [{ name: 'PC.json', text: computer }], phone: [{ name: 'PC.json', text: phone }] } }));
      expect(plan.ops).toEqual([]);
      expect(plan.left).toEqual([{ kind: 'settings', path: 'reglages/PC.json', side: null, reason: 'unknownDevice' }]);
    }
    // Identifiant de l'ordinateur inconnu : le fichier peut être le sien comme celui du téléphone, aucun ne remplace l'autre.
    const unknownPc = planSyncExtras(input({
      computerDeviceId: null,
      settings: { computer: [{ name: 'T.json', text: settings(TEL, 'T', 100) }], phone: [{ name: 'T.json', text: settings(TEL, 'T', 200, ['kite']) }] },
    }));
    expect(unknownPc.ops).toEqual([]);
    expect(unknownPc.left.map((l) => [l.path, l.side, l.reason])).toEqual([['reglages/T.json', null, 'unknownDevice']]);
  });

  it('le fichier propre de l’ordinateur fait foi : jamais remplacé sur l’ordinateur, jamais recopié sur lui', () => {
    const mine = settings(PC, 'PC', 100);
    const imported = settings(PC, 'PC', 900);
    const plan = planSyncExtras(input({ settings: { computer: [{ name: 'PC.json', text: mine }], phone: [{ name: 'PC.json', text: imported }] } }));
    expect(plan.ops).toEqual([{ kind: 'settings', to: 'phone', path: 'reglages/PC.json', text: mine, replaces: imported, added: 0 }]);
    // Absent de l'ordinateur sous ce nom : l'ordinateur écrit seul son fichier, celui du téléphone ne lui est pas donné.
    const absent = planSyncExtras(input({ settings: { computer: [], phone: [{ name: 'Ancien PC.json', text: imported }] } }));
    expect(absent.ops).toEqual([]);
    expect(absent.left).toEqual([{ kind: 'settings', path: 'reglages/Ancien PC.json', side: 'phone', reason: 'ownFile' }]);
  });

  it('même nom, appareils différents : rien n’est écrasé, c’est dit', () => {
    const a = settings(TEL, 'Téléphone', 100);
    const b = settings('autre-telephone', 'Téléphone', 900);
    const plan = planSyncExtras(input({ settings: { computer: [{ name: 'Téléphone.json', text: a }], phone: [{ name: 'téléphone.json', text: b }] } }));
    expect(plan.ops).toEqual([]);
    expect(plan.left).toEqual([{ kind: 'settings', path: 'reglages/Téléphone.json', side: null, reason: 'otherDevice' }]);
    // Un fichier sans appareil (version 1) et un fichier d'appareil du même nom ne sont pas le même fichier.
    const legacy = planSyncExtras(input({ settings: { computer: [{ name: 'PC.json', text: settings(null, 'PC', 50) }], phone: [{ name: 'PC.json', text: settings('x-appareil', 'PC', 60) }] } }));
    expect(legacy.left.map((l) => l.reason)).toEqual(['otherDevice']);
  });

  it('appareil renommé : l’ancien nom ne revient pas là où une version au moins aussi récente est déjà sous le nouveau', () => {
    const before = settings(TEL, 'Ancien', 200);
    const after = settings(TEL, 'Nouveau', 250);
    const plan = planSyncExtras(input({ settings: { computer: [{ name: 'Ancien.json', text: before }], phone: [{ name: 'Nouveau.json', text: after }] } }));
    expect(plan.ops.map((op) => [op.to, op.path])).toEqual([['computer', 'reglages/Nouveau.json']]);
    expect(plan.left).toEqual([{ kind: 'settings', path: 'reglages/Ancien.json', side: 'computer', reason: 'outdated' }]);
    // Renommé sans autre changement (même date) : on ne sait pas lequel est le nom du moment, aucun ne voyage.
    const same = planSyncExtras(input({ settings: { computer: [{ name: 'Ancien.json', text: before }], phone: [{ name: 'Nouveau.json', text: settings(TEL, 'Nouveau', 200) }] } }));
    expect(same.ops).toEqual([]);
    expect(same.left.map((l) => [l.path, l.reason])).toEqual([['reglages/Ancien.json', 'outdated'], ['reglages/Nouveau.json', 'outdated']]);
  });

  it('illisible : ni recopié, ni écrasé ; d’une version plus récente : jamais écrasé', () => {
    const good = settings(TEL, 'Téléphone', 200);
    const unreadable = planSyncExtras(input({ settings: { computer: [{ name: 'Abîmé.json', text: '{abîmé' }, { name: 'T.json', text: '{' }], phone: [{ name: 'T.json', text: good }] } }));
    expect(unreadable.ops).toEqual([]);
    expect(unreadable.left.map((l) => [l.path, l.side, l.reason])).toEqual([
      ['reglages/Abîmé.json', 'computer', 'unreadable'], ['reglages/T.json', 'computer', 'unreadable'],
    ]);
    const future = settings(TEL, 'Téléphone', 100, ['wingfoil'], 9);
    const newer = planSyncExtras(input({ settings: { computer: [{ name: 'T.json', text: future }], phone: [{ name: 'T.json', text: good }] } }));
    expect(newer.ops).toEqual([]);
    expect(newer.left.map((l) => [l.side, l.reason])).toEqual([['computer', 'newer']]);
    // Là où il manque, il est recopié tel quel : rien n'est réécrit.
    expect(planSyncExtras(input({ settings: { computer: [{ name: 'T.json', text: future }], phone: [] } })).ops.map((op) => op.to)).toEqual(['phone']);
  });

  it('les mêmes fichiers des deux côtés : rien à faire', () => {
    const files = [{ name: 'PC.json', text: settings(PC, 'PC', 1) }, { name: 'T.json', text: settings(TEL, 'T', 2) }];
    expect(planSyncExtras(input({ settings: { computer: files, phone: files } }))).toEqual({ ops: [], copies: [], left: [] });
  });
});

describe('tests de FC repos', () => {
  it('FC repos : union écrite de chaque côté où elle diffère, rien de perdu', () => {
    const pc = restingHrFileText([resting(3), resting(1)]);
    const tel = restingHrFileText([resting(2), resting(1)]);
    const plan = planSyncExtras(input({ restingHr: { computer: pc, phone: tel } }));
    const union = restingHrFileText([resting(3), resting(2), resting(1)]);
    expect(plan.ops).toEqual([
      { kind: 'restingHr', to: 'computer', path: 'fc-repos.json', text: union, replaces: pc, added: 1 },
      { kind: 'restingHr', to: 'phone', path: 'fc-repos.json', text: union, replaces: tel, added: 1 },
    ]);
    // Absent d'un côté : il y est écrit ; absent des deux : rien.
    expect(planSyncExtras(input({ restingHr: { computer: null, phone: tel } })).ops.map((op) => [op.to, op.replaces])).toEqual([['computer', null]]);
    expect(planSyncExtras(input({})).ops).toEqual([]);
    expect(planSyncExtras(input({ restingHr: { computer: union, phone: union } })).ops).toEqual([]);
  });

  it('FC repos illisible ou d’une version plus récente d’un côté : rien n’est écrit d’aucun côté, c’est dit', () => {
    const tel = restingHrFileText([resting(2)]);
    const unreadable = planSyncExtras(input({ restingHr: { computer: '{abîmé', phone: tel } }));
    expect(unreadable.ops).toEqual([]);
    expect(unreadable.left).toEqual([{ kind: 'restingHr', path: 'fc-repos.json', side: 'computer', reason: 'unreadable' }]);
    const future = JSON.stringify({ ...JSON.parse(tel), version: 2 });
    const newer = planSyncExtras(input({ restingHr: { computer: restingHrFileText([resting(5)]), phone: future } }));
    expect(newer.ops).toEqual([]);
    expect(newer.left.map((l) => [l.side, l.reason])).toEqual([['phone', 'newer']]);
  });

  it('FC repos d’une version plus récente des deux côtés, ou du même côté que l’absence : rien n’est écrit', () => {
    const future = JSON.stringify({ ...JSON.parse(restingHrFileText([resting(2)])), version: 2 });
    expect(planSyncExtras(input({ restingHr: { computer: null, phone: future } })).ops).toEqual([]);
    expect(planSyncExtras(input({ restingHr: { computer: future, phone: future } })).left.map((l) => l.side)).toEqual(['computer', 'phone']);
  });
});

describe('journaux d’enregistrement', () => {
  const stamp = (name: string, size = 100) => ({ name, size, mtimeMs: 5 });

  it('copiés du téléphone vers l’ordinateur seulement, là où l’ordinateur n’a pas ce nom', () => {
    const plan = planSyncExtras(input({ journals: { computer: [stamp('a.json'), stamp('pc.json')], phone: [stamp('b.json'), stamp('A.JSON')] } }));
    expect(plan.copies).toEqual([{ kind: 'journal', to: 'computer', path: 'journaux/b.json', source: stamp('b.json') }]);
    expect(plan.ops).toEqual([]);
    expect(plan.left).toEqual([]);
  });

  it('même nom, autre taille : laissé, jamais écrasé, c’est dit ; les temporaires ne voyagent pas', () => {
    const plan = planSyncExtras(input({ journals: { computer: [stamp('a.json', 10)], phone: [stamp('a.json', 20), stamp('c.json.tracker-new')] } }));
    expect(plan.copies).toEqual([]);
    expect(plan.left).toEqual([{ kind: 'journal', path: 'journaux/a.json', side: null, reason: 'sameName' }]);
  });

  it('sans listage des journaux : rien', () => {
    expect(planSyncExtras(input({})).copies).toEqual([]);
  });
});

describe('activité inconnue de l’appareil qui reçoit une fiche', () => {
  it('ni dans sa liste, ni un calcul : son identifiant ; sinon rien', () => {
    expect(unknownSyncActivity(JSON.stringify({ activityId: 'a-moth' }), ['wingfoil'])).toBe('a-moth');
    expect(unknownSyncActivity(JSON.stringify({ activityId: 'a-moth' }), ['a-moth'])).toBeNull();
    expect(unknownSyncActivity(JSON.stringify({ activityId: 'kite' }), [])).toBeNull();
    expect(unknownSyncActivity(JSON.stringify({ activityId: null }), [])).toBeNull();
    expect(unknownSyncActivity('{abîmé', [])).toBeNull();
  });
});
