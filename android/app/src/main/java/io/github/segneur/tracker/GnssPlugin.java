package io.github.segneur.tracker;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Satellites du GPS (src/platform/location.ts) : combien sont en vue, et
 * combien servent au calcul de la position. Le greffon de géolocalisation
 * ne les transmet pas ; on lit l'état du GNSS à part, sans rien demander de
 * plus au GPS, que l'enregistrement fait déjà tourner. Sans lui, l'état ne
 * vient pas : la page affiche « — ».
 *
 * Un événement « satellites » ({ used, visible }) à chaque état reçu, une
 * fois par seconde environ ; rien sans l'autorisation de position précise.
 *
 * « Réessayer » du GPS à l'enregistrement (refreshAssistance, lot 232) : le
 * téléphone recharge ses données d'aide (heure, puis orbites des
 * satellites), qui hâtent une position. Le service GPS, la trace et la
 * notification ne sont pas touchés, et ces données ne sont jamais effacées
 * (delete_aiding_data ferait repartir le GPS de zéro). Permission normale
 * ACCESS_LOCATION_EXTRA_COMMANDS au manifeste, sans demande.
 */
@CapacitorPlugin(name = "Gnss")
public class GnssPlugin extends Plugin {

    /** Étiquette du journal (`adb logcat -s TrackerGps`). */
    private static final String TAG = "TrackerGps";

    private GnssStatus.Callback callback;

    @PluginMethod
    public void start(PluginCall call) {
        if (callback == null) {
            LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (manager == null
                || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                call.resolve();
                return;
            }
            GnssStatus.Callback next = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    int visible = status.getSatelliteCount();
                    int used = 0;
                    for (int i = 0; i < visible; i++) {
                        if (status.usedInFix(i)) used++;
                    }
                    JSObject data = new JSObject();
                    data.put("used", used);
                    data.put("visible", visible);
                    notifyListeners("satellites", data);
                }
            };
            try {
                if (manager.registerGnssStatusCallback(next, new Handler(Looper.getMainLooper()))) callback = next;
            } catch (SecurityException ignored) {
                // Autorisation retirée entre-temps : pas de satellites, l'enregistrement continue.
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        unregister();
        call.resolve();
    }

    /**
     * Demande au téléphone de recharger ses données d'aide au GPS : l'heure
     * (force_time_injection), puis les orbites prédites des satellites
     * (force_psds_injection depuis Android 11, force_xtra_injection avant).
     * Rend { sent }, vrai si au moins une demande est partie ; jamais d'échec.
     */
    @PluginMethod
    public void refreshAssistance(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean sent = false;
        if (manager != null) {
            boolean time = extraCommand(manager, "force_time_injection");
            String orbits = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? "force_psds_injection" : "force_xtra_injection";
            boolean psds = extraCommand(manager, orbits);
            sent = time || psds;
            Log.i(TAG, "données d'aide demandées : heure " + time + ", " + orbits + " " + psds);
        } else {
            Log.w(TAG, "données d'aide : service de localisation absent");
        }
        JSObject ret = new JSObject();
        ret.put("sent", sent);
        call.resolve(ret);
    }

    /** Envoie une commande au fournisseur GPS ; faux si elle est refusée (permission absente, fournisseur inconnu). */
    private boolean extraCommand(LocationManager manager, String command) {
        try {
            return manager.sendExtraCommand(LocationManager.GPS_PROVIDER, command, null);
        } catch (SecurityException | IllegalArgumentException e) {
            Log.w(TAG, command + " refusée : " + e.getMessage());
            return false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregister();
        super.handleOnDestroy();
    }

    private void unregister() {
        if (callback == null) return;
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager != null) manager.unregisterGnssStatusCallback(callback);
        callback = null;
    }
}
