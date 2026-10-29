import { describe, expect, it } from 'vitest';
import { getHoveredIndex } from '../hooks/useChartHover';
import { clearTrackHover, hoveredRow, hoveredTrackIndex, inChartView, trackHover } from './chartHover';

const rows = [{ index: 10, v: 1 }, { index: 25, v: 2 }, { index: 40, v: 3 }];

describe('hoveredRow', () => {
  it('rend la ligne survolée, indice en nombre ou en chaîne', () => {
    expect(hoveredRow({ isTooltipActive: true, activeTooltipIndex: 1 }, rows)).toBe(rows[1]);
    expect(hoveredRow({ isTooltipActive: true, activeTooltipIndex: '2' }, rows)).toBe(rows[2]);
  });

  it('rien sans infobulle active, ni hors des lignes', () => {
    expect(hoveredRow({ isTooltipActive: false, activeTooltipIndex: 1 }, rows)).toBeNull();
    expect(hoveredRow({ isTooltipActive: true, activeTooltipIndex: null }, rows)).toBeNull();
    expect(hoveredRow({ isTooltipActive: true, activeTooltipIndex: 5 }, rows)).toBeNull();
    expect(hoveredRow({ isTooltipActive: true, activeTooltipIndex: '1.5' }, rows)).toBeNull();
    expect(hoveredRow(null, rows)).toBeNull();
  });
});

describe('hoveredTrackIndex', () => {
  it("rend l'indice de trace de la ligne survolée", () => {
    expect(hoveredTrackIndex({ isTooltipActive: true, activeTooltipIndex: 1 }, rows)).toBe(25);
    expect(hoveredTrackIndex({ isTooltipActive: true, activeTooltipIndex: 9 }, rows)).toBeNull();
  });
});

describe('inChartView', () => {
  it('tout est visible sans zoom ; sinon, bornes comprises', () => {
    expect(inChartView(null, 123)).toBe(true);
    expect(inChartView({ min: 1, max: 2 }, 1)).toBe(true);
    expect(inChartView({ min: 1, max: 2 }, 2.5)).toBe(false);
  });
});

describe('trackHover', () => {
  it("transmet l'indice de trace de la ligne survolée, et rien hors des lignes", () => {
    const seen: number[] = [];
    const hover = trackHover(rows, (i) => seen.push(i));
    hover({ isTooltipActive: true, activeTooltipIndex: 1 });
    hover({ isTooltipActive: true, activeTooltipIndex: 9 });
    hover({ isTooltipActive: false, activeTooltipIndex: 0 });
    hover({ isTooltipActive: true, activeTooltipIndex: '2' });
    expect(seen).toEqual([25, 40]);
  });

  it('par défaut, écrit dans le magasin du survol ; clearTrackHover l\'efface', () => {
    trackHover(rows)({ isTooltipActive: true, activeTooltipIndex: 0 });
    expect(getHoveredIndex()).toBe(10);
    clearTrackHover();
    expect(getHoveredIndex()).toBeNull();
  });
});
