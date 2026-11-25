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
 * Preuve que le service de la ceinture sans position (muscu, FC de nuit, HeartRateService) a survécu à la page
 * (src/platform/recovery.ts) : après une chute du moteur de rendu, le processus continue et la page repart seule
 * (MainActivity). Seul un service à la fois démarré et au premier plan compte : Android ne le relance jamais seul,
 * donc le voir vivant veut dire que le processus l'est aussi. Le service de position, lui, dit son état par son
 * propre greffon (RecordingPlugin.state).
 */
@CapacitorPlugin(name = "Recovery")
public class RecoveryPlugin extends Plugin {

    private static final String TAG = "TrackerRecovery";

    /** `belt` : le service de la ceinture sans position (muscu, HeartRateService). */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void state(PluginCall call) {
        // La page parle : l'activité n'a plus à repartir de zéro.
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).pageAnswered();
        boolean belt = false;
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager != null) {
            try {
                // Déprécié pour les services des autres applications : les siens restent rendus.
                for (ActivityManager.RunningServiceInfo info : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (!info.foreground || !info.started) continue;
                    if (HeartRateService.class.getName().equals(info.service.getClassName())) belt = true;
                }
            } catch (RuntimeException e) {
                // Dans le doute, aucun : la page remet la session en attente.
                Log.w(TAG, "Liste des services illisible", e);
            }
        }
        JSObject ret = new JSObject();
        ret.put("belt", belt);
        call.resolve(ret);
    }
}
