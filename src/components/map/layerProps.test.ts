import { describe, expect, it } from 'vitest';
import { definedOptions, eventNamesKey, markerChanges, pathLayerOptions, type MarkerState } from './layerProps';

describe('definedOptions', () => {
  it('retire les clés non renseignées, garde false, 0 et null', () => {
    expect(definedOptions({ icon: undefined, interactive: false, zIndexOffset: 0, pane: null, color: 'red' }))
      .toEqual({ interactive: false, zIndexOffset: 0, pane: null, color: 'red' });
    expect(Object.keys(definedOptions({ a: undefined }))).toEqual([]);
  });
});

describe('pathLayerOptions', () => {
  it('ajoute le calque et le rayon donnés, sans clé vide', () => {
    expect(pathLayerOptions({ color: '#fff', weight: 3, interactive: false }, 'traceSuivie', 8))
      .toEqual({ color: '#fff', weight: 3, interactive: false, pane: 'traceSuivie', radius: 8 });
    const plain = pathLayerOptions({ color: '#fff' }, undefined);
    expect(plain).toEqual({ color: '#fff' });
    expect('pane' in plain).toBe(false);
    expect('radius' in plain).toBe(false);
  });

  it('accepte un style absent, et laisse au défaut de Leaflet un pointillé vidé', () => {
    expect(pathLayerOptions(undefined, undefined, 9)).toEqual({ radius: 9 });
    expect('dashArray' in pathLayerOptions({ color: 'red', dashArray: undefined }, undefined)).toBe(false);
  });

  it('ne touche pas au style reçu', () => {
    const style = { color: 'red' };
    pathLayerOptions(style, 'p', 3);
    expect(style).toEqual({ color: 'red' });
  });
});

describe('markerChanges', () => {
  const icon = { name: 'a' };
  const position: [number, number] = [43.5, 3.9];
  const base: MarkerState<typeof icon> = { position, icon, zIndexOffset: 0, draggable: true };

  it('rien quand tout est le même objet', () => {
    expect(markerChanges(base, { ...base })).toEqual([]);
  });

  it('compare à la référence : une position recopiée compte pour un changement', () => {
    expect(markerChanges(base, { ...base, position: [43.5, 3.9] })).toEqual(['position']);
  });

  it('relève chaque changement, dans un ordre fixe', () => {
    expect(markerChanges(base, { position, icon: { name: 'b' }, zIndexOffset: 1000, draggable: false }))
      .toEqual(['icon', 'zIndexOffset', 'draggable']);
    expect(markerChanges(base, { ...base, icon: undefined })).toEqual(['icon']);
  });
});

describe('eventNamesKey', () => {
  const noop = () => {};

  it('trie les noms et ignore un gestionnaire absent', () => {
    expect(eventNamesKey({ zoomstart: noop, click: noop, dragstart: undefined, moveend: noop })).toBe('click moveend zoomstart');
    expect(eventNamesKey({})).toBe('');
  });

  it('la même clé pour de nouveaux gestionnaires des mêmes événements', () => {
    expect(eventNamesKey({ click: () => 1 })).toBe(eventNamesKey({ click: () => 2 }));
  });
});
