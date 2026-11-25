package io.github.segneur.tracker;

/**
 * Quand le service d'enregistrement doit retirer puis refaire son inscription au GPS.
 *
 * Une inscription faite localisation coupée reste inactive sur certains téléphones quand la localisation revient :
 * le système ne lui envoie ni position ni retour du fournisseur, alors que les autres inscriptions repartent. Le
 * service guette donc lui-même le retour de la localisation et refait son inscription à chaque passage de coupée à
 * allumée, sauf si une position est déjà arrivée entre-temps (l'inscription marche, la refaire ferait reprendre au
 * GPS sa recherche). « Réessayer » du GPS la refait aussi, localisation allumée, tant qu'aucune position n'est
 * arrivée depuis le départ : un GPS qui a déjà donné une position et s'est tu relève de la relance (GpsRestart).
 *
 * Machine pure, sans API d'Android : le service lui passe l'état de la localisation qu'il lit, chaque position reçue
 * et chaque appui sur « Réessayer », et refait l'inscription quand elle rend vrai (GpsResubscribeTest).
 */
final class GpsResubscribe {

    private boolean locationOn;
    private boolean fixSinceStart = false;

    /** `locationOn` : état de la localisation du téléphone au moment de la première inscription. */
    GpsResubscribe(boolean locationOn) {
        this.locationOn = locationOn;
    }

    /** Une position reçue, preuve que l'inscription marche et que la localisation est allumée. */
    void onFix() {
        fixSinceStart = true;
        locationOn = true;
    }

    /** La localisation du téléphone a changé d'état (`on` : allumée) : vrai s'il faut refaire l'inscription. */
    boolean onLocationMode(boolean on) {
        boolean back = on && !locationOn;
        locationOn = on;
        return back;
    }

    /** Appui sur « Réessayer » du GPS, localisation lue `on` : vrai s'il faut refaire l'inscription. */
    boolean onRetry(boolean on) {
        locationOn = on;
        return on && !fixSinceStart;
    }
}
