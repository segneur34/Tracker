package io.github.segneur.tracker;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;

/**
 * Garde des écritures de l'ordinateur (ForegroundWork) : chacun des trois services de premier plan la tient, de sa
 * création à son arrêt, comme le câble les lit dans `dumpsys` (`SERVICES_APPLICATION` de bureau/telephone.ts).
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class ForegroundWorkTest {

    /** L'enregistrement simulé est toujours retiré : la garde est un état de tout le processus. */
    @After
    public void noRecordingLeft() throws Exception {
        setStatic("live", null);
    }

    private static void setStatic(String name, Object value) throws Exception {
        Field f = RecordingService.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(null, value);
    }

    private static void set(Object target, String name, Object value) throws Exception {
        Field f = RecordingService.class.getDeclaredField(name);
        f.setAccessible(true);
        f.set(target, value);
    }

    @Test
    public void libreQuandAucunServiceNeTourne() {
        assertFalse(ForegroundWork.busy());
    }

    @Test
    public void laSeanceALaCeintureSeuleTientLaGarde() {
        ServiceController<HeartRateService> service = Robolectric.buildService(HeartRateService.class).create();
        assertTrue(ForegroundWork.busy());
        service.destroy();
        assertFalse(ForegroundWork.busy());
    }

    @Test
    public void leCompteurDuFractionneTientLaGarde() {
        ServiceController<IntervalTimerService> service = Robolectric.buildService(IntervalTimerService.class).create();
        assertTrue(ForegroundWork.busy());
        service.destroy();
        assertFalse(ForegroundWork.busy());
    }

    /**
     * L'enregistrement, tel que `RecordingService.snapshot()` le lit : un service vivant, actif, avec ses réglages.
     * Posé directement : démarrer le vrai service demanderait le GPS.
     */
    @Test
    public void lEnregistrementTientLaGarde() throws Exception {
        RecordingService recording = Robolectric.buildService(RecordingService.class).get();
        set(recording, "settings", new RecordingService.Settings());
        set(recording, "active", true);
        setStatic("live", recording);
        assertTrue(ForegroundWork.busy());
        set(recording, "active", false);
        assertFalse(ForegroundWork.busy());
    }
}
