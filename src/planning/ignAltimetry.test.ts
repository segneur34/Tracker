import { describe, expect, it } from 'vitest';
import { IGN_RESOURCE, ignErrorMessage, ignRequestBody, parseIgnElevations } from './ignAltimetry';

describe("altimétrie de l'IGN", () => {
  it('joint longitudes et latitudes par des barres', () => {
    const body = ignRequestBody([
      { lat: 43.6108, lon: 3.8767 },
      { lat: 43.611, lon: 3.877 },
    ]);
    expect(body).toEqual({ lon: '3.876700|3.877000', lat: '43.610800|43.611000', resource: IGN_RESOURCE, zonly: 'true' });
  });

  it('lit les altitudes, -99999 hors couverture', () => {
    // Réponse relevée le 07/10/2026 : deux points de Montpellier, un en mer.
    expect(parseIgnElevations({ elevations: [47.54, 46.87, -99999.0] }, 3)).toEqual([47.54, 46.87, null]);
  });

  it('refuse une réponse mal formée ou incomplète', () => {
    expect(() => parseIgnElevations({ elevations: [47.54] }, 2)).toThrow();
    expect(() => parseIgnElevations({ elevations: [47.54, 'x'] }, 2)).toThrow();
    expect(() => parseIgnElevations([47.54], 1)).toThrow();
    expect(() => parseIgnElevations(null, 0)).toThrow();
  });

  it("donne un message clair sur une erreur du serveur", () => {
    expect(ignErrorMessage(429)).toMatch(/occupé/);
    expect(ignErrorMessage(500)).toMatch(/500/);
  });
});
