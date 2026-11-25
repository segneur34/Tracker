package io.github.segneur.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * La relance de l'écoute du GPS : seulement sur un GPS qui s'est tu après avoir donné une position, jamais pendant
 * la recherche de la première ni localisation coupée. Le minuteur du service est joué ici à la main : `onFix` dit
 * pour quel délai l'armer, `onExpired` ce qui se passe à son échéance.
 */
public class GpsRestartTest {

    private static final long DELAY_MS = 60_000L;

    private static GpsRestart restart() {
        return new GpsRestart(DELAY_MS);
    }

    @Test
    public void rienAvantLaPremierePositionDepuisLeDepart() {
        GpsRestart restart = restart();
        assertFalse(restart.armed());
        for (long t = 0; t <= 10 * DELAY_MS; t += DELAY_MS) {
            assertFalse("Le GPS cherche sa première position : le relancer la retarderait.", restart.onExpired(t));
        }
    }

    @Test
    public void chaquePositionRepousseLeMinuteurA1HzCommeA5Hz() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            GpsRestart restart = restart();
            long last = 0;
            for (long t = 0; t <= 300_000L; t += stepMs) {
                assertEquals(DELAY_MS, restart.onFix(t));
                last = t;
            }
            assertTrue(restart.armed());
            // Une échéance repoussée par les positions suivantes est ignorée.
            assertFalse(restart.onExpired(last + DELAY_MS - 1));
            assertTrue(restart.onExpired(last + DELAY_MS));
        }
    }

    @Test
    public void unGpsTuApresAvoirMarcheEstRelanceUneFoisPuisPlusAvantUnePosition() {
        GpsRestart restart = restart();
        restart.onFix(0);
        assertTrue(restart.onExpired(DELAY_MS));
        assertFalse(restart.armed());
        // Après la relance, le GPS cherche de nouveau : rien avant sa première position.
        assertFalse(restart.onExpired(2 * DELAY_MS));
        assertFalse(restart.onExpired(10 * DELAY_MS));
        assertEquals(DELAY_MS, restart.onFix(10 * DELAY_MS + 5_000L));
        assertTrue(restart.onExpired(11 * DELAY_MS + 5_000L));
    }

    @Test
    public void uneCadenceDe40SNeRelanceJamais() {
        GpsRestart restart = restart();
        for (long t = 0; t <= 3_600_000L; t += 40_000L) {
            // L'échéance d'avant, si elle tombait avant cette position, ne tombe jamais : 40 s < 60 s.
            assertFalse(restart.onExpired(t));
            restart.onFix(t);
        }
    }

    @Test
    public void uneCadencePlusLenteQueLeDelaiNeRelanceQuUneFoisParPosition() {
        GpsRestart restart = restart();
        int restarts = 0;
        for (long t = 0; t <= 900_000L; t += 90_000L) {
            restart.onFix(t);
            for (long tick = t + 1_000L; tick < t + 90_000L; tick += 1_000L) {
                if (restart.onExpired(tick)) restarts++;
            }
        }
        assertEquals(11, restarts);
    }

    @Test
    public void localisationCoupeeRienNestArmeNiAvantNiApresSonRetour() {
        GpsRestart restart = restart();
        restart.onFix(0);
        restart.onLocationDisabled();
        assertFalse(restart.armed());
        assertFalse("Localisation coupée : rien ne viendra d'une relance.", restart.onExpired(DELAY_MS));
        assertFalse(restart.onExpired(10 * DELAY_MS));
        restart.onLocationEnabled();
        // Rendue : le GPS cherche sa première position, jamais relancé avant elle.
        assertFalse(restart.onExpired(11 * DELAY_MS));
        assertFalse(restart.onExpired(20 * DELAY_MS));
        restart.onFix(20 * DELAY_MS);
        assertTrue(restart.onExpired(21 * DELAY_MS));
    }

    @Test
    public void localisationCoupeeAuDepartPuisRendue() {
        GpsRestart restart = restart();
        restart.onLocationDisabled();
        assertFalse(restart.onExpired(DELAY_MS));
        restart.onLocationEnabled();
        assertFalse(restart.onExpired(5 * DELAY_MS));
        assertEquals(DELAY_MS, restart.onFix(5 * DELAY_MS));
    }

    @Test
    public void uneEcheancePosteeAvantLaCoupureNeRelancePas() {
        GpsRestart restart = restart();
        restart.onFix(0);
        restart.onLocationDisabled();
        restart.onLocationEnabled();
        assertFalse(restart.onExpired(DELAY_MS));
    }

    @Test
    public void delaiSelonLaCadenceDemandee() {
        assertEquals(DELAY_MS, GpsRestart.delayFor(DELAY_MS, 1_000L, 0f));
        assertEquals(DELAY_MS, GpsRestart.delayFor(DELAY_MS, 200L, 0f));
        // Cadence lente : quelques intervalles sans position avant de dire le GPS tu.
        assertEquals(GpsRestart.INTERVALS_BEFORE_RESTART * 40_000L, GpsRestart.delayFor(DELAY_MS, 40_000L, 0f));
        // Une écoute qui attend un déplacement se tait à l'arrêt sans être perdue : jamais relancée.
        assertEquals(0L, GpsRestart.delayFor(DELAY_MS, 1_000L, 5f));
        assertEquals(0L, GpsRestart.delayFor(0L, 1_000L, 0f));
    }

    @Test
    public void sansDelaiJamaisDeRelance() {
        GpsRestart restart = new GpsRestart(0L);
        assertTrue(restart.onFix(0) < 0);
        assertFalse(restart.armed());
        assertFalse(restart.onExpired(10 * DELAY_MS));
    }
}
