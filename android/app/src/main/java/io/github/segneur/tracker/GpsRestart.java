package io.github.segneur.tracker;

/**
 * Relance de l'écoute du GPS par le service d'enregistrement, quand il s'est tu après avoir marché.
 *
 * Le service écoute le GPS brut : retirer son écoute arrête le moteur du GPS, qui reprend sa recherche de zéro.
 * Une relance ne sert donc qu'à un GPS qui a déjà donné une position puis s'est tu ; pendant la recherche de la
 * première position, elle la retarderait. D'où les règles : le minuteur ne s'arme qu'à une position reçue, et il est
 * repoussé à chacune ; rien avant la première position depuis le départ, depuis le retour de la localisation du
 * téléphone ou depuis une relance ; rien tant que la localisation est coupée.
 *
 * Cadence variable : une position plus espacée que le délai n'arme qu'une relance par position reçue, jamais une
 * boucle. Le délai tient compte de la cadence demandée (`delayFor`), et une écoute qui n'envoie qu'après un
 * déplacement n'est jamais relancée : immobile, elle se tait sans être perdue.
 *
 * Machine pure, sans API d'Android, sur l'horloge monotone du téléphone : le service lui passe chaque position,
 * l'échéance de son minuteur et l'état de la localisation, et applique ce qu'elle rend (GpsRestartTest).
 */
final class GpsRestart {

    /**
     * Nombre d'intervalles demandés sans position avant de relancer, quand la cadence demandée est lente : un GPS qui
     * n'a manqué qu'une position ou deux n'est pas tu.
     */
    static final long INTERVALS_BEFORE_RESTART = 3L;

    private static final long NONE = -1L;

    private final long delayMs;
    private boolean locationOff = false;
    private long deadlineMs = NONE;

    /** `delayMs` : délai sans position avant la relance ; nul ou négatif, jamais de relance. */
    GpsRestart(long delayMs) {
        this.delayMs = delayMs;
    }

    /**
     * Délai de la relance pour une écoute demandée toutes les `intervalMs` millisecondes, avec un déplacement minimal
     * de `distanceFilterM` mètres : au moins `minDelayMs`, et au moins quelques intervalles ; 0, jamais de relance,
     * pour une écoute qui attend un déplacement.
     */
    static long delayFor(long minDelayMs, long intervalMs, float distanceFilterM) {
        if (minDelayMs <= 0 || distanceFilterM > 0) return 0L;
        return Math.max(minDelayMs, INTERVALS_BEFORE_RESTART * Math.max(0L, intervalMs));
    }

    boolean armed() {
        return deadlineMs != NONE;
    }

    /**
     * Une position reçue à `nowMs`, preuve que la localisation est allumée : rend le délai pour lequel armer (ou
     * repousser) le minuteur ; négatif, rien à armer.
     */
    long onFix(long nowMs) {
        locationOff = false;
        if (delayMs <= 0) return NONE;
        deadlineMs = nowMs + delayMs;
        return delayMs;
    }

    /** Localisation du téléphone coupée : plus rien d'armé jusqu'à une position reçue après son retour. */
    void onLocationDisabled() {
        locationOff = true;
        deadlineMs = NONE;
    }

    /** Localisation rendue : le GPS cherche de nouveau sa première position, rien n'est armé. */
    void onLocationEnabled() {
        locationOff = false;
        deadlineMs = NONE;
    }

    /**
     * Le minuteur est échu à `nowMs` : vrai s'il faut relancer l'écoute. Le GPS cherche alors sa première position,
     * rien n'est réarmé avant elle. Une échéance périmée (repoussée entre-temps, ou plus attendue) est ignorée.
     */
    boolean onExpired(long nowMs) {
        if (locationOff || deadlineMs == NONE || nowMs < deadlineMs) return false;
        deadlineMs = NONE;
        return true;
    }
}
