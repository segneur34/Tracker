package io.github.segneur.tracker;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
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
 *
 * Thème du téléphone (« Auto » de Réglages › Affichage, hooks/useTheme.ts) :
 * l'activité déclare uiMode dans configChanges pour ne pas être recréée,
 * enregistrement en cours compris, quand le téléphone passe du clair au
 * sombre ; la WebView ne réévalue alors pas toujours prefers-color-scheme.
 * isDarkMode() lit UI_MODE_NIGHT_MASK, et l'événement darkModeChange
 * ({ dark }) prévient la page : depuis onConfigurationChanged de l'activité
 * (BridgeActivity le relaie aux greffons par handleOnConfigurationChanged),
 * et au retour de l'arrière-plan (handleOnResume) si la valeur a changé
 * entre-temps.
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

    /** Dernière valeur donnée à la page : un événement seulement quand elle change. */
    private Boolean lastDark = null;

    private static boolean isNight(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private boolean readDark() {
        Activity activity = getActivity();
        Context context = activity != null ? activity : getContext();
        return isNight(context.getResources().getConfiguration());
    }

    private void emitDark(boolean dark) {
        if (lastDark != null && lastDark == dark) return;
        lastDark = dark;
        JSObject data = new JSObject();
        data.put("dark", dark);
        notifyListeners("darkModeChange", data);
    }

    @PluginMethod
    public void isDarkMode(PluginCall call) {
        boolean dark = readDark();
        lastDark = dark;
        JSObject result = new JSObject();
        result.put("dark", dark);
        call.resolve(result);
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        emitDark(isNight(newConfig));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        emitDark(readDark());
    }
}
