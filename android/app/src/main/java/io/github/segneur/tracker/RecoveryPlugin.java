package io.github.segneur.tracker;

import android.app.ActivityManager;
import android.content.Context;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Preuve qu'un service de l'enregistrement a survécu à la page (src/platform/recovery.ts) :
 * après une chute du moteur de rendu, le processus continue et la page repart seule
 * (MainActivity). Seul un service à la fois démarré et au premier plan compte : le service
 * GPS n'est jamais relancé par Android hors du mode de livraison native, qui n'est pas
 * utilisé ici, donc le voir vivant veut dire que le greffon qui l'a lancé l'est aussi, et
 * qu'il envoie encore ses positions à la page.
 */
@CapacitorPlugin(name = "Recovery")
public class RecoveryPlugin extends Plugin {

    private static final String TAG = "TrackerRecovery";
    /** Service du greffon @capgo/background-geolocation, nommé en toutes lettres : sa classe n'a pas à être publique. */
    private static final String GPS_SERVICE = "com.capgo.capacitor_background_geolocation.BackgroundGeolocationService";

    /** `gps`, `belt` : le service GPS, celui de la ceinture sans position (muscu, HeartRateService). */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void state(PluginCall call) {
        // La page parle : l'activité n'a plus à repartir de zéro, ce qui arrêterait le service GPS.
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).pageAnswered();
        boolean gps = false;
        boolean belt = false;
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager != null) {
            try {
                // Déprécié pour les services des autres applications : les siens restent rendus.
                for (ActivityManager.RunningServiceInfo info : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (!info.foreground || !info.started) continue;
                    String name = info.service.getClassName();
                    if (GPS_SERVICE.equals(name)) gps = true;
                    else if (HeartRateService.class.getName().equals(name)) belt = true;
                }
            } catch (RuntimeException e) {
                // Dans le doute, aucun : la page remet la session en attente.
                Log.w(TAG, "Liste des services illisible", e);
            }
        }
        JSObject ret = new JSObject();
        ret.put("gps", gps);
        ret.put("belt", belt);
        call.resolve(ret);
    }
}
