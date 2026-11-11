import { describe, expect, it } from 'vitest';
import { GPX_DOWNLOADED_NOTE, gpxShareNote, sessionGpxFileName } from './sessionGpxShare';

describe('sessionGpxFileName (lot 207)', () => {
  const startMs = new Date(2026, 9, 10, 14, 30).getTime();

  it('nomme une session nommée par sa date, son activité et son nom, comme « Télécharger la session »', () => {
    expect(sessionGpxFileName('Carnon', 'Wingfoil', startMs, '2026-10-10-1430-wingfoil.gpx')).toBe('2026-10-10 Wingfoil - Carnon.gpx');
    // Caractères refusés par Android ou Windows remplacés.
    expect(sessionGpxFileName('Aller/retour', null, startMs, 'x.gpx')).toBe('2026-10-10 Aller retour.gpx');
  });

  it('garde son nom de fichier à une session sans nom', () => {
    expect(sessionGpxFileName(null, 'Wingfoil', startMs, '2026-10-10-1430-wingfoil.gpx')).toBe('2026-10-10-1430-wingfoil.gpx');
    expect(sessionGpxFileName('   ', 'Wingfoil', startMs, '2026-10-10-1430-wingfoil.gpx')).toBe('2026-10-10-1430-wingfoil.gpx');
  });
});

describe('gpxShareNote (lot 207)', () => {
  it('ne dit rien d’un partage parti ou abandonné, prévient d’un repli en téléchargement', () => {
    expect(gpxShareNote('shared')).toBeNull();
    expect(gpxShareNote('cancelled')).toBeNull();
    expect(gpxShareNote('downloaded')).toBe(GPX_DOWNLOADED_NOTE);
  });
});
