package io.github.segneur.tracker;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * Notification de l'enregistrement (src/platform/notification.ts,
 * src/hooks/recordingNotification.ts), lisible écran verrouillé.
 *
 * Elle appartient au service GPS du greffon @capgo/background-geolocation,
 * qui la pose au démarrage sans moyen de la changer ensuite. Ce greffon la
 * récrit sur le même numéro et le même canal : Android garde son lien avec le
 * service au premier plan. Hors pause manuelle, il ne la pose que si celle du
 * service est affichée, pour ne jamais laisser de notification orpheline
 * après l'arrêt du service. En pause manuelle (service arrêté), il la pose
 * seul ; la reprise rend la main au service, l'arrêt l'efface.
 *
 * Tant qu'elle est affichée, la notification du compteur du fractionné
 * (IntervalTimerService) se cache de l'écran verrouillé : celle-ci porte déjà
 * la phase et son décompte.
 */
@CapacitorPlugin(name = "RecordingNotification")
public class RecordingNotificationPlugin extends Plugin {

    /** Numéro et canal de la notification du service GPS (BackgroundGeolocationService, constantes non publiques). */
    static final int NOTIFICATION_ID = 28351;
    static final String CHANNEL_ID = "com.capgo.capacitor_background_geolocation";

    private static volatile boolean shown = false;

    /** Vrai tant que la notification de l'enregistrement, récrite ici, est affichée. */
    static boolean isShown() {
        return shown;
    }

    private static void setShown(boolean next) {
        if (shown == next) return;
        shown = next;
        IntervalTimerService.recordingNotificationChanged();
    }

    @PluginMethod
    public void show(PluginCall call) {
        Context context = getContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            call.resolve();
            return;
        }
        boolean standalone = Boolean.TRUE.equals(call.getBoolean("standalone", false));
        if (!standalone && !serviceNotificationActive(manager)) {
            // Service GPS arrêté, ou pas encore au premier plan : rien à récrire.
            setShown(false);
            call.resolve();
            return;
        }
        String title = call.getString("title", "Tracker");
        String text = call.getString("text", "");
        List<String> lines = new ArrayList<>();
        JSArray array = call.getArray("lines");
        if (array != null) {
            try {
                lines = array.toList();
            } catch (JSONException ignored) {
                // Lignes illisibles : le texte replié suffit.
            }
        }
        Double chronoMs = call.getDouble("chronoMs");
        boolean countDown = Boolean.TRUE.equals(call.getBoolean("countDown", false));

        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT);
        if (!lines.isEmpty()) builder.setStyle(new NotificationCompat.BigTextStyle().bigText(String.join("\n", lines)));
        if (chronoMs != null) {
            builder.setUsesChronometer(true)
                .setChronometerCountDown(countDown)
                .setShowWhen(true)
                .setWhen(chronoMs.longValue());
        } else {
            builder.setShowWhen(false);
        }
        manager.notify(NOTIFICATION_ID, builder.build());
        setShown(true);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        // Sans effet sur celle du service GPS tant qu'il tourne : Android ne laisse pas l'effacer.
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        setShown(false);
        call.resolve();
    }

    private static boolean serviceNotificationActive(NotificationManager manager) {
        for (StatusBarNotification notification : manager.getActiveNotifications()) {
            if (notification.getId() == NOTIFICATION_ID) return true;
        }
        return false;
    }
}
