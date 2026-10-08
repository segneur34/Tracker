package io.github.segneur.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Compteur du fractionné (src/recording/intervalTimer.ts, §10 point 89) :
 * joue le programme de la séance, sons et changements de phase, chacun à son
 * délai, écran éteint compris et sans enregistrement GPS.
 *
 * Service au premier plan : sans lui, une application en arrière-plan est
 * figée et ses minuteries s'arrêtent. Un verrou partiel garde le processeur
 * éveillé tant que des sons restent à jouer ; la notification dit la phase en
 * cours et décompte son temps. Chaque programme reçu remplace le précédent
 * (lancement, pause, reprise, « Passer ») ; le dernier son de la séance joué,
 * le service s'arrête de lui-même. Sons et vibrations : TonePlayer.
 */
public class IntervalTimerService extends Service {

    static final String ACTION_SCHEDULE = "io.github.segneur.tracker.INTERVALS_SCHEDULE";
    static final String EXTRA_TONE_DELAYS = "toneDelays";
    static final String EXTRA_TONE_KINDS = "toneKinds";
    static final String EXTRA_CUE_DELAYS = "cueDelays";
    static final String EXTRA_CUE_PHASE_MS = "cuePhaseMs";
    static final String EXTRA_CUE_TITLES = "cueTitles";
    static final String EXTRA_VIBRATE = "vibrate";
    /** Arrêt du service ce délai après le début du programme, en millisecondes ; 0 : aucun (pause). */
    static final String EXTRA_STOP_AFTER_MS = "stopAfterMs";

    /** Sons : bip court, bip long, long double de fin (`tone` d'un son du programme). */
    static final int TONE_SHORT = 0;
    static final int TONE_LONG = 1;
    static final int TONE_FINAL = 2;

    static int toneKind(String tone) {
        if ("long".equals(tone)) return TONE_LONG;
        if ("final".equals(tone)) return TONE_FINAL;
        return TONE_SHORT;
    }

    private static final String CHANNEL_ID = "fractionne";
    private static final int NOTIFICATION_ID = 4089;
    /** Marge du verrou au-delà du dernier son, en millisecondes. */
    private static final long WAKE_MARGIN_MS = 10_000;

    private HandlerThread thread;
    private Handler handler;
    private TonePlayer tones;
    private PowerManager.WakeLock wakeLock;
    private String title = "Fractionné";

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("TrackerIntervals");
        thread.start();
        handler = new Handler(thread.getLooper());
        tones = new TonePlayer(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Fractionné", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Compteur des répétitions : phase en cours et temps restant");
            channel.setSound(null, null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Au premier plan dans les 5 s qui suivent startForegroundService, quoi qu'il arrive.
        Notification placeholder = notification(title, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, placeholder, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, placeholder);
        }
        if (intent == null || !ACTION_SCHEDULE.equals(intent.getAction())) {
            // Relancé sans programme (le système a recréé le service) : rien à jouer.
            stopSelf();
            return START_NOT_STICKY;
        }
        long[] toneDelays = intent.getLongArrayExtra(EXTRA_TONE_DELAYS);
        int[] toneKinds = intent.getIntArrayExtra(EXTRA_TONE_KINDS);
        long[] cueDelays = intent.getLongArrayExtra(EXTRA_CUE_DELAYS);
        long[] cuePhaseMs = intent.getLongArrayExtra(EXTRA_CUE_PHASE_MS);
        String[] cueTitles = intent.getStringArrayExtra(EXTRA_CUE_TITLES);
        boolean vibrate = intent.getBooleanExtra(EXTRA_VIBRATE, false);
        long stopAfterMs = intent.getLongExtra(EXTRA_STOP_AFTER_MS, 0);
        handler.post(() -> apply(
            toneDelays == null ? new long[0] : toneDelays,
            toneKinds == null ? new int[0] : toneKinds,
            cueDelays == null ? new long[0] : cueDelays,
            cuePhaseMs == null ? new long[0] : cuePhaseMs,
            cueTitles == null ? new String[0] : cueTitles,
            vibrate,
            stopAfterMs
        ));
        return START_NOT_STICKY;
    }

    /** Remplace le programme en cours ; sur le fil du compteur. */
    private void apply(long[] toneDelays, int[] toneKinds, long[] cueDelays, long[] cuePhaseMs, String[] cueTitles,
                       boolean vibrate, long stopAfterMs) {
        handler.removeCallbacksAndMessages(null);
        long lastMs = 0;
        for (int i = 0; i < toneDelays.length && i < toneKinds.length; i++) {
            int kind = toneKinds[i];
            handler.postDelayed(() -> {
                if (kind == TONE_FINAL) tones.playFinal(vibrate);
                else if (kind == TONE_LONG) tones.playLong(vibrate);
                else tones.playShort(vibrate);
            }, Math.max(0, toneDelays[i]));
            lastMs = Math.max(lastMs, toneDelays[i]);
        }
        for (int i = 0; i < cueDelays.length && i < cueTitles.length && i < cuePhaseMs.length; i++) {
            String cueTitle = cueTitles[i];
            long phaseMs = cuePhaseMs[i];
            handler.postDelayed(() -> show(cueTitle, phaseMs), Math.max(0, cueDelays[i]));
        }
        if (stopAfterMs > 0) handler.postDelayed(this::stopSelf, stopAfterMs);
        // Processeur éveillé jusqu'au dernier son ; en pause, rien à jouer, il peut dormir.
        if (toneDelays.length > 0) holdWakeLock(lastMs + WAKE_MARGIN_MS);
        else releaseWakeLock();
    }

    private void show(String cueTitle, long phaseMs) {
        title = cueTitle;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(cueTitle, phaseMs));
    }

    /** Notification de la phase : son nom, et le décompte de son temps quand elle en a un. */
    private Notification notification(String text, long phaseMs) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Fractionné")
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH);
        if (phaseMs > 0) {
            builder.setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis() + phaseMs);
        } else {
            builder.setShowWhen(false);
        }
        return builder.build();
    }

    private void holdWakeLock(long timeoutMs) {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tracker:fractionne");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(timeoutMs);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        handler.post(() -> tones.release());
        thread.quitSafely();
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
