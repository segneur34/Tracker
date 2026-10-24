package io.github.segneur.tracker;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Écran (src/platform/screen.ts).
 *
 * Écran allumé : FLAG_KEEP_SCREEN_ON sur la fenêtre de l'application. Il
 * n'empêche que la mise en veille automatique : le bouton du téléphone
 * verrouille toujours, et le drapeau ne vaut que tant que l'application est
 * au premier plan.
 *
 * Orientation figée (cadenas d'Enregistrer) : SCREEN_ORIENTATION_LOCKED garde
 * l'orientation du moment ; UNSPECIFIED rend la main à la rotation du
 * téléphone. Une application relancée repart toujours libre.
 */
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {

    @PluginMethod
    public void keepOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void lockOrientation(PluginCall call) {
        boolean locked = Boolean.TRUE.equals(call.getBoolean("locked", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(locked
                ? ActivityInfo.SCREEN_ORIENTATION_LOCKED
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            call.resolve();
        });
    }
}
