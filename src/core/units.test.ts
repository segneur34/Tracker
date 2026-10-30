import { describe, expect, it } from 'vitest';
import {
  CHART_PACE_MIN_SPEED_MS, commaDecimal, formatDecimal, formatDuration, formatShortDuration, parseDecimal, INTERVAL_PACE_MIN_SPEED_MS, PACE_MIN_SPEED_MS, formatDistanceAuto, formatMeters, minutesSeconds, msToPace, pad2, signedPercent, speedSourceText,
  editSpeedUnit, formatClockMinutes, formatDistance, formatMinSecHours, formatSessionDate, formatKnots, formatShortDistance, formatSpeed, formatSpeedValue, fromDisplaySpeed, knotsToChartValue, knotsToDisplay, kmhToMs, speedUnitLabel, toDisplayDistance, toDisplaySpeed, SPEED_UNIT_LABEL, type SpeedUnit,
} from './units';

describe('distances', () => {
  it('convertit les mètres en kilomètres et en milles nautiques', () => {
    expect(toDisplayDistance(29_720, 'km')).toBeCloseTo(29.72, 6);
    expect(toDisplayDistance(1852, 'nm')).toBeCloseTo(1, 6);
  });

  it('formate avec le symbole et le nombre de décimales demandé', () => {
    expect(formatDistance(29_720, 'km')).toBe('29,72 km');
    expect(formatDistance(3704, 'nm', 1)).toBe('2,0 NM');
    expect(formatDistance(NaN, 'km')).toBe('-');
  });

  it('donne une distance d\'approche en mètres sous 1 000 m', () => {
    expect(formatShortDistance(143.4, 'km')).toBe('143 m');
    expect(formatShortDistance(143.4, 'nm')).toBe('143 m');
    expect(formatShortDistance(3704, 'nm')).toBe('2,00 NM');
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
    expect(formatKnots('12.4', 'kn')).toBe('12,4');
    expect(formatKnots(12.44, 'kn')).toBe('12,4');
  });

  it('convertit un texte ou un nombre de nœuds dans l\'unité choisie', () => {
    expect(formatKnots('10.0', 'kmh')).toBe('18,5');
    expect(formatKnots(10, 'ms')).toBe('5,14');
  });

  it('rend tel quel ce qui n\'est pas un nombre', () => {
    expect(formatKnots('-', 'kmh')).toBe('-');
  });
});

describe('knotsToChartValue', () => {
  it('rend exactement la lecture du texte de formatKnots, dans toutes les unités', () => {
    const values = [0, 0.04, 0.05, 0.15, 0.25, 1, 2.45, 3.75, 7.999999, 8, 12.44, 12.45, 18.272096, 24.95, 33.3333, 101.25, -1, NaN, Infinity, -Infinity];
    for (let kn = 0; kn < 40; kn += 0.0137) values.push(kn);
    for (const unit of ['kn', 'kmh', 'ms', 'minkm'] as SpeedUnit[]) {
      for (const kn of values) {
        expect(Object.is(knotsToChartValue(kn, unit), parseDecimal(formatKnots(kn, unit))), `${kn} ${unit}`).toBe(true);
      }
    }
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

// Copies gelées des écritures d'avant le lot 55 : les briques doivent rendre les mêmes textes.
const oldPaceText = (value: number): string => {
  const min = Math.floor(value);
  const sec = Math.round((value - min) * 60);
  return sec === 60 ? `${min + 1}:00` : `${min}:${sec.toString().padStart(2, '0')}`;
};
const oldCadenceChange = (from: number, to: number): string => {
  const pct = from > 0 ? ((to - from) / from) * 100 : 0;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)} %`;
};
const oldIntervalChange = (fraction: number, decimals = 1): string => {
  const value = Math.abs(fraction * 100).toFixed(decimals);
  if (Number(value) === 0) return `0 %`;
  return `${fraction < 0 ? '−' : '+'}${value} %`;
};
const oldFormatSpeed = (ms: number, unit: 'kn' | 'kmh' | 'ms'): string =>
  unit === 'kn' ? `${(ms * 1.94384).toFixed(1)} nds` : unit === 'kmh' ? `${(ms * 3.6).toFixed(1)} km/h` : `${ms.toFixed(2)} m/s`;

describe('minutesSeconds et pad2', () => {
  it('écrit les minutes décimales en m:ss avec le report de 60 s', () => {
    for (const v of [0, 0.5, 1, 4.999, 5.5, 5.9999, 5 + 59.5 / 60, 5 + 59.4 / 60, 12.25, 100.0001, -1.5]) {
      expect(minutesSeconds(v)).toBe(oldPaceText(v));
    }
    expect(minutesSeconds(5 + 59.5 / 60)).toBe('6:00');
    expect(minutesSeconds(5.5)).toBe('5:30');
  });

  it('complète à deux chiffres', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(7)).toBe('07');
    expect(pad2(12)).toBe('12');
    expect(pad2(123)).toBe('123');
  });

  it('formatPace et formatSpeed gardent leurs textes', () => {
    expect(formatSpeed(1000 / (5 * 60), 'minkm')).toBe('5:00 /km');
    expect(formatSpeed(1000 / (5 * 60 - 0.4), 'minkm')).toBe('5:00 /km');
    expect(formatSpeed(1852 / (6 * 60), 'minkm', 'nm')).toBe('6:00 /NM');
    expect(formatSpeed(0.05, 'minkm')).toBe('- /km');
    for (const ms of [0, 0.1, 2.5, 7.77, 15.123, -1]) {
      for (const unit of ['kn', 'kmh', 'ms'] as const) expect(formatSpeed(ms, unit)).toBe(oldFormatSpeed(ms, unit).replace('.', ','));
    }
    expect(formatSpeed(null, 'kn')).toBe('-');
    expect(formatSpeed(NaN, 'kmh')).toBe('-');
  });

  it("formatSpeedValue écrit une allure en m:ss comme avant", () => {
    for (const v of [4.5, 5.9999, 6, 0, 10.25]) expect(formatSpeedValue(v, 'minkm')).toBe(oldPaceText(v));
    expect(formatSpeedValue(NaN, 'minkm')).toBe('-');
  });
});

describe('signedPercent', () => {
  it("rend l'écriture de l'analyse des répétitions (zéro sans signe)", () => {
    for (const f of [0, 0.0004, -0.0004, 0.012, -0.03, 0.5, -1, 0.0049, 0.005]) {
      expect(signedPercent(f)).toBe(oldIntervalChange(f).replace('.', ','));
      expect(signedPercent(f, { decimals: 0 })).toBe(oldIntervalChange(f, 0).replace('.', ','));
    }
    expect(signedPercent(0)).toBe('0 %');
    expect(signedPercent(0.012)).toBe('+1,2 %');
    expect(signedPercent(-0.03)).toBe('−3,0 %');
  });

  it("rend l'écriture de la cadence (zéro signé)", () => {
    const change = (from: number, to: number) => signedPercent(from > 0 ? (to - from) / from : 0, { zeroSign: true });
    for (const [from, to] of [[170, 170], [170, 172], [170, 168], [0, 5], [-3, 4], [0.9, 0.8], [170, 170.0001], [170, 169.9999]]) {
      expect(change(from, to)).toBe(oldCadenceChange(from, to).replace('.', ','));
    }
    expect(change(170, 170)).toBe('+0,0 %');
    expect(change(0, 5)).toBe('+0,0 %');
  });
});

describe('formatDistanceAuto, formatMeters et seuils', () => {
  it('met deux décimales sous 10 unités, une au-delà', () => {
    const old = (m: number, unit: 'km' | 'nm') => formatDistance(m, unit, toDisplayDistance(m, unit) < 10 ? 2 : 1);
    for (const m of [0, 999, 9999, 10_000, 12_345, 9.99 * 1852, 10 * 1852, NaN, Infinity]) {
      for (const unit of ['km', 'nm'] as const) expect(formatDistanceAuto(m, unit)).toBe(old(m, unit));
    }
    expect(formatDistanceAuto(9_994, 'km')).toBe('9,99 km');
    expect(formatDistanceAuto(10_040, 'km')).toBe('10,0 km');
  });

  it('écrit des mètres entiers', () => {
    expect(formatMeters(null)).toBe('—');
    expect(formatMeters(0)).toBe('0 m');
    expect(formatMeters(120.5)).toBe('121 m');
    expect(formatMeters(-0.4)).toBe('0 m');
  });

  it("garde les trois seuils d'allure", () => {
    expect(PACE_MIN_SPEED_MS).toBe(0.1);
    expect(CHART_PACE_MIN_SPEED_MS).toBe(0.3);
    expect(INTERVAL_PACE_MIN_SPEED_MS).toBe(0.3);
    expect(msToPace(0.1)).toBeNull();
    expect(msToPace(0.11)).not.toBeNull();
  });
});

describe('speedSourceText', () => {
  /** Copie gelée de l'expression recopiée dans les onglets réglages de la course et du surf (lot 64). */
  const frozen = (has: boolean, unit: SpeedUnit | null | undefined) =>
    has ? `fournie par l'appareil${unit && unit !== 'ms' ? `, lue en ${SPEED_UNIT_LABEL[unit]} et convertie` : ''}` : 'dérivée des positions, filtrée';

  it('reprend l\'ancienne expression pour chaque cas', () => {
    for (const has of [true, false]) {
      for (const unit of [null, undefined, 'ms', 'kmh', 'kn', 'minkm'] as const) {
        expect(speedSourceText(has, unit)).toBe(frozen(has, unit));
      }
    }
  });
  it('dit l\'unité lue quand ce n\'est pas le m/s', () => {
    expect(speedSourceText(true, 'kmh')).toBe('fournie par l\'appareil, lue en km/h et convertie');
    expect(speedSourceText(true, 'ms')).toBe('fournie par l\'appareil');
    expect(speedSourceText(false, null)).toBe('dérivée des positions, filtrée');
  });
});

describe('formats d\'affichage uniques', () => {
  it('formatDecimal : virgule et décimales fixes, arrondi du toFixed', () => {
    expect(formatDecimal(12.4, 2)).toBe('12,40');
    expect(formatDecimal(12.44)).toBe('12,4');
    expect(formatDecimal(-0.06, 1)).toBe('-0,1');
    expect(formatDecimal(3, 0)).toBe('3');
  });
  it('commaDecimal et parseDecimal : texte arrondi mis à la virgule, et relu', () => {
    expect(commaDecimal('12.4')).toBe('12,4');
    expect(commaDecimal(0.5)).toBe('0,5');
    expect(commaDecimal('-')).toBe('-');
    expect(commaDecimal('5:30')).toBe('5:30');
    expect(parseDecimal('12,4')).toBe(12.4);
    expect(parseDecimal('12.4')).toBe(12.4);
  });
  it('durées espacées partout : « 1 h 24 », « 37 min »', () => {
    expect(formatDuration(84 * 60_000)).toBe('1 h 24');
    expect(formatDuration(60 * 60_000)).toBe('1 h 00');
    expect(formatDuration(37 * 60_000 + 59_000)).toBe('37 min');
    expect(formatShortDuration(3_900)).toBe('1 h 05');
    expect(formatShortDuration(65)).toBe('1 min 05');
  });
});
