import { describe, expect, it } from 'vitest';
import { addBelt, beltLabels, forgetBelt, isBelt, learnBeltAddressType, readBeltList } from './beltList';

/** Appareils cardio retenus (lot 198) : plusieurs en mémoire, un seul actif, rien perdu à la mise à jour. */

const hrm = { address: 'AA:AA:AA:AA:11:11', name: 'HRM-Dual' };
const decathlon = { address: 'BB:BB:BB:BB:22:22', name: 'Decathlon HR', random: true };
const polar = { address: 'CC:CC:CC:CC:33:33', name: 'Polar H10' };

describe('lecture de la liste retenue', () => {
  it("ancienne clé seule (version d'avant la liste) : la ceinture choisie devient la liste, rien n'est perdu", () => {
    expect(readBeltList(null, hrm)).toEqual([hrm]);
  });

  it('ni liste ni ceinture : liste vide', () => {
    expect(readBeltList(null, null)).toEqual([]);
    expect(readBeltList(undefined, null)).toEqual([]);
  });

  it("liste vide gardée vide sans appareil actif ; l'actif s'y ajoute s'il existe", () => {
    expect(readBeltList([], null)).toEqual([]);
    expect(readBeltList([], hrm)).toEqual([hrm]);
  });

  it("appareil actif changé par une ancienne version, absent de la liste : ajouté en tête, la liste gardée", () => {
    expect(readBeltList([hrm, decathlon], polar)).toEqual([polar, hrm, decathlon]);
  });

  it("appareil actif déjà dans la liste : rien n'est ajouté ni déplacé", () => {
    expect(readBeltList([hrm, decathlon], decathlon)).toEqual([hrm, decathlon]);
  });

  it('liste illisible ou entrées abîmées : écartées, les lisibles gardées, adresses en double fondues', () => {
    expect(readBeltList('abîmée', hrm)).toEqual([hrm]);
    expect(readBeltList([hrm, { address: 3 }, null, { ...hrm, name: 'Autre nom' }, decathlon], null)).toEqual([hrm, decathlon]);
  });

  it("une entrée lue ne garde que ce qui se retient (pas la force du signal d'une recherche)", () => {
    expect(readBeltList([{ ...hrm, rssi: -50 }], null)).toEqual([hrm]);
  });

  it('isBelt : adresse et nom exigés, type d\'adresse booléen ou absent', () => {
    expect(isBelt(hrm)).toBe(true);
    expect(isBelt(decathlon)).toBe(true);
    expect(isBelt({ ...hrm, random: 'oui' })).toBe(false);
    expect(isBelt({ address: 'x' })).toBe(false);
  });
});

describe('ajout', () => {
  it('un nouvel appareil va en fin de liste', () => {
    expect(addBelt([hrm], decathlon)).toEqual([hrm, decathlon]);
  });

  it("ajout en double (même adresse) : l'entrée est mise à jour à sa place, pas doublée", () => {
    expect(addBelt([hrm, decathlon], { ...hrm, name: 'HRM-Dual 2' })).toEqual([{ ...hrm, name: 'HRM-Dual 2' }, decathlon]);
  });

  it("un type d'adresse connu n'est pas perdu par un ajout qui ne le dit pas", () => {
    expect(addBelt([decathlon], { address: decathlon.address, name: decathlon.name })).toEqual([decathlon]);
  });

  it("ne modifie pas la liste donnée (lue gelée du stockage)", () => {
    const list = Object.freeze([Object.freeze({ ...hrm })]);
    expect(() => addBelt(list, polar)).not.toThrow();
    expect(list).toHaveLength(1);
  });
});

describe('oubli', () => {
  it("oublier un autre que l'actif : l'actif reste", () => {
    expect(forgetBelt([hrm, decathlon, polar], decathlon.address, hrm)).toEqual({ list: [hrm, polar], active: hrm });
  });

  it("oublier l'actif : celui qui le suivait le devient", () => {
    expect(forgetBelt([hrm, decathlon, polar], decathlon.address, decathlon)).toEqual({ list: [hrm, polar], active: polar });
  });

  it("oublier l'actif en fin de liste : le précédent le devient", () => {
    expect(forgetBelt([hrm, decathlon], decathlon.address, decathlon)).toEqual({ list: [hrm], active: hrm });
  });

  it("oublier le dernier : liste vide, plus d'appareil actif", () => {
    expect(forgetBelt([hrm], hrm.address, hrm)).toEqual({ list: [], active: null });
  });

  it('oublier une adresse inconnue : rien ne change', () => {
    expect(forgetBelt([hrm], polar.address, hrm)).toEqual({ list: [hrm], active: hrm });
  });
});

describe("type d'adresse appris", () => {
  it("posé sur l'entrée de même adresse qui ne l'avait pas", () => {
    expect(learnBeltAddressType([hrm, polar], hrm.address, true)).toEqual([{ ...hrm, random: true }, polar]);
  });

  it('même liste (même objet) si rien ne change : type déjà connu, inconnu, ou adresse absente', () => {
    const list = [hrm, decathlon];
    expect(learnBeltAddressType(list, decathlon.address, false)).toBe(list);
    expect(learnBeltAddressType(list, hrm.address, undefined)).toBe(list);
    expect(learnBeltAddressType(list, polar.address, true)).toBe(list);
    expect(learnBeltAddressType(list, undefined, true)).toBe(list);
  });
});

describe('noms montrés', () => {
  it('noms distincts : tels quels', () => {
    expect(beltLabels([hrm, decathlon])).toEqual(['HRM-Dual', 'Decathlon HR']);
  });

  it("même nom : la fin de l'adresse s'ajoute à chacun", () => {
    const other = { address: 'DD:DD:DD:DD:44:44', name: 'HRM-Dual' };
    expect(beltLabels([hrm, decathlon, other])).toEqual(['HRM-Dual · 11:11', 'Decathlon HR', 'HRM-Dual · 44:44']);
  });
});
