import { describe, expect, it } from 'vitest';
import {
  bandIndex, clamp, errorMessage, finiteOr, inRange, isFiniteNumber, isObject, meanOf, median, medianOfSorted, parseJson, plural, readCommands, roundTo,
  stringifyJson, toFixedNumber, upperMedianOfSorted,
} from './basics';

// Copies gelées des anciennes écritures : les briques doivent rendre la même chose.
const oldRound1 = (x: number): number => Math.round(x * 10) / 10;
const oldRound2 = (x: number): number => Math.round(x * 100) / 100;
const oldFixed3 = (x: number): number => parseFloat(x.toFixed(3));
const oldRange = (raw: unknown, lo: number, hi: number): boolean => typeof raw === 'number' && isFinite(raw) && raw >= lo && raw <= hi;
const oldInlineError = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);
const oldZoneOf = (bpm: number, bounds: readonly number[]): number => {
  let zone = 0;
  for (const b of bounds) if (bpm >= b) zone++;
  return zone;
};
const oldMean = (values: number[]): number | null => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

const LIMITS: unknown[] = [0, -0, -1, 59.5, 1.005, 1.0049, 2.675, 0.1 + 0.2, NaN, Infinity, -Infinity, '', '5', null, undefined, {}, [], 1e21];

describe('basics', () => {
  it('borne une valeur', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('reconnaît un objet simple', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject('a')).toBe(false);
  });

  it('reconnaît un nombre fini', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber('1')).toBe(false);
  });

  it('accorde le pluriel', () => {
    expect(plural(0, 'fichier')).toBe('0 fichier');
    expect(plural(1, 'fichier')).toBe('1 fichier');
    expect(plural(2, 'fichier')).toBe('2 fichiers');
  });

  it('arrondit chaque site avec sa formule', () => {
    for (const x of LIMITS.filter((v): v is number => typeof v === 'number')) {
      expect(roundTo(x, 1)).toEqual(oldRound1(x));
      expect(roundTo(x, 2)).toEqual(oldRound2(x));
      expect(toFixedNumber(x, 3)).toEqual(oldFixed3(x));
    }
    // Les deux formules diffèrent : chaque site garde la sienne.
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(toFixedNumber(2.675, 2)).toBe(2.67);
    expect(roundTo(1.45, 1)).toBe(1.5);
    expect(toFixedNumber(1.45, 1)).toBe(1.4);
  });

  it('reconnaît un nombre dans une plage, comme avant', () => {
    for (const v of LIMITS) {
      expect(inRange(v, 0, 10)).toBe(oldRange(v, 0, 10));
      expect(inRange(v, 1.005, 59.5)).toBe(oldRange(v, 1.005, 59.5));
    }
    expect(inRange(10, 0, 10)).toBe(true);
    expect(inRange(0, 0, 10)).toBe(true);
  });

  it('rend le nombre fini ou le repli', () => {
    for (const v of LIMITS) {
      expect(finiteOr(v, null)).toEqual(typeof v === 'number' && isFinite(v) ? v : null);
      expect(finiteOr(v, undefined)).toEqual(typeof v === 'number' && isFinite(v) ? v : undefined);
    }
    expect(finiteOr('x', 7)).toBe(7);
  });

  it('lit un JSON sans exception', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2]')).toEqual([1, 2]);
    expect(parseJson('null')).toBeNull();
    expect(parseJson('{abc')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });

  it("fait la moyenne d'une liste", () => {
    for (const list of [[], [3], [1, 2, 3, 4], [0.1, 0.2, 0.3], [-5, 5], [1e-9, 1e9]]) {
      expect(meanOf(list)).toEqual(oldMean(list));
    }
    expect(meanOf([])).toBeNull();
  });

  it("donne le message d'une erreur ou le repli", () => {
    expect(errorMessage(new Error('boum'), 'repli')).toBe('boum');
    expect(errorMessage(new Error(''), 'repli')).toBe('repli');
    expect(errorMessage('texte', 'repli')).toBe('repli');
    expect(errorMessage(null)).toBe('erreur inconnue');
    // Même chose que l'ancienne écriture en ligne, sauf le message vide.
    for (const err of [new Error('boum'), new TypeError('x'), 'texte', null, undefined, 3]) {
      expect(errorMessage(err, 'repli')).toBe(oldInlineError(err, 'repli'));
    }
  });

  it('range une valeur parmi des bornes croissantes', () => {
    const bounds = [100, 120, 140, 160, 180];
    for (const bpm of [-1, 0, 99, 100, 100.5, 120, 139.9, 160, 179, 180, 250, NaN]) {
      expect(bandIndex(bpm, bounds)).toBe(oldZoneOf(bpm, bounds));
    }
    expect(bandIndex(90, bounds)).toBe(0);
    expect(bandIndex(195, bounds)).toBe(5);
    expect(bandIndex(5, [])).toBe(0);
  });

  it('relit des commandes datées', () => {
    const kinds = ['lap', 'pause'] as const;
    expect(readCommands('x', kinds)).toBeNull();
    expect(readCommands(null, kinds)).toBeNull();
    expect(readCommands([], kinds)).toEqual([]);
    expect(
      readCommands(
        [{ kind: 'lap', atMs: 5, extra: 1 }, { kind: 'resume', atMs: 6 }, { kind: 'pause', atMs: NaN }, { kind: 'pause', atMs: '7' }, null, 3, { kind: 'pause', atMs: 8 }],
        kinds
      )
    ).toEqual([{ kind: 'lap', atMs: 5 }, { kind: 'pause', atMs: 8 }]);
  });
});

describe('médianes (lot 57)', () => {
  // Copies gelées : `median` de speedFilter, `sortedMedian` de kinematics, médiane haute d'imuVertical.
  const oldMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  const oldUpper = (values: Float64Array): number => {
    const sorted = Float64Array.from(values).sort();
    return sorted[sorted.length >> 1];
  };
  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const lists = [[], [3], [1, 2], [2, 1, 2], [0.1, 0.2, 0.30000000000000004], ...Array.from({ length: 50 }, (_, k) => Array.from({ length: k }, () => (rnd() - 0.3) * 1e3))];

  it('moyenne des deux centrales, 0 sur une liste vide, liste laissée telle quelle', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    for (const l of lists) {
      const copy = [...l];
      expect(median(l)).toBe(oldMedian(l));
      expect(l).toEqual(copy);
      expect(medianOfSorted(Float64Array.from(l).sort())).toBe(oldMedian(l));
    }
  });

  it('médiane haute des capteurs : la valeur du milieu, la plus haute des deux centrales', () => {
    expect(upperMedianOfSorted([1, 2, 3, 4])).toBe(3);
    for (const l of lists.filter((x) => x.length > 0)) {
      const f = Float64Array.from(l);
      expect(upperMedianOfSorted(Float64Array.from(f).sort())).toBe(oldUpper(f));
    }
  });
});

describe('stringifyJson (lot 80)', () => {
  /** Valeurs sans tableau de nombres : le texte est celui de `JSON.stringify(value, null, 2)`. */
  const plain: [string, unknown][] = [
    ['objet vide', {}],
    ['tableau vide', []],
    ['objet imbriqué', { a: { b: { c: 'texte' } }, d: 'é"\\n', e: {} }],
    ['textes avec crochets et retours à la ligne', { s: '[1,2]\n[3]', t: ['[', ']', '{\n}'] }],
    ['tableau de textes et d\'objets', ['a', { b: 1 }, ['c'], [{ d: 2 }]]],
    ['undefined, fonction, symbole omis dans un objet', { a: undefined, b: () => 1, c: Symbol('x'), d: 'gardé' }],
    ['undefined, fonction, symbole à null dans un tableau', ['x', undefined, () => 1, Symbol('y')]],
    ['date et toJSON', { quand: new Date(Date.UTC(2026, 9, 30)), propre: { toJSON: (key: string) => `clé ${key}` } }],
    ['nombres seuls', { n: 1, m: -0, o: 1e21, p: 1.5e-7, q: NaN, r: -Infinity, s: true, t: null }],
    ['objets en boîte', { n: Object(3), s: Object('x'), b: Object(false) }],
    ['scalaires', 'texte'],
  ];

  it.each(plain)('%s : comme JSON.stringify indenté', (_, value) => {
    expect(stringifyJson(value)).toBe(JSON.stringify(value, null, 2));
  });

  it('rend undefined comme JSON.stringify pour une valeur non écrite', () => {
    expect(stringifyJson(undefined)).toBeUndefined();
    expect(stringifyJson(() => 1)).toBeUndefined();
    expect(stringifyJson(5)).toBe('5');
    expect(stringifyJson(null)).toBe('null');
  });

  it('écrit un tableau de nombres, de null ou de booléens sur une ligne, et les tableaux de tels tableaux', () => {
    expect(stringifyJson({ z: [1, null, -2.5, 1e-7, 1e21, NaN, Infinity, true], runs: [[0, 0], [125_000, -1]], vide: [[]] }))
      .toBe('{\n  "z": [1,null,-2.5,1e-7,1e+21,null,null,true],\n  "runs": [[0,0],[125000,-1]],\n  "vide": [[]]\n}');
    // Un tableau mêlé reste indenté, ses tableaux de nombres sur une ligne.
    expect(stringifyJson([[1, 2], 'a', [[3]], [[[4]]]])).toBe('[\n  [1,2],\n  "a",\n  [[3]],\n  [\n    [[4]]\n  ]\n]');
    expect(stringifyJson([undefined, 1])).toBe('[\n  null,\n  1\n]');
  });

  it('se relit en la même valeur que JSON.stringify', () => {
    const values: unknown[] = [
      ...plain.map(([, v]) => v),
      { t: Array.from({ length: 50 }, (_, i) => i * 0.1), z: [null, 3, -4], h: { seconds: [0, 0.25, 1e-9] }, l: [[1, [2]], [3]] },
      [[1, 2], [3, 4]], [[1, 'a']], [{ a: [1] }], [[], [1]], [-0, 0],
    ];
    for (const v of values) expect(JSON.parse(stringifyJson(v) ?? 'null')).toEqual(JSON.parse(JSON.stringify(v) ?? 'null'));
  });
});
