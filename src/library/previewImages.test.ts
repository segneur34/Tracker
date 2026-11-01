import { describe, expect, it } from 'vitest';
import {
  PREVIEW_IMAGE_INDEX_VERSION, allTilesPresent, parsePreviewImageIndex, previewImageKey, previewImageName, type PreviewImageParts,
} from './previewImages';

const PARTS: PreviewImageParts = {
  cacheKey: 'T|a.gpx|running|null|running',
  fingerprint: 'running|null|running|1|2|1200|1.9',
  width: 120,
  height: 90,
  pixelRatio: 2,
  eco: false,
  minMs: 2,
  maxMs: 5,
};

describe('clé de l’image d’une vignette', () => {
  it('change avec chacun de ce dont l’image dépend', () => {
    const base = previewImageKey(PARTS);
    const variants: Partial<PreviewImageParts>[] = [
      { cacheKey: 'T|b.gpx|running|null|running' },
      { fingerprint: 'running|null|running|1|2|1201|1.9' },
      { width: 121 },
      { height: 91 },
      { pixelRatio: 3 },
      { eco: true },
      { minMs: 2.5 },
      { maxMs: 6 },
    ];
    const keys = variants.map((v) => previewImageKey({ ...PARTS, ...v }));
    for (const key of keys) expect(key).not.toBe(base);
    expect(new Set(keys).size).toBe(keys.length);
    expect(previewImageKey({ ...PARTS })).toBe(base);
  });

  it('nom de fichier : stable, court, sans caractère réservé, distinct d’une image à l’autre', () => {
    const key = previewImageKey(PARTS);
    const name = previewImageName('T|a.gpx', key);
    expect(previewImageName('T|a.gpx', key)).toBe(name);
    expect(name).toMatch(/^[0-9a-z]{1,11}$/);
    const names = new Set<string>();
    for (let w = 50; w < 550; w++) names.add(previewImageName('T|a.gpx', previewImageKey({ ...PARTS, width: w })));
    for (let i = 0; i < 500; i++) names.add(previewImageName(`T|s${i}.gpx`, key));
    expect(names.size).toBe(1000);
  });
});

describe('index lu sur l’appareil', () => {
  const entry = { image: 'k', name: 'abc123', bytes: 4000, usedAt: 1 };

  it('relit un index bien formé', () => {
    const parsed = parsePreviewImageIndex({ version: PREVIEW_IMAGE_INDEX_VERSION, entries: { 'T|a.gpx': entry } });
    expect([...parsed]).toEqual([['T|a.gpx', entry]]);
  });

  it('illisible ou d’une autre version : vide', () => {
    expect(parsePreviewImageIndex(null).size).toBe(0);
    expect(parsePreviewImageIndex('texte').size).toBe(0);
    expect(parsePreviewImageIndex({ version: PREVIEW_IMAGE_INDEX_VERSION + 1, entries: { a: entry } }).size).toBe(0);
    expect(parsePreviewImageIndex({ version: PREVIEW_IMAGE_INDEX_VERSION, entries: null }).size).toBe(0);
  });

  it('une entrée abîmée est oubliée seule', () => {
    const parsed = parsePreviewImageIndex({
      version: PREVIEW_IMAGE_INDEX_VERSION,
      entries: {
        bonne: entry,
        sansImage: { ...entry, image: 3 },
        nomDouteux: { ...entry, name: '../x' },
        poidsNegatif: { ...entry, bytes: -1 },
        sansDate: { ...entry, usedAt: 'hier' },
        rien: null,
      },
    });
    expect([...parsed.keys()]).toEqual(['bonne']);
  });
});

describe('image complète', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

  it('vraie si chaque tuile est là et lisible, sans tuile aussi', () => {
    expect(allTilesPresent([{ content: blob, image: {} }, { content: blob, image: {} }])).toBe(true);
    expect(allTilesPresent([])).toBe(true);
  });

  it('fausse pour une case vide, agrandie d’un zoom inférieur ou illisible', () => {
    expect(allTilesPresent([{ content: blob, image: {} }, { content: null, image: null }])).toBe(false);
    expect(allTilesPresent([{ content: 'data:image/png;base64,AAAA', image: {} }])).toBe(false);
    expect(allTilesPresent([{ content: blob, image: null }])).toBe(false);
  });
});
