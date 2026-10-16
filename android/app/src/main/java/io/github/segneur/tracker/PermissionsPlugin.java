package io.github.segneur.tracker;

import android.annotation.SuppressLint;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Autorisations qui ne passent pas par une demande système ordinaire
 * (src/platform/permissions.ts) : la batterie « sans restriction » et le
 * démarrage automatique. La position et les notifications sont demandées par
 * le greffon du GPS, le Bluetooth par celui de la ceinture.
 *
 * Batterie : l'écran système « Autoriser l'application à toujours
 * s'exécuter en arrière-plan ? » (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
 * Il demande REQUEST_IGNORE_BATTERY_OPTIMIZATIONS au manifeste, que le Play
 * Store encadre ; l'APK est diffusé par lien, hors boutique.
 *
 * Démarrage automatique : propre à MIUI et HyperOS, sans interface standard
 * ni état lisible. On ouvre leur écran s'il existe, sinon les réglages de
 * l'application.
 */
@CapacitorPlugin(name = "Permissions")
public class PermissionsPlugin extends Plugin {

    /** Vrai si l'application échappe à l'optimisation de la batterie (« Aucune restriction »). */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("unrestricted", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(ret);
    }

    /** Ouvre l'écran système qui lève l'optimisation de la batterie ; rend la main aussitôt, l'état se relit au retour. */
    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestUnrestrictedBattery(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri());
        if (!start(intent)) {
            // Écran absent sur certains appareils : la liste des applications et leur batterie.
            if (!start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) && !start(appSettings())) {
                call.reject("Réglages de la batterie introuvables");
                return;
            }
        }
        call.resolve();
    }

    /** Ouvre l'écran du démarrage automatique de MIUI / HyperOS, sinon les réglages de l'application. */
    @PluginMethod
    public void openAutostart(PluginCall call) {
        Intent miui = new Intent();
        miui.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        if (start(miui) || start(appSettings())) call.resolve();
        else call.reject("Réglages de l'application introuvables");
    }

    /** Ouvre les réglages de l'application : une autorisation refusée s'y rend. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        if (start(appSettings())) call.resolve();
        else call.reject("Réglages de l'application introuvables");
    }

    private Uri packageUri() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    private Intent appSettings() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri());
    }

    /** Lance l'écran ; faux s'il n'existe pas ou s'il est refusé. */
    private boolean start(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
