import { describe, expect, it } from 'vitest';
import {
  editSpeedUnit, formatClockMinutes, formatDistance, formatMinSecHours, formatSessionDate, formatKnots, formatShortDistance, formatSpeed, fromDisplaySpeed, knotsToDisplay, kmhToMs, speedUnitLabel, toDisplayDistance, toDisplaySpeed,
} from './units';

describe('distances', () => {
  it('convertit les mètres en kilomètres et en milles nautiques', () => {
    expect(toDisplayDistance(29_720, 'km')).toBeCloseTo(29.72, 6);
    expect(toDisplayDistance(1852, 'nm')).toBeCloseTo(1, 6);
  });

  it('formate avec le symbole et le nombre de décimales demandé', () => {
    expect(formatDistance(29_720, 'km')).toBe('29.72 km');
    expect(formatDistance(3704, 'nm', 1)).toBe('2.0 NM');
    expect(formatDistance(NaN, 'km')).toBe('-');
  });

  it('donne une distance d\'approche en mètres sous 1 000 m', () => {
    expect(formatShortDistance(143.4, 'km')).toBe('143 m');
    expect(formatShortDistance(143.4, 'nm')).toBe('143 m');
    expect(formatShortDistance(3704, 'nm')).toBe('2.00 NM');
    expect(formatShortDistance(NaN, 'km')).toBe('-');
  });
});

describe('knotsToDisplay', () => {
  it('rend les nœuds inchangés et convertit vers km/h et m/s', () => {
    expect(knotsToDisplay(10, 'kn')).toBeCloseTo(10, 6);
    expect(knotsToDisplay(10, 'kmh')).toBeCloseTo(18.52, 2);
    expect(knotsToDisplay(10, 'ms')).toBeCloseTo(5.144, 3);
  });
});

describe('formatKnots', () => {
  it('garde le texte reçu en nœuds, pour un affichage inchangé', () => {
    expect(formatKnots('12.4', 'kn')).toBe('12.4');
    expect(formatKnots(12.44, 'kn')).toBe('12.4');
  });

  it('convertit un texte ou un nombre de nœuds dans l\'unité choisie', () => {
    expect(formatKnots('10.0', 'kmh')).toBe('18.5');
    expect(formatKnots(10, 'ms')).toBe('5.14');
  });

  it('rend tel quel ce qui n\'est pas un nombre', () => {
    expect(formatKnots('-', 'kmh')).toBe('-');
  });
});

describe('formatSessionDate', () => {
  it("donne le jour, la date et l'heure locale", () => {
    expect(formatSessionDate(new Date(2026, 9, 14, 10, 2, 41).getTime())).toBe('mer. 14/10/2026 · 10:02');
    expect(formatSessionDate(new Date(2026, 0, 4, 7, 5).getTime())).toBe('dim. 04/01/2026 · 07:05');
  });
});

describe('editSpeedUnit', () => {
  it('fait saisir une allure en km/h, les autres unités telles quelles', () => {
    expect(editSpeedUnit('minkm')).toBe('kmh');
    expect(editSpeedUnit('kn')).toBe('kn');
    expect(editSpeedUnit('ms')).toBe('ms');
  });

  it('rend la borne saisie à l’aller-retour : 11 km/h, soit 5:27 au km', () => {
    const unit = editSpeedUnit('minkm');
    const ms = fromDisplaySpeed(11, unit);
    expect(ms).toBeCloseTo(11 / 3.6);
    expect(toDisplaySpeed(ms, unit)).toBeCloseTo(11);
    expect(toDisplaySpeed(ms, 'minkm')).toBeCloseTo(60 / 11);
  });
});

describe('formatMinSecHours', () => {
  it('écrit m:ss sous l\'heure et h:mm:ss au-delà', () => {
    expect(formatMinSecHours(0)).toBe('0:00');
    expect(formatMinSecHours(65)).toBe('1:05');
    expect(formatMinSecHours(3600)).toBe('1:00:00');
    expect(formatMinSecHours(3723)).toBe('1:02:03');
  });

  it('accroche un suffixe aux secondes', () => {
    expect(formatMinSecHours(83, '.4')).toBe('1:23.4');
    expect(formatMinSecHours(3723, '.4')).toBe('1:02:03.4');
  });
});

describe('formatClockMinutes', () => {
  it('écrit h:mm sur la minute ronde, h:mm:ss sinon', () => {
    expect(formatClockMinutes(0)).toBe('0:00');
    expect(formatClockMinutes(75)).toBe('1:15');
    expect(formatClockMinutes(75.5)).toBe('1:15:30');
  });
});

describe('allure et unité de distance', () => {
  it('1 852 m en 10 min font « 10:00 /NM », 1 km en 5 min « 5:00 /km » sans paramètre', () => {
    expect(formatSpeed(1852 / 600, 'minkm', 'nm')).toBe('10:00 /NM');
    expect(formatSpeed(1000 / 300, 'minkm')).toBe('5:00 /km');
    expect(formatSpeed(1000 / 300, 'minkm', 'km')).toBe('5:00 /km');
  });
  it('la conversion aller-retour en milles nautiques rend la vitesse', () => {
    const v = kmhToMs(11);
    expect(fromDisplaySpeed(toDisplaySpeed(v, 'minkm', 'nm'), 'minkm', 'nm')).toBeCloseTo(v, 9);
  });
  it('le libellé suit la distance, les autres unités non', () => {
    expect(speedUnitLabel('minkm', 'nm')).toBe('min/NM');
    expect(speedUnitLabel('minkm')).toBe('min/km');
    expect(speedUnitLabel('kmh', 'nm')).toBe('km/h');
  });
});
