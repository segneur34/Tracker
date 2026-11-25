package io.github.segneur.tracker;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * La réinscription au GPS : au retour de la localisation, et sur « Réessayer » tant qu'aucune position n'est arrivée
 * depuis le départ, localisation allumée.
 */
public class GpsResubscribeTest {

    @Test
    public void departLocalisationCoupeePuisRallumee() {
        GpsResubscribe resubscribe = new GpsResubscribe(false);
        assertFalse("Encore coupée : rien ne viendrait.", resubscribe.onLocationMode(false));
        assertTrue("Rallumée : l'inscription faite coupée est refaite.", resubscribe.onLocationMode(true));
        assertFalse("Un second avis du même retour ne la refait pas.", resubscribe.onLocationMode(true));
    }

    @Test
    public void coupureEnCoursDeRoute() {
        GpsResubscribe resubscribe = new GpsResubscribe(true);
        resubscribe.onFix();
        assertFalse(resubscribe.onLocationMode(false));
        assertTrue("Chaque retour de la localisation refait l'inscription.", resubscribe.onLocationMode(true));
        assertFalse(resubscribe.onLocationMode(false));
        assertTrue(resubscribe.onLocationMode(true));
    }

    @Test
    public void positionArriveeAvantLAvisDuRetour() {
        GpsResubscribe resubscribe = new GpsResubscribe(false);
        resubscribe.onFix();
        assertFalse("L'inscription marche déjà : la refaire ferait reprendre la recherche.", resubscribe.onLocationMode(true));
    }

    @Test
    public void reessayerSansPositionDepuisLeDepart() {
        GpsResubscribe resubscribe = new GpsResubscribe(false);
        assertFalse("Localisation coupée : rien ne viendrait.", resubscribe.onRetry(false));
        assertTrue(resubscribe.onRetry(true));
        assertTrue("Tant qu'aucune position n'est arrivée, chaque appui la refait.", resubscribe.onRetry(true));
    }

    @Test
    public void reessayerApresUnePositionLaisseLaRelance() {
        GpsResubscribe resubscribe = new GpsResubscribe(true);
        resubscribe.onFix();
        assertFalse("Un GPS tu après une position relève de la relance, pas de la réinscription.", resubscribe.onRetry(true));
    }

    @Test
    public void reessayerLitLEtatDeLaLocalisation() {
        GpsResubscribe resubscribe = new GpsResubscribe(true);
        assertFalse(resubscribe.onRetry(false));
        assertTrue("Coupée à l'appui, puis rallumée : le retour est vu.", resubscribe.onLocationMode(true));
    }
}
