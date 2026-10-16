package io.github.segneur.tracker;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
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
 */
@CapacitorPlugin(name = "Gnss")
public class GnssPlugin extends Plugin {

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
