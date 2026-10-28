package io.github.segneur.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Muscu (src/hooks/useRecorder.ts, lot I du 25/10) : une session sans GPS,
 * faite de la ceinture cardio seule. Sans le service GPS, rien ne tient
 * l'application au premier plan écran éteint ; ce service le fait, le temps
 * de la session, pour que la pile Bluetooth continue de livrer les mesures
 * (HeartRatePlugin) et la page de les garder.
 *
 * Type « appareil connecté » : la ceinture. Un verrou partiel garde le
 * processeur éveillé. Sa notification porte le numéro et le canal de celle
 * de l'enregistrement (RecordingNotificationPlugin) : le greffon la récrit
 * ensuite avec les chiffres du direct, comme celle du service GPS, et
 * Android garde son lien avec le service. Le canal est celui que le greffon
 * de géolocalisation crée au lancement ; s'il manque, il est créé ici.
 */
public class HeartRateService extends Service {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";

    /** Verrou tenu au plus ce temps, renouvelé à chaque démarrage : une séance ne dure pas plus. */
    private static final long WAKE_TIMEOUT_MS = 6 * 60 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        ensureChannel();
        // Au premier plan dans les 5 s qui suivent startForegroundService, quoi qu'il arrive.
        Notification notification = notification(title != null ? title : "Tracker enregistre", text != null ? text : "");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(RecordingNotificationPlugin.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            } else {
                startForeground(RecordingNotificationPlugin.NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            // Android 14 et plus : refusé sans la permission Bluetooth (le greffon la vérifie avant). Pas de service, pas de plantage.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent == null) {
            // Relancé par le système sans demande : la page n'est plus là pour garder les mesures.
            stopSelf();
            return START_NOT_STICKY;
        }
        holdWakeLock();
        return START_NOT_STICKY;
    }

    /** Canal de la notification de l'enregistrement, s'il n'existe pas encore (son nom n'est pas changé s'il existe). */
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(RecordingNotificationPlugin.CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            RecordingNotificationPlugin.CHANNEL_ID, "Enregistrement", NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private Notification notification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, RecordingNotificationPlugin.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setShowWhen(false)
            .build();
    }

    private void holdWakeLock() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tracker:muscu");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(WAKE_TIMEOUT_MS);
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
