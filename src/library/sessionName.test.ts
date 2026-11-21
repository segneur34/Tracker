import { describe, expect, it } from 'vitest';
import { applyRecordPatch } from './record';
import { computedSessionName, placeLabel, readRenameDraft, sessionDisplayName, sessionFileLabel } from './sessionName';
import { PLACE_VERSION, type SessionPlace } from './sessionPlace';
import { shareLabels } from './shareStats';
import { sessionRecord } from '../test/record.fixture';

const AT = '2026-11-21T10:00:00.000Z';

const place = (name: string | null, over: Partial<SessionPlace> = {}): SessionPlace => ({
  name, kind: 'eau', search: 'eau', source: 'osm', version: PLACE_VERSION, fetchedAt: '2026-11-20T08:00:00.000Z', ...over,
});

describe('nom calculé d\'une session (lot 215)', () => {
  it('« Activité · Lieu », l\'activité seule sans lieu, le nom saisi avant tout', () => {
    expect(sessionDisplayName({ name: null, place: place('Carnon-Plage') }, 'Wing')).toBe('Wing · Carnon-Plage');
    expect(sessionDisplayName({ name: null, place: place('Montpellier', { kind: 'commune', search: 'commune', to: 'Sète' }) }, 'Course'))
      .toBe('Course · Montpellier → Sète');
    expect(sessionDisplayName({ name: null, place: place(null) }, 'Wing')).toBe('Wing');
    expect(sessionDisplayName({ name: null }, 'Wing')).toBe('Wing');
    expect(sessionDisplayName({ name: 'Sortie du soir', place: place('Carnon-Plage') }, 'Wing')).toBe('Sortie du soir');
    expect(sessionDisplayName({ name: null, place: place('Carnon-Plage') }, null)).toBe('Carnon-Plage');
    expect(sessionDisplayName({ name: null }, null)).toBeNull();
    // Changer l'activité change le nom.
    expect(computedSessionName(place('Carnon-Plage'), 'Kite')).toBe('Kite · Carnon-Plage');
    expect(placeLabel(undefined)).toBeNull();
  });

  it('fichiers : nom saisi, sinon le lieu, sinon rien', () => {
    expect(sessionFileLabel({ name: 'Sortie', place: place('Carnon-Plage') })).toBe('Sortie');
    expect(sessionFileLabel({ name: null, place: place('Carnon-Plage') })).toBe('Carnon-Plage');
    expect(sessionFileLabel({ name: null, place: place(null) })).toBeNull();
  });

  it('image de partage sans nom saisi : titre « Activité · Lieu », la date seule dessous', () => {
    const startMs = Date.UTC(2026, 10, 15, 10, 0, 0);
    const labels = shareLabels(null, 'Wing', 'Voile', startMs, 'f.gpx', place('Carnon-Plage'));
    expect(labels.title).toBe('Wing · Carnon-Plage');
    expect(labels.subtitle).not.toContain('Wing');
    expect(labels.baseName).toBe('2026-11-15 Wing - Carnon-Plage');
    // Nommée : comme avant.
    expect(shareLabels('Sortie', 'Wing', 'Voile', startMs, 'f.gpx', place('Carnon-Plage'))).toMatchObject({ title: 'Sortie', baseName: '2026-11-15 Wing - Sortie' });
    // Sans lieu : l'activité.
    expect(shareLabels(null, 'Wing', 'Voile', startMs, 'f.gpx').title).toBe('Wing');
  });
});

describe('« Renommer » : nom libre ou lieu corrigé (lot 215)', () => {
  const record = { name: null, place: place('Carnon-Plage'), sport: 'wingfoil' as const };

  it('champ vidé : plus de nom saisi ; texte inchangé : rien', () => {
    expect(readRenameDraft('  ', { ...record, name: 'Sortie' }, 'Wing', AT)).toEqual({ name: null });
    expect(readRenameDraft('Wing · Carnon-Plage', record, 'Wing', AT)).toEqual({});
    expect(readRenameDraft(' Sortie ', { ...record, name: 'Sortie' }, 'Wing', AT)).toEqual({});
  });

  it('« Activité · X » : X devient le lieu, corrigé par l\'utilisateur, le nom reste calculé', () => {
    expect(readRenameDraft('Wing · Le Grand Travers', record, 'Wing', AT)).toEqual({
      name: null, place: { name: 'Le Grand Travers', kind: 'eau', search: 'eau', source: 'user', version: PLACE_VERSION, fetchedAt: AT },
    });
    // Sans espace après le point, et sur une session déjà nommée : le nom saisi part.
    expect(readRenameDraft('Wing ·Le Grand Travers', { ...record, name: 'Sortie' }, 'Wing', AT)).toMatchObject({ name: null, place: { name: 'Le Grand Travers' } });
    // À pied, avec l'arrivée.
    expect(readRenameDraft('Course · Lattes → Palavas', { name: null, sport: 'running' }, 'Course', AT)).toEqual({
      name: null, place: { name: 'Lattes', to: 'Palavas', kind: 'commune', search: 'commune', source: 'user', version: PLACE_VERSION, fetchedAt: AT },
    });
    // Le lieu tel quel sur une session nommée : le nom saisi part, le lieu reste.
    expect(readRenameDraft('Wing · Carnon-Plage', { ...record, name: 'Sortie' }, 'Wing', AT)).toEqual({ name: null });
  });

  it('tout autre texte est un nom libre', () => {
    expect(readRenameDraft('Sortie du soir', record, 'Wing', AT)).toEqual({ name: 'Sortie du soir' });
    expect(readRenameDraft('Kite · Carnon', record, 'Wing', AT)).toEqual({ name: 'Kite · Carnon' });
    expect(readRenameDraft('Wing ·', record, 'Wing', AT)).toEqual({ name: 'Wing ·' });
    // Sans positions (muscu) : pas de lieu, le texte est un nom.
    expect(readRenameDraft('Muscu · Salle', { name: null, sport: 'muscu' }, 'Muscu', AT)).toEqual({ name: 'Muscu · Salle' });
  });

  it('le changement demandé s\'applique à la fiche sans refaire le résumé', () => {
    const before = sessionRecord({ place: place('Carnon-Plage') });
    const patch = readRenameDraft('Wingfoil · Le Grand Travers', before, 'Wingfoil', AT);
    const { record: after, resummarize } = applyRecordPatch(before, patch);
    expect(resummarize).toBe(false);
    expect(after.place?.name).toBe('Le Grand Travers');
    expect(after.name).toBeNull();
    expect(sessionDisplayName(after, 'Wingfoil')).toBe('Wingfoil · Le Grand Travers');
  });
});
