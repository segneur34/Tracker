package io.github.segneur.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * La garde contre un enregistrement jamais repris, application fermée, avec les valeurs de l'enregistrement :
 * arrêt après 1 h sans bouger (ni s'éloigner de 200 m, ni une vraie vitesse de 0,77 m/s tenue 5 s), ou 12 h après
 * la fermeture. Les positions sont posées le long d'un méridien : un degré de latitude y vaut 111,2 km.
 */
public class ClosedGuardTest {

    private static final double RADIUS_M = 200.0;
    private static final long STILL_MS = 3_600_000L;
    private static final long MAX_MS = 12 * 3_600_000L;
    /** La sortie d'un arrêt complet en voile, 1,5 nœud. */
    private static final double MOVING_MS = 0.77;
    private static final long HOLD_MS = 5_000L;
    private static final double LAT = 48.0;
    private static final double LON = -4.0;
    private static final double NONE = Double.NaN;

    private static ClosedGuard guard() {
        return new ClosedGuard(RADIUS_M, STILL_MS, MAX_MS, MOVING_MS, HOLD_MS);
    }

    /** Latitude à `meters` au nord du point de départ. */
    private static double north(double meters) {
        return LAT + meters / 111_195.0;
    }

    /** Garde fermée à l'instant 0, ancrée au point de départ. */
    private static ClosedGuard closedAtStart(ClosedGuard guard) {
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        return guard;
    }

    @Test
    public void distanceDuGrandCercle() {
        assertEquals(0.0, ClosedGuard.distanceM(LAT, LON, LAT, LON), 1e-9);
        assertEquals(250.0, ClosedGuard.distanceM(LAT, LON, north(250), LON), 0.5);
        // À 48° de latitude, un degré de longitude est plus court qu'un degré de latitude.
        assertEquals(111_195.0 * Math.cos(Math.toRadians(LAT)), ClosedGuard.distanceM(LAT, LON, LAT, LON + 1), 50.0);
    }

    @Test
    public void rienTantQueLaPageEstLa() {
        ClosedGuard guard = guard();
        for (long t = 0; t <= 2 * MAX_MS; t += 600_000L) {
            guard.onFix(t, LAT, LON, 5, 0.0);
            assertNull(guard.check(t));
        }
        assertFalse(guard.closed());
    }

    @Test
    public void arretApresUneHeureSurPlaceA1HzCommeA5Hz() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            ClosedGuard guard = guard();
            guard.onFix(0, LAT, LON, 5, NONE);
            guard.onClosed(10_000L);
            assertTrue(guard.closed());
            // Le téléphone bouge un peu, sans sortir du rayon.
            for (long t = 10_000L + stepMs; t < 10_000L + STILL_MS; t += stepMs) {
                guard.onFix(t, north((t / stepMs) % 2 == 0 ? 150 : -40), LON, 5, NONE);
            }
            assertNull(guard.check(10_000L + STILL_MS - 1));
            assertEquals(FixLog.STOP_STILL, guard.check(10_000L + STILL_MS));
        }
    }

    @Test
    public void telephoneSurUneTableAvecDuBruitSArreteAUneHeure() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            ClosedGuard guard = closedAtStart(guard());
            // Le bruit d'un GPS au repos : quelques mètres de flottement, une vitesse Doppler jusqu'à 0,4 m/s.
            long t = stepMs;
            for (; t < STILL_MS; t += stepMs) {
                double noise = ((t / stepMs) % 3) * 4.0;
                guard.onFix(t, north(noise), LON, 8, 0.4);
                assertNull(guard.check(t));
            }
            assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
        }
    }

    @Test
    public void surfeurAuMemePicNeSArreteJamaisSeulMaisA12Heures() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            ClosedGuard guard = closedAtStart(guard());
            // Attente au pic, puis une vague de 10 s à 3 m/s toutes les 10 min, toujours dans les 200 m.
            for (long t = stepMs; t < MAX_MS; t += stepMs) {
                boolean riding = t % 600_000L < 10_000L;
                double position = riding ? 3.0 * (t % 600_000L) / 1000.0 : 0.0;
                guard.onFix(t, north(position), LON, 5, riding ? 3.0 : 0.3);
                assertNull("Arrêté à " + t + " ms, au pas de " + stepMs, guard.check(t));
            }
            assertEquals(FixLog.STOP_TIMEOUT, guard.check(MAX_MS));
        }
    }

    @Test
    public void lesVaguesRelancentLHeureDepuisLaFinDeLaTenue() {
        ClosedGuard guard = closedAtStart(guard());
        // Une seule vague, à 3 m/s, de 20 min à 20 min 10 s, sur place, puis plus rien.
        long rideStart = 1_200_000L;
        long t = 1000L;
        long lastMoving = -1;
        for (; t <= rideStart + 10_000L; t += 1000L) {
            boolean riding = t >= rideStart;
            guard.onFix(t, LAT, LON, 5, riding ? 3.0 : 0.2);
            if (riding && t - rideStart >= HOLD_MS) lastMoving = t;
        }
        for (; t < lastMoving + STILL_MS; t += 1000L) guard.onFix(t, LAT, LON, 5, 0.2);
        assertNull(guard.check(lastMoving + STILL_MS - 1));
        assertEquals(FixLog.STOP_STILL, guard.check(lastMoving + STILL_MS));
    }

    @Test
    public void unePointeIsoleeNeRelanceRien() {
        for (long stepMs : new long[] { 1000L, 200L }) {
            ClosedGuard guard = closedAtStart(guard());
            for (long t = stepMs; t < STILL_MS; t += stepMs) {
                // Toutes les 5 min, un saut du GPS de 4 s au-dessus du seuil : jamais tenu 5 s.
                boolean spike = t % 300_000L < 4_000L;
                guard.onFix(t, LAT, LON, 5, spike ? 6.0 : 0.1);
            }
            assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
        }
    }

    @Test
    public void unePositionSeuleAuDessusDuSeuilNeSuffitPas() {
        ClosedGuard guard = closedAtStart(guard());
        guard.onFix(1_800_000L, LAT, LON, 5, 8.0);
        assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
    }

    @Test
    public void positionsEspaceesDe30SecondesComptent() {
        ClosedGuard guard = closedAtStart(guard());
        // Une application économique : une position toutes les 30 s, deux de suite à 2 m/s, sur place.
        guard.onFix(1_800_000L, LAT, LON, 5, 2.0);
        guard.onFix(1_830_000L, LAT, LON, 5, 2.0);
        assertNull(guard.check(STILL_MS));
        assertNull(guard.check(1_830_000L + STILL_MS - 1));
        assertEquals(FixLog.STOP_STILL, guard.check(1_830_000L + STILL_MS));
    }

    @Test
    public void uneVitesseAbsenteOuBasseInterromptLaTenue() {
        ClosedGuard noSpeed = closedAtStart(guard());
        noSpeed.onFix(1_800_000L, LAT, LON, 5, 2.0);
        noSpeed.onFix(1_803_000L, LAT, LON, 5, NONE);
        noSpeed.onFix(1_806_000L, LAT, LON, 5, 2.0);
        assertEquals("Une position sans vitesse ne prouve aucun mouvement.", FixLog.STOP_STILL, noSpeed.check(STILL_MS));
        ClosedGuard slow = closedAtStart(guard());
        slow.onFix(1_800_000L, LAT, LON, 5, 2.0);
        slow.onFix(1_803_000L, LAT, LON, 5, 0.5);
        slow.onFix(1_806_000L, LAT, LON, 5, 2.0);
        assertEquals(FixLog.STOP_STILL, slow.check(STILL_MS));
        // Pile au seuil : la vitesse compte.
        ClosedGuard atThreshold = closedAtStart(guard());
        atThreshold.onFix(1_800_000L, LAT, LON, 5, MOVING_MS);
        atThreshold.onFix(1_800_000L + HOLD_MS, LAT, LON, 5, MOVING_MS);
        assertNull(atThreshold.check(STILL_MS));
    }

    @Test
    public void sansVitesseDonneeCommeAvant() {
        // Un téléphone qui ne donne jamais de vitesse : seule la distance juge.
        ClosedGuard guard = closedAtStart(guard());
        for (long t = 1000L; t < STILL_MS; t += 1000L) guard.onFix(t, north((t / 1000L) % 2 == 0 ? 150 : 0), LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
    }

    @Test
    public void seuilNulEteintLeCritereDeVitesse() {
        for (double off : new double[] { 0.0, -1.0, Double.NaN }) {
            ClosedGuard guard = closedAtStart(new ClosedGuard(RADIUS_M, STILL_MS, MAX_MS, off, HOLD_MS));
            for (long t = 1000L; t < STILL_MS; t += 1000L) guard.onFix(t, LAT, LON, 5, 5.0);
            assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
        }
    }

    @Test
    public void tenueNulleUneSeulePositionSuffit() {
        ClosedGuard guard = closedAtStart(new ClosedGuard(RADIUS_M, STILL_MS, MAX_MS, MOVING_MS, 0));
        guard.onFix(1_800_000L, LAT, LON, 5, 2.0);
        assertNull(guard.check(STILL_MS));
        assertEquals(FixLog.STOP_STILL, guard.check(1_800_000L + STILL_MS));
    }

    @Test
    public void vitesseIncertaineNeProuveRien() {
        // Incertitude au-delà du rayon : la vitesse de la position ne compte pas, et la tenue est interrompue.
        ClosedGuard blurred = closedAtStart(guard());
        for (long t = 1_800_000L; t <= 1_820_000L; t += 1000L) blurred.onFix(t, LAT, LON, 500, 3.0);
        assertEquals(FixLog.STOP_STILL, blurred.check(STILL_MS));
        ClosedGuard broken = closedAtStart(guard());
        broken.onFix(1_800_000L, LAT, LON, 5, 3.0);
        broken.onFix(1_803_000L, LAT, LON, 500, 3.0);
        broken.onFix(1_806_000L, LAT, LON, 5, 3.0);
        assertEquals(FixLog.STOP_STILL, broken.check(STILL_MS));
        // Sans incertitude donnée, la position compte.
        ClosedGuard unknown = closedAtStart(guard());
        unknown.onFix(1_800_000L, LAT, LON, NONE, 3.0);
        unknown.onFix(1_805_000L, LAT, LON, NONE, 3.0);
        assertNull(unknown.check(STILL_MS));
    }

    @Test
    public void laTenueRepartAChaqueFermeture() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        guard.onFix(1000L, LAT, LON, 5, 3.0);
        guard.onOpened();
        // Refermée : la position rapide d'avant ne commence pas une tenue.
        guard.onClosed(2000L);
        guard.onFix(5000L, LAT, LON, 5, 3.0);
        assertEquals(FixLog.STOP_STILL, guard.check(2000L + STILL_MS));
    }

    @Test
    public void sEloignerRelanceLeCompteDepuisLeNouveauPoint() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        // Une navigation : 5 m/s vers le nord pendant deux heures, jamais une heure dans le même rayon.
        long t = 0;
        for (; t <= 2 * STILL_MS; t += 1000L) {
            guard.onFix(t, north(5.0 * t / 1000.0), LON, 5, NONE);
            assertNull(guard.check(t));
        }
        // Puis le téléphone reste posé : arrêt une heure après le dernier départ d'un rayon.
        double restLat = north(5.0 * (t - 1000L) / 1000.0);
        long rest = t;
        for (; t < rest + STILL_MS; t += 1000L) guard.onFix(t, restLat, LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, guard.check(t));
    }

    @Test
    public void juste200MetresNeSuffitPas() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        guard.onFix(1000L, north(199), LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
        ClosedGuard gone = guard();
        gone.onFix(0, LAT, LON, 5, NONE);
        gone.onClosed(0);
        gone.onFix(1000L, north(205), LON, 5, NONE);
        assertNull(gone.check(STILL_MS));
        assertEquals(FixLog.STOP_STILL, gone.check(1000L + STILL_MS));
    }

    @Test
    public void positionTropIncertaineNeProuveAucunDepart() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        // Un saut de 1 km donné à 500 m près, téléphone à l'abri : l'ancrage ne bouge pas.
        guard.onFix(1_800_000L, north(1000), LON, 500, NONE);
        assertEquals(FixLog.STOP_STILL, guard.check(STILL_MS));
        // Sans incertitude donnée, la position compte.
        ClosedGuard unknown = guard();
        unknown.onFix(0, LAT, LON, 5, NONE);
        unknown.onClosed(0);
        unknown.onFix(1_800_000L, north(1000), LON, NONE, NONE);
        assertNull(unknown.check(STILL_MS));
    }

    @Test
    public void unePositionIncertaineNeFixePasLAncrage() {
        // Fermée sans position : la première reçue est donnée à 500 m près, 1 km au nord du téléphone, qui ne bouge pas.
        // Elle n'ancre rien : les positions précises suivantes, sur place, ne passent pas pour un départ.
        ClosedGuard first = guard();
        first.onClosed(0);
        first.onFix(1000L, north(1000), LON, 500, NONE);
        for (long t = 2000L; t < STILL_MS; t += 60_000L) first.onFix(t, LAT, LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, first.check(STILL_MS));
        // Même chose pour la dernière position connue à la fermeture : seule une position précise sert d'ancrage.
        ClosedGuard last = guard();
        last.onFix(0, LAT, LON, 5, NONE);
        last.onFix(1000L, north(1000), LON, 500, NONE);
        last.onClosed(2000L);
        for (long t = 3000L; t < 2000L + STILL_MS; t += 60_000L) last.onFix(t, LAT, LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, last.check(2000L + STILL_MS));
        // Un vrai départ depuis la première position précise relance bien le compte.
        ClosedGuard moving = guard();
        moving.onClosed(0);
        moving.onFix(1000L, north(1000), LON, 500, NONE);
        moving.onFix(2000L, LAT, LON, 5, NONE);
        moving.onFix(1_800_000L, north(400), LON, 5, NONE);
        assertNull(moving.check(STILL_MS));
        assertEquals(FixLog.STOP_STILL, moving.check(1_800_000L + STILL_MS));
    }

    @Test
    public void sansAucunePositionLeCompteCourtDepuisLaFermeture() {
        ClosedGuard guard = guard();
        guard.onClosed(5000L);
        assertNull(guard.check(5000L + STILL_MS - 1));
        assertEquals(FixLog.STOP_STILL, guard.check(5000L + STILL_MS));
        // Une première position tardive fixe l'ancrage sans relancer le compte.
        ClosedGuard late = guard();
        late.onClosed(5000L);
        late.onFix(1_800_000L, LAT, LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, late.check(5000L + STILL_MS));
    }

    @Test
    public void dureeMaximaleApresLaFermetureMemeEnNaviguant() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        // Un départ toutes les demi-heures : jamais « sur place », mais douze heures sans rouvrir.
        for (long t = 0; t < MAX_MS; t += 1_800_000L) {
            guard.onFix(t, north(300.0 * (t / 1_800_000L)), LON, 5, NONE);
            assertNull(guard.check(t + 1_799_999L));
        }
        assertEquals(FixLog.STOP_TIMEOUT, guard.check(MAX_MS));
    }

    @Test
    public void retourDeLaPageRemetToutAZero() {
        ClosedGuard guard = guard();
        guard.onFix(0, LAT, LON, 5, NONE);
        guard.onClosed(0);
        guard.onClosed(1_000_000L);
        assertEquals("Fermée deux fois : le premier compte tient.", FixLog.STOP_STILL, guard.check(STILL_MS));
        guard.onOpened();
        assertFalse(guard.closed());
        assertNull(guard.check(10 * MAX_MS));
        // Refermée plus tard : les deux comptes repartent de cette fermeture, ancrés à la dernière position connue.
        long closedAgain = 20 * MAX_MS;
        guard.onClosed(closedAgain);
        assertNull(guard.check(closedAgain + STILL_MS - 1));
        guard.onFix(closedAgain + 1000L, north(150), LON, 5, NONE);
        assertEquals(FixLog.STOP_STILL, guard.check(closedAgain + STILL_MS));
    }

    @Test
    public void valeurNulleEteintSaRegle() {
        ClosedGuard noStill = new ClosedGuard(0, 0, MAX_MS, MOVING_MS, HOLD_MS);
        noStill.onFix(0, LAT, LON, 5, NONE);
        noStill.onClosed(0);
        assertNull(noStill.check(MAX_MS - 1));
        assertEquals(FixLog.STOP_TIMEOUT, noStill.check(MAX_MS));
        ClosedGuard noMax = new ClosedGuard(RADIUS_M, STILL_MS, 0, MOVING_MS, HOLD_MS);
        noMax.onClosed(0);
        for (long t = 0; t <= 3 * MAX_MS; t += 1_800_000L) noMax.onFix(t, north(300.0 * (t / 1_800_000L)), LON, 5, NONE);
        assertNull(noMax.check(3 * MAX_MS));
        ClosedGuard none = new ClosedGuard(0, 0, 0, 0, 0);
        none.onClosed(0);
        assertNull(none.check(100 * MAX_MS));
    }
}
