package io.github.segneur.tracker;

/**
 * Veille « GPS perdu » du service d'enregistrement, quand la page n'est plus là pour la tenir : la même machine
 * que src/recording/gpsWatch.ts, règle pour règle. Le GPS est dit perdu après `delayMs` sans position, une seule
 * fois par perte, sans rappel ; une nouvelle perte n'est signalée qu'après son retour pendant `rearmMs` de
 * positions sans trou d'au moins `delayMs`. Rien en pause manuelle, rien avant la première position (un GPS qui
 * ne trouve jamais sa position n'est pas « perdu »).
 *
 * Machine pure, sans API d'Android, sur l'horloge monotone du téléphone : le service lui passe chaque position,
 * l'échéance de son minuteur, la pause et la reprise, et applique ce qu'elle rend (GpsLostWatchTest).
 */
final class GpsLostWatch {

    /** Avant la première position : rien n'est armé. */
    static final int WAITING = 0;
    /** Le minuteur est repoussé à chaque position. */
    static final int WATCHING = 1;
    /** Perte signalée, plus rien d'armé. */
    static final int LOST = 2;
    /** GPS revenu : rien d'armé ni de signalé jusqu'au réarmement. */
    static final int REARMING = 3;

    private static final long NONE = -1L;

    /** Ce que le service doit faire après un événement. */
    static final class Step {
        /** Armer (ou repousser) le minuteur pour ce délai, en millisecondes ; négatif : ne pas y toucher. */
        final long armMs;
        /** Désarmer le minuteur. */
        final boolean disarm;
        /** Le GPS vient d'être perdu : son et titre de la notification. */
        final boolean lost;
        /** L'alerte de perte est à effacer. */
        final boolean cleared;

        Step(long armMs, boolean disarm, boolean lost, boolean cleared) {
            this.armMs = armMs;
            this.disarm = disarm;
            this.lost = lost;
            this.cleared = cleared;
        }
    }

    private static final Step NOTHING = new Step(NONE, false, false, false);

    private final long delayMs;
    private final long rearmMs;
    private int phase = WAITING;
    private boolean paused = false;
    private long lastFixMs = NONE;
    private long returnedMs = NONE;
    private long deadlineMs = NONE;

    GpsLostWatch(long delayMs, long rearmMs) {
        this.delayMs = delayMs;
        this.rearmMs = rearmMs;
    }

    int phase() {
        return phase;
    }

    boolean lost() {
        return phase == LOST;
    }

    private Step armed(long nowMs) {
        phase = WATCHING;
        returnedMs = NONE;
        deadlineMs = nowMs + delayMs;
        return new Step(delayMs, false, false, false);
    }

    /** Une position reçue à `nowMs`. */
    Step onFix(long nowMs) {
        if (paused) return NOTHING;
        switch (phase) {
            case LOST:
                // Le GPS revient : l'alerte s'efface, le réarmement commence.
                phase = REARMING;
                lastFixMs = nowMs;
                returnedMs = nowMs;
                deadlineMs = NONE;
                return new Step(NONE, false, false, true);
            case REARMING: {
                // Un trou aussi long qu'une perte pendant le retour : le retour recommence à cette position.
                boolean gap = lastFixMs == NONE || nowMs - lastFixMs >= delayMs;
                if (gap || returnedMs == NONE) returnedMs = nowMs;
                lastFixMs = nowMs;
                return nowMs - returnedMs >= rearmMs ? armed(nowMs) : NOTHING;
            }
            default:
                lastFixMs = nowMs;
                return armed(nowMs);
        }
    }

    /** Le minuteur est échu à `nowMs`. Une échéance périmée (repoussée entre-temps, ou plus attendue) est ignorée. */
    Step onExpired(long nowMs) {
        if (paused || phase != WATCHING || deadlineMs == NONE || nowMs < deadlineMs) return NOTHING;
        phase = LOST;
        deadlineMs = NONE;
        return new Step(NONE, false, true, false);
    }

    /** Pause manuelle : plus de veille ; une alerte en cours s'efface, sans nouvelle alerte avant le réarmement. */
    Step onPause() {
        if (paused) return NOTHING;
        boolean wasLost = phase == LOST;
        paused = true;
        deadlineMs = NONE;
        if (wasLost) {
            phase = REARMING;
            returnedMs = NONE;
        }
        return new Step(NONE, true, false, wasLost);
    }

    /** Reprise après une pause manuelle, à `nowMs` : la veille reprend, minuteur armé depuis la reprise. */
    Step onResume(long nowMs) {
        if (!paused) return NOTHING;
        paused = false;
        // Rien avant la première position ; pendant un réarmement non plus : le retour se compte aux positions qui suivent.
        return phase == WATCHING ? armed(nowMs) : NOTHING;
    }
}
