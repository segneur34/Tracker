package io.github.segneur.tracker;

/**
 * Garde contre un enregistrement jamais repris, application fermée : le service s'arrête seul quand le téléphone
 * n'a pas bougé pendant `stillDelayMs`, ou `maxClosedMs` après la fermeture. Elle ne compte que tant que la page
 * est absente ; son retour remet tout à zéro. Rayon, vitesse et durées viennent de la page, au départ
 * (`RecordingProfile` de src/core/sportProfiles.ts) ; une valeur nulle ou négative éteint sa règle.
 *
 * « Ne pas bouger » se juge depuis un point d'ancrage : la dernière position connue à la fermeture, puis chaque
 * position qui s'en écarte de plus du rayon, qui devient l'ancrage et relance le compte. Une vraie vitesse relance
 * aussi le compte, sans sortir du rayon : un surfeur qui prend des vagues au même pic, un bateau qui tire des bords
 * serrés. Elle se lit dans la vitesse Doppler des positions, au moins `movingSpeedMs`, tenue sans interruption
 * pendant `movingHoldMs` : une pointe isolée du GPS ne relance rien, et une position sans vitesse ne prouve aucun
 * mouvement. La tenue se mesure en temps entre positions, jamais en nombre de positions : deux positions espacées
 * de 30 s au-dessus du seuil suffisent. Une position dont l'incertitude dépasse le rayon ne prouve ni départ ni
 * vitesse : elle ne déplace pas l'ancrage et interrompt la tenue. Sans aucune position (téléphone à l'abri, GPS
 * muet), rien ne prouve un mouvement non plus : le compte court depuis la fermeture.
 *
 * Machine pure, sans API d'Android, sur l'horloge monotone du téléphone (ClosedGuardTest).
 */
final class ClosedGuard {

    private static final long NONE = -1L;
    private static final double EARTH_RADIUS_M = 6_371_000.0;

    private final double radiusM;
    private final long stillDelayMs;
    private final long maxClosedMs;
    private final double movingSpeedMs;
    private final long movingHoldMs;

    private boolean hasLast = false;
    private double lastLat;
    private double lastLon;
    private long closedSinceMs = NONE;
    private boolean hasAnchor = false;
    private double anchorLat;
    private double anchorLon;
    private long anchorSinceMs = NONE;
    /** Heure de la première position d'une suite ininterrompue au-dessus de `movingSpeedMs`, `NONE` hors d'une telle suite. */
    private long movingSinceMs = NONE;

    /**
     * `movingSpeedMs` : vitesse, en m/s, à partir de laquelle une position compte comme un mouvement ; nulle,
     * négative ou NaN, seule la distance juge. `movingHoldMs` : durée pendant laquelle cette vitesse doit tenir ;
     * nulle ou négative, une seule position suffit.
     */
    ClosedGuard(double radiusM, long stillDelayMs, long maxClosedMs, double movingSpeedMs, long movingHoldMs) {
        this.radiusM = radiusM;
        this.stillDelayMs = stillDelayMs;
        this.maxClosedMs = maxClosedMs;
        this.movingSpeedMs = movingSpeedMs;
        this.movingHoldMs = movingHoldMs;
    }

    /** Vrai tant que la page est absente. */
    boolean closed() {
        return closedSinceMs != NONE;
    }

    /** La page s'en va à `nowMs` : les deux comptes partent, ancrés à la dernière position connue. Sans effet si elle l'était déjà. */
    void onClosed(long nowMs) {
        if (closed()) return;
        closedSinceMs = nowMs;
        anchorSinceMs = nowMs;
        hasAnchor = hasLast;
        anchorLat = lastLat;
        anchorLon = lastLon;
        movingSinceMs = NONE;
    }

    /** La page revient : plus de garde. */
    void onOpened() {
        closedSinceMs = NONE;
        anchorSinceMs = NONE;
        hasAnchor = false;
        movingSinceMs = NONE;
    }

    /**
     * Une position reçue à `nowMs` ; `accuracyM` : son incertitude, `speedMs` : sa vitesse Doppler en m/s, chacune
     * `Double.NaN` si le téléphone ne la donne pas.
     */
    void onFix(long nowMs, double lat, double lon, double accuracyM, double speedMs) {
        hasLast = true;
        lastLat = lat;
        lastLon = lon;
        if (!closed()) return;
        boolean proves = Double.isNaN(accuracyM) || accuracyM <= radiusM;
        if (!hasAnchor) {
            // Première position depuis la fermeture : elle fixe l'ancrage, le compte court déjà.
            hasAnchor = true;
            anchorLat = lat;
            anchorLon = lon;
        } else if (proves && distanceM(anchorLat, anchorLon, lat, lon) > radiusM) {
            reanchor(nowMs, lat, lon);
        }
        if (!proves || !movesFast(speedMs)) {
            movingSinceMs = NONE;
            return;
        }
        if (movingSinceMs == NONE) movingSinceMs = nowMs;
        if (nowMs - movingSinceMs >= movingHoldMs) reanchor(nowMs, lat, lon);
    }

    /** Raison d'arrêter à `nowMs` : FixLog.STOP_STILL, FixLog.STOP_TIMEOUT, ou `null` s'il faut continuer. */
    String check(long nowMs) {
        if (!closed()) return null;
        if (radiusM > 0 && stillDelayMs > 0 && nowMs - anchorSinceMs >= stillDelayMs) return FixLog.STOP_STILL;
        if (maxClosedMs > 0 && nowMs - closedSinceMs >= maxClosedMs) return FixLog.STOP_TIMEOUT;
        return null;
    }

    /** Vrai si cette vitesse prouve un mouvement ; toujours faux quand le critère de vitesse est éteint. */
    private boolean movesFast(double speedMs) {
        return movingSpeedMs > 0 && !Double.isNaN(speedMs) && speedMs >= movingSpeedMs;
    }

    /** Le téléphone a bougé : l'ancrage passe sur cette position et le compte « sans bouger » repart de `nowMs`. */
    private void reanchor(long nowMs, double lat, double lon) {
        anchorLat = lat;
        anchorLon = lon;
        anchorSinceMs = nowMs;
    }

    /** Distance du grand cercle entre deux points, en mètres. */
    static double distanceM(double lat1, double lon1, double lat2, double lon2) {
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double dPhi = phi2 - phi1;
        double dLambda = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
        return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }
}
