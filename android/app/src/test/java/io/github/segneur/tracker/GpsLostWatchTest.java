package io.github.segneur.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * La veille « GPS perdu » du service, page absente : les règles de src/recording/gpsWatch.ts, avec les délais de
 * l'enregistrement (1 min sans position, réarmement après 2 min de retour). Le minuteur du service est joué ici à
 * la main : `armMs` dit quand il doit sonner, `onExpired` ce qui se passe alors.
 */
public class GpsLostWatchTest {

    private static final long DELAY_MS = 60_000L;
    private static final long REARM_MS = 120_000L;

    private static GpsLostWatch watch() {
        return new GpsLostWatch(DELAY_MS, REARM_MS);
    }

    /** Des positions de `fromMs` à `toMs` compris, tous les `stepMs` ; rend la dernière étape. */
    private static GpsLostWatch.Step fixes(GpsLostWatch watch, long fromMs, long toMs, long stepMs) {
        GpsLostWatch.Step last = null;
        for (long t = fromMs; t <= toMs; t += stepMs) last = watch.onFix(t);
        return last;
    }

    @Test
    public void rienAvantLaPremierePosition() {
        GpsLostWatch watch = watch();
        assertEquals(GpsLostWatch.WAITING, watch.phase());
        GpsLostWatch.Step step = watch.onExpired(10 * DELAY_MS);
        assertFalse("Un GPS qui ne trouve jamais sa position n'est pas perdu.", step.lost);
        assertTrue(step.armMs < 0);
    }

    @Test
    public void chaquePositionRepousseLeMinuteurA1HzCommeA5Hz() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            GpsLostWatch watch = watch();
            for (long t = 0; t <= 300_000L; t += stepMs) {
                GpsLostWatch.Step step = watch.onFix(t);
                assertEquals(DELAY_MS, step.armMs);
                assertFalse(step.lost);
            }
            // Une échéance périmée, repoussée par les positions suivantes, est ignorée.
            assertFalse(watch.onExpired(300_000L + DELAY_MS - 1).lost);
            assertEquals(GpsLostWatch.WATCHING, watch.phase());
        }
    }

    @Test
    public void perduApresLeDelaiUneSeuleFoisParPerte() {
        GpsLostWatch watch = watch();
        fixes(watch, 0, 30_000L, 1000L);
        GpsLostWatch.Step lost = watch.onExpired(30_000L + DELAY_MS);
        assertTrue(lost.lost);
        assertTrue(watch.lost());
        // Sans rappel : plus rien n'est armé, et une échéance de plus ne redit rien.
        assertTrue(lost.armMs < 0);
        assertFalse(watch.onExpired(30_000L + 5 * DELAY_MS).lost);
    }

    @Test
    public void retourEffaceLAlerteSansRearmerAvantDeuxMinutes() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            GpsLostWatch watch = watch();
            watch.onFix(0);
            watch.onExpired(DELAY_MS);
            long back = 200_000L;
            GpsLostWatch.Step returned = watch.onFix(back);
            assertTrue(returned.cleared);
            assertTrue("Rien d'armé pendant le retour.", returned.armMs < 0);
            assertEquals(GpsLostWatch.REARMING, watch.phase());
            GpsLostWatch.Step before = fixes(watch, back + stepMs, back + REARM_MS - stepMs, stepMs);
            assertTrue(before.armMs < 0);
            // Le GPS se tait de nouveau avant le réarmement : aucune seconde alerte.
            assertFalse(watch.onExpired(back + REARM_MS + 10 * DELAY_MS).lost);
            assertEquals(GpsLostWatch.REARMING, watch.phase());
        }
    }

    @Test
    public void nouvellePerteSignaleeApresDeuxMinutesDeRetour() {
        GpsLostWatch watch = watch();
        watch.onFix(0);
        watch.onExpired(DELAY_MS);
        long back = 200_000L;
        GpsLostWatch.Step rearmed = fixes(watch, back, back + REARM_MS, 1000L);
        assertEquals(DELAY_MS, rearmed.armMs);
        assertEquals(GpsLostWatch.WATCHING, watch.phase());
        assertTrue(watch.onExpired(back + REARM_MS + DELAY_MS).lost);
    }

    @Test
    public void trouPendantLeRetourLeFaitRecommencer() {
        GpsLostWatch watch = watch();
        watch.onFix(0);
        watch.onExpired(DELAY_MS);
        long back = 200_000L;
        fixes(watch, back, back + 90_000L, 1000L);
        // Un trou aussi long qu'une perte : le retour repart de la position qui le suit.
        long again = back + 90_000L + DELAY_MS;
        GpsLostWatch.Step early = fixes(watch, again, again + REARM_MS - 1000L, 1000L);
        assertTrue(early.armMs < 0);
        assertEquals(DELAY_MS, watch.onFix(again + REARM_MS).armMs);
    }

    @Test
    public void rienEnPauseManuelle() {
        GpsLostWatch watch = watch();
        fixes(watch, 0, 10_000L, 1000L);
        GpsLostWatch.Step paused = watch.onPause();
        assertTrue(paused.disarm);
        assertFalse(paused.cleared);
        // Ni les positions ni une échéance restée en route ne comptent pendant la pause.
        assertTrue(watch.onFix(11_000L).armMs < 0);
        assertFalse(watch.onExpired(10_000L + DELAY_MS).lost);
        assertFalse(watch.onPause().disarm);
        // À la reprise, le minuteur repart de la reprise.
        GpsLostWatch.Step resumed = watch.onResume(500_000L);
        assertEquals(DELAY_MS, resumed.armMs);
        assertFalse(watch.onExpired(500_000L + DELAY_MS - 1).lost);
        assertTrue(watch.onExpired(500_000L + DELAY_MS).lost);
        assertTrue(watch.onResume(600_000L).armMs < 0);
    }

    @Test
    public void pausePendantUnePerteEffaceLAlerteSansNouvelleAlerteAvantLeRearmement() {
        GpsLostWatch watch = watch();
        watch.onFix(0);
        watch.onExpired(DELAY_MS);
        GpsLostWatch.Step paused = watch.onPause();
        assertTrue(paused.cleared);
        assertTrue(paused.disarm);
        GpsLostWatch.Step resumed = watch.onResume(300_000L);
        assertTrue("Le retour se compte aux positions qui suivent.", resumed.armMs < 0);
        assertFalse(watch.onExpired(300_000L + 10 * DELAY_MS).lost);
        GpsLostWatch.Step rearmed = fixes(watch, 400_000L, 400_000L + REARM_MS, 1000L);
        assertEquals(DELAY_MS, rearmed.armMs);
    }

    @Test
    public void pauseAvantLaPremierePositionNArmeRienALaReprise() {
        GpsLostWatch watch = watch();
        watch.onPause();
        assertTrue(watch.onResume(5000L).armMs < 0);
        assertEquals(GpsLostWatch.WAITING, watch.phase());
        assertEquals(DELAY_MS, watch.onFix(6000L).armMs);
    }
}
