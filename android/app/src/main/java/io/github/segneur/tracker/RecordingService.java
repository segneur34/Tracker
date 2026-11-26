package io.github.segneur.tracker;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationListenerCompat;
import androidx.core.location.LocationManagerCompat;
import java.io.File;
import java.io.IOException;

/**
 * Service de l'enregistrement : il écoute le GPS du téléphone et garde chaque position, que la page soit là ou non.
 *
 * Service au premier plan de type position, démarré seulement par le greffon (RecordingPlugin), application visible.
 * Il tient le processeur éveillé tant qu'il tourne, écrit chaque position reçue dans son journal (FixLog) avant de
 * la remettre à la page si elle est là, et survit au balayage de l'application hors des applications récentes
 * (`stopWithTask="false"` au manifeste). Android ne le relance jamais seul (START_NOT_STICKY) : depuis Android 14,
 * un service de type position ne peut pas être recréé depuis l'arrière-plan sans la position « toujours », que
 * l'application ne demande pas. S'il meurt avec le processus, le journal garde tout ce qui précède et la page
 * propose de continuer.
 *
 * La notification de l'enregistrement est à lui : numéro et canal sont ici, RecordingNotificationPlugin les lit
 * pour la récrire quand la page est là. Page absente, il la récrit lui-même pour le dire, tient la veille « GPS
 * perdu » (GpsLostWatch, son de TonePlayer et titre de la notification) et la garde contre un enregistrement jamais
 * repris (ClosedGuard), qui l'arrête seul et laisse une notification simple. La ceinture cardio, les capteurs et les
 * bips de balise restent à la page : ils se taisent tant qu'elle est fermée, comme la zone cardio visée, le test de
 * FC max et la phase du compteur d'intervalles dans la notification. Ni la muscu ni la FC de nuit, sans position, ne
 * passent par lui (HeartRateService), et le compteur d'intervalles reste un service à part (IntervalTimerService).
 *
 * Ni texte visible ni seuil en dur : textes de la notification (en français, écrits par la page), cadence, délais
 * de la veille et valeurs de la garde viennent de la page, au départ (Settings). Seul le nom du canal, montré par
 * les réglages d'Android, est une ressource (recording_notification_channel_name). Tout l'enregistrement vit sur un
 * fil à lui ; l'état lu par le greffon est tenu dans des champs volatils.
 */
public class RecordingService extends Service {

    private static final String TAG = "TrackerRecording";

    /**
     * Numéro et canal de la notification de l'enregistrement. Valeurs à ne pas changer : les réglages d'écran
     * verrouillé de l'utilisateur tiennent au canal, et ce sont celles de l'ancien greffon de position (retiré) :
     * le nom hérité « com.capgo… » reste, un canal déjà créé sur les téléphones ne se renomme pas.
     */
    static final int NOTIFICATION_ID = 28351;
    static final String CHANNEL_ID = "com.capgo.capacitor_background_geolocation";
    /** Notification simple laissée par la garde après son arrêt. */
    static final int STOPPED_NOTIFICATION_ID = 28352;

    /**
     * GPS muet depuis ce délai, après avoir donné une position : son écoute est relancée, après une courte coupure.
     * Jamais pendant la recherche d'une première position ni localisation coupée (GpsRestart).
     */
    private static final long GPS_RESTART_AFTER_MS = 60_000L;
    private static final long GPS_RESTART_PAUSE_MS = 10_000L;
    /** Rythme auquel la garde est interrogée, page absente. */
    private static final long GUARD_TICK_MS = 30_000L;

    /** Codes d'erreur rendus à la page, qui en fait ses textes. */
    static final String ERROR_NOT_AUTHORIZED = "NOT_AUTHORIZED";
    static final String ERROR_LOCATION_DISABLED = "LOCATION_DISABLED";
    static final String ERROR_START_FAILED = "START_FAILED";
    static final String ERROR_LOG_FAILED = "LOG_FAILED";
    static final String ERROR_SUPERSEDED = "SUPERSEDED";

    /** La page, quand elle est là : le greffon vivant et à l'écoute. Appelée depuis le fil de l'enregistrement. */
    interface Page {
        void onFix(FixLog.Fix fix);

        void onError(String code, String message);

        /** La localisation du téléphone est rendue : le GPS cherche sa position, une erreur LOCATION_DISABLED n'a plus lieu d'être. */
        void onLocationEnabled();
    }

    /** Issue d'un départ demandé par le greffon. */
    interface StartResult {
        void started();

        void failed(String code, String message);
    }

    /** Issue d'un ordre : vrai s'il a été appliqué. */
    interface Result {
        void done(boolean applied);
    }

    /** Ce que le greffon lit de l'enregistrement en cours. */
    static final class Snapshot {
        final boolean running;
        final long session;
        final boolean paused;

        Snapshot(boolean running, long session, boolean paused) {
            this.running = running;
            this.session = session;
            this.paused = paused;
        }
    }

    /** Ce que la page donne au départ. */
    static final class Settings {
        /** Identifiant de la session : le `startedAtMs` de l'en-tête du journal de la page. */
        long session;
        /** Intervalle demandé entre deux positions, en millisecondes, et déplacement minimal, en mètres. */
        long intervalMs;
        float distanceFilterM;
        /** Titre et texte de la notification au départ, page présente. */
        String title = "";
        String text = "";
        /** Texte de la notification quand la page est absente. */
        String closedText = "";
        /** Titre de la notification pendant une perte du GPS, page absente. */
        String gpsLostTitle = "";
        /** Titre et texte de la notification simple laissée par la garde. */
        String stoppedTitle = "";
        String stoppedText = "";
        /** Délais de la veille « GPS perdu », en millisecondes ; 0 : pas de veille. */
        long gpsLostDelayMs;
        long gpsLostRearmMs;
        /** Valeurs de la garde : rayon en mètres, vitesse en m/s, durées en millisecondes ; 0 éteint la règle. */
        double guardStillRadiusM;
        long guardStillDelayMs;
        long guardMaxClosedMs;
        double guardMovingSpeedMs;
        long guardMovingHoldMs;

        Bundle toBundle() {
            Bundle bundle = new Bundle();
            bundle.putLong("session", session);
            bundle.putLong("intervalMs", intervalMs);
            bundle.putFloat("distanceFilterM", distanceFilterM);
            bundle.putString("title", title);
            bundle.putString("text", text);
            bundle.putString("closedText", closedText);
            bundle.putString("gpsLostTitle", gpsLostTitle);
            bundle.putString("stoppedTitle", stoppedTitle);
            bundle.putString("stoppedText", stoppedText);
            bundle.putLong("gpsLostDelayMs", gpsLostDelayMs);
            bundle.putLong("gpsLostRearmMs", gpsLostRearmMs);
            bundle.putDouble("guardStillRadiusM", guardStillRadiusM);
            bundle.putLong("guardStillDelayMs", guardStillDelayMs);
            bundle.putLong("guardMaxClosedMs", guardMaxClosedMs);
            bundle.putDouble("guardMovingSpeedMs", guardMovingSpeedMs);
            bundle.putLong("guardMovingHoldMs", guardMovingHoldMs);
            return bundle;
        }

        static Settings from(Bundle bundle) {
            Settings settings = new Settings();
            settings.session = bundle.getLong("session");
            settings.intervalMs = bundle.getLong("intervalMs");
            settings.distanceFilterM = bundle.getFloat("distanceFilterM");
            settings.title = bundle.getString("title", "");
            settings.text = bundle.getString("text", "");
            settings.closedText = bundle.getString("closedText", "");
            settings.gpsLostTitle = bundle.getString("gpsLostTitle", "");
            settings.stoppedTitle = bundle.getString("stoppedTitle", "");
            settings.stoppedText = bundle.getString("stoppedText", "");
            settings.gpsLostDelayMs = bundle.getLong("gpsLostDelayMs");
            settings.gpsLostRearmMs = bundle.getLong("gpsLostRearmMs");
            settings.guardStillRadiusM = bundle.getDouble("guardStillRadiusM");
            settings.guardStillDelayMs = bundle.getLong("guardStillDelayMs");
            settings.guardMaxClosedMs = bundle.getLong("guardMaxClosedMs");
            settings.guardMovingSpeedMs = bundle.getDouble("guardMovingSpeedMs");
            settings.guardMovingHoldMs = bundle.getLong("guardMovingHoldMs");
            return settings;
        }
    }

    // ---------- ce que le greffon voit ----------

    /** Verrou de la page, du départ en attente et de la notification récrite par le service. */
    private static final Object STATE = new Object();
    private static volatile RecordingService live;
    private static volatile Page page;
    private static StartResult pendingStart;

    /** Fichier du journal des positions : dossier privé, hors sauvegarde et hors transfert d'appareil. */
    static File logFile(Context context) {
        return new File(context.getNoBackupFilesDir(), FixLog.FILE_NAME);
    }

    static Snapshot snapshot() {
        RecordingService service = live;
        Settings current = service != null ? service.settings : null;
        if (service == null || current == null || !service.active) return new Snapshot(false, 0L, false);
        return new Snapshot(true, current.session, service.paused);
    }

    /**
     * Démarre l'enregistrement de `settings.session`, application visible. Sur la session déjà en cours, ne relance
     * rien : seuls les textes de la notification sont repris, pour sa prochaine récriture par le service. Sur une
     * autre, l'ancienne est close d'abord. `result` est appelé une fois le GPS demandé et le journal ouvert, ou sur
     * un refus.
     */
    static void start(Context context, Settings settings, StartResult result) {
        StartResult previous;
        synchronized (STATE) {
            previous = pendingStart;
            pendingStart = result;
        }
        if (previous != null) previous.failed(ERROR_SUPERSEDED, "Départ remplacé par un autre");
        // Déjà en cours pour cette session : rien à démarrer, donc rien qu'Android puisse refuser hors du premier plan.
        RecordingService service = live;
        Settings current = service != null ? service.settings : null;
        if (service != null && service.active && current != null && current.session == settings.session && service.worker.post(() -> service.begin(settings))) {
            return;
        }
        Intent intent = new Intent(context, RecordingService.class).putExtras(settings.toBundle());
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException e) {
            // Refusé hors du premier plan, ou sans l'autorisation de position (Android 12 et 14).
            Log.e(TAG, "Service refusé au départ", e);
            finishStart(ERROR_START_FAILED, "Service d'enregistrement refusé par le téléphone");
        }
    }

    private static void finishStart(String code, String message) {
        StartResult result;
        synchronized (STATE) {
            result = pendingStart;
            pendingStart = null;
        }
        if (result == null) return;
        if (code == null) result.started();
        else result.failed(code, message);
    }

    /**
     * Arrête l'enregistrement : GPS coupé, journal forcé sur le disque et fermé, notification retirée. `done` est
     * appelé ensuite, le journal entier pouvant alors être relu ; aussitôt si rien ne tourne.
     */
    static void stop(Runnable done) {
        RecordingService service = live;
        if (service == null || !service.worker.post(() -> {
            service.end();
            service.main.post(() -> {
                service.leaveForeground();
                service.stopSelf();
                done.run();
            });
        })) {
            done.run();
        }
    }

    /**
     * Pause manuelle ouverte ou levée, à l'heure `atMs` que la page écrit dans son propre journal : une ligne au
     * journal, et la veille du GPS suit. Le GPS reste allumé. `result` reçoit faux si rien ne tourne.
     */
    static void setPaused(boolean paused, long atMs, Result result) {
        RecordingService service = live;
        if (service == null || !service.worker.post(() -> result.done(service.pause(paused, atMs)))) result.done(false);
    }

    /**
     * « Réessayer » du GPS : localisation allumée et aucune position depuis le départ, l'inscription au GPS est
     * refaite (GpsResubscribe). Sans effet si rien ne tourne.
     */
    static void retryGps() {
        RecordingService service = live;
        if (service != null) service.worker.post(service::retryListen);
    }

    /** La page est là (`next`) ou absente (`null`). */
    static void setPage(Page next) {
        changePage(next, null, false);
    }

    /** La page `gone` s'en va, si c'est encore elle : une page plus récente n'est pas touchée. */
    static void clearPage(Page gone) {
        changePage(null, gone, true);
    }

    private static void changePage(Page next, Page expected, boolean onlyIfExpected) {
        RecordingService service;
        synchronized (STATE) {
            if (onlyIfExpected && page != expected) return;
            if (page == next) return;
            page = next;
            service = live;
            // La page revient : la notification redevient la sienne, avant tout ce qu'elle y écrira elle-même.
            if (service != null && next != null && service.active && service.closedShown) {
                Settings current = service.settings;
                if (current != null) service.post(NOTIFICATION_ID, service.ongoing(current.title, current.text));
                service.closedShown = false;
            }
        }
        if (service != null) service.worker.post(service::syncPage);
    }

    /** Crée le canal de la notification, s'il manque (le même que celui du greffon de position d'avant et de HeartRateService). */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.recording_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    /** Efface la notification laissée par la garde : l'application est rouverte, elle a fait son office. */
    static void cancelStoppedNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(STOPPED_NOTIFICATION_ID);
    }

    /** La position d'Android dans les termes du journal ; ce que le téléphone ne donne pas reste absent. */
    static FixLog.Fix toFix(Location location) {
        long timeMs = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        return new FixLog.Fix(
            timeMs,
            location.getLatitude(),
            location.getLongitude(),
            location.hasAccuracy() ? FixLog.exact(location.getAccuracy()) : Double.NaN,
            location.hasAltitude() ? location.getAltitude() : Double.NaN,
            location.hasSpeed() ? FixLog.exact(location.getSpeed()) : Double.NaN,
            location.hasBearing() ? FixLog.exact(location.getBearing()) : Double.NaN
        );
    }

    // ---------- le service ----------

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler worker;

    /** Lus par le greffon depuis son fil ; écrits sur le fil de l'enregistrement. */
    private volatile boolean active = false;
    private volatile boolean paused = false;
    private volatile Settings settings;
    private volatile FixLog log;
    /** La notification porte le texte « page absente » du service ; gardé par STATE. */
    private boolean closedShown = false;

    /** Propres au fil de l'enregistrement. */
    private LocationManager manager;
    private LocationListenerCompat listener;
    private boolean listening = false;
    private PowerManager.WakeLock wakeLock;
    private GpsLostWatch watch;
    private GpsRestart restart;
    private GpsResubscribe resubscribe;
    private ClosedGuard guard;
    private TonePlayer tones;
    private boolean logFailureTold = false;
    private boolean disabledTold = false;

    private final Runnable watchExpired = () -> {
        if (active && watch != null) apply(watch.onExpired(SystemClock.elapsedRealtime()));
    };

    private final Runnable guardTick = this::askGuard;

    // Rien n'est réarmé ici : le GPS cherche de nouveau sa première position, la suivante armera la relance.
    private final Runnable gpsRelisten = () -> {
        if (active) requestUpdates();
    };

    private final Runnable gpsSilent = () -> {
        if (!active || restart == null || !restart.onExpired(SystemClock.elapsedRealtime())) return;
        Log.w(TAG, "GPS muet : écoute relancée");
        stopUpdates();
        worker.postDelayed(gpsRelisten, GPS_RESTART_PAUSE_MS);
    };

    /** Extinction du téléphone : ce qui est écrit est forcé sur le disque, sans attendre l'écart habituel. */
    private final BroadcastReceiver shutdown = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            FixLog current = log;
            if (current == null) return;
            try {
                current.sync(SystemClock.elapsedRealtime());
            } catch (IOException e) {
                Log.w(TAG, "Journal non forcé sur le disque à l'extinction", e);
            }
        }
    };

    /**
     * Localisation du téléphone allumée ou coupée, reçue sur le fil de l'enregistrement. Guettée ici et non par la
     * seule inscription au GPS : faite localisation coupée, celle-ci peut rester inactive à son retour, sans position
     * ni avis du fournisseur ; elle est alors refaite (GpsResubscribe).
     */
    private final BroadcastReceiver locationMode = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!active || resubscribe == null) return;
            if (!resubscribe.onLocationMode(locationEnabled())) return;
            onLocationBack();
            relisten("localisation rallumée");
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("TrackerRecording");
        thread.start();
        worker = new Handler(thread.getLooper());
        ensureChannel(this);
        ContextCompat.registerReceiver(this, shutdown, new IntentFilter(Intent.ACTION_SHUTDOWN), ContextCompat.RECEIVER_NOT_EXPORTED);
        ContextCompat.registerReceiver(this, locationMode, new IntentFilter(LocationManager.MODE_CHANGED_ACTION), null, worker, ContextCompat.RECEIVER_NOT_EXPORTED);
        live = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Bundle extras = intent != null ? intent.getExtras() : null;
        if (extras == null) {
            // Jamais attendu : le service n'est démarré que par le greffon, avec ses réglages.
            if (!active) stopSelf();
            return START_NOT_STICKY;
        }
        Settings next = Settings.from(extras);
        try {
            // Tout de suite : Android tue l'application si la notification ne suit pas le départ de quelques secondes.
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
            synchronized (STATE) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, ongoing(next.title, next.text), type);
                closedShown = false;
            }
        } catch (RuntimeException e) {
            Log.e(TAG, "Passage au premier plan refusé", e);
            finishStart(ERROR_START_FAILED, "Service d'enregistrement refusé par le téléphone");
            if (!active) stopSelf();
            return START_NOT_STICKY;
        }
        worker.post(() -> begin(next));
        return START_NOT_STICKY;
    }

    /** Balayée hors des applications récentes : la page n'est plus là, l'enregistrement continue. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        setPage(null);
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(shutdown);
        } catch (RuntimeException ignored) {
            // Jamais enregistré : rien à retirer.
        }
        try {
            unregisterReceiver(locationMode);
        } catch (RuntimeException ignored) {
            // Jamais enregistré : rien à retirer.
        }
        // Arrêté sans passer par `stop` : le GPS est rendu et le journal fermé avant que le fil ne s'arrête.
        worker.post(this::end);
        thread.quitSafely();
        if (live == this) live = null;
        super.onDestroy();
    }

    // ---------- sur le fil de l'enregistrement ----------

    private void begin(Settings next) {
        Settings current = settings;
        if (active && current != null && current.session == next.session) {
            // Déjà en cours pour cette session : seuls les textes changent, la veille et la garde gardent leurs comptes.
            settings = next;
            syncPage();
            finishStart(null, null);
            return;
        }
        if (active) end();
        settings = next;
        paused = false;
        logFailureTold = false;
        disabledTold = false;
        acquireWakeLock();
        long now = SystemClock.elapsedRealtime();
        try {
            log = FixLog.open(logFile(this), next.session, System.currentTimeMillis(), now);
        } catch (IOException e) {
            Log.e(TAG, "Journal des positions impossible à ouvrir", e);
            log = null;
            tellLogFailure();
        }
        // Une source qui n'envoie qu'après un déplacement se tait à l'arrêt, sans être perdue : pas de veille alors.
        watch = next.gpsLostDelayMs > 0 && next.distanceFilterM <= 0 ? new GpsLostWatch(next.gpsLostDelayMs, next.gpsLostRearmMs) : null;
        guard = new ClosedGuard(next.guardStillRadiusM, next.guardStillDelayMs, next.guardMaxClosedMs, next.guardMovingSpeedMs, next.guardMovingHoldMs);
        restart = new GpsRestart(GpsRestart.delayFor(GPS_RESTART_AFTER_MS, next.intervalMs, next.distanceFilterM));
        resubscribe = new GpsResubscribe(locationEnabled());
        synchronized (STATE) {
            active = true;
        }
        requestUpdates();
        syncPage();
        finishStart(null, null);
    }

    /** Rend le GPS, ferme le journal et relâche le processeur. Sans effet si rien ne tourne. */
    private void end() {
        synchronized (STATE) {
            if (!active) return;
            active = false;
        }
        paused = false;
        worker.removeCallbacks(watchExpired);
        worker.removeCallbacks(guardTick);
        worker.removeCallbacks(gpsSilent);
        worker.removeCallbacks(gpsRelisten);
        stopUpdates();
        FixLog closing = log;
        log = null;
        if (closing != null) {
            try {
                closing.close();
            } catch (IOException e) {
                Log.w(TAG, "Journal des positions mal fermé", e);
            }
        }
        if (tones != null) tones.release();
        tones = null;
        releaseWakeLock();
    }

    private void onLocation(Location location) {
        if (!active) return;
        long now = SystemClock.elapsedRealtime();
        if (listening) armRestart(restart.onFix(now));
        resubscribe.onFix();
        FixLog.Fix fix = toFix(location);
        String line = FixLog.fixLine(fix);
        if (line == null) return;
        // Au journal d'abord : la position est gardée même si la page ne la reçoit jamais.
        append(line, now);
        disabledTold = false;
        Page target = page;
        if (target != null) target.onFix(fix);
        if (watch != null) apply(watch.onFix(now));
        guard.onFix(now, fix.lat, fix.lon, fix.accuracyM, fix.speedMs);
    }

    private boolean pause(boolean next, long atMs) {
        if (!active) return false;
        long now = SystemClock.elapsedRealtime();
        append(next ? FixLog.pauseLine(atMs) : FixLog.resumeLine(atMs), now);
        paused = next;
        if (watch != null) apply(next ? watch.onPause() : watch.onResume(now));
        return true;
    }

    private void append(String line, long now) {
        FixLog current = log;
        if (current == null) return;
        try {
            current.append(line, now);
        } catch (IOException e) {
            Log.e(TAG, "Journal des positions : écriture refusée", e);
            tellLogFailure();
        }
    }

    /** Dit une fois par enregistrement : la page continue de recevoir les positions, seul le filet manque. */
    private void tellLogFailure() {
        if (logFailureTold) return;
        logFailureTold = true;
        tellPage(ERROR_LOG_FAILED, "Journal des positions du téléphone impossible à écrire");
    }

    private void tellPage(String code, String message) {
        Page target = page;
        if (target != null) target.onError(code, message);
    }

    /** Applique ce que la veille du GPS demande. Page présente, c'est elle qui prévient : ni son ni titre ici. */
    private void apply(GpsLostWatch.Step step) {
        if (step.disarm) worker.removeCallbacks(watchExpired);
        if (step.armMs >= 0) {
            worker.removeCallbacks(watchExpired);
            worker.postDelayed(watchExpired, step.armMs);
        }
        if (step.lost && page == null) {
            if (tones == null) tones = new TonePlayer(this);
            tones.playGpsLost();
        }
        if (step.lost || step.cleared) showClosedNotification();
    }

    /** Accorde la garde et la notification à la présence de la page. */
    private void syncPage() {
        if (!active) return;
        if (page == null) {
            if (!guard.closed()) {
                guard.onClosed(SystemClock.elapsedRealtime());
                worker.removeCallbacks(guardTick);
                worker.postDelayed(guardTick, GUARD_TICK_MS);
            }
            showClosedNotification();
        } else if (guard.closed()) {
            guard.onOpened();
            worker.removeCallbacks(guardTick);
        }
    }

    private void askGuard() {
        if (!active || page != null || !guard.closed()) return;
        String reason = guard.check(SystemClock.elapsedRealtime());
        if (reason == null) {
            worker.postDelayed(guardTick, GUARD_TICK_MS);
            return;
        }
        Log.w(TAG, "Arrêt par la garde : " + reason);
        Settings last = settings;
        append(FixLog.stopLine(System.currentTimeMillis(), reason), SystemClock.elapsedRealtime());
        end();
        main.post(() -> {
            leaveForeground();
            if (last != null && !last.stoppedTitle.isEmpty()) post(STOPPED_NOTIFICATION_ID, stopped(last.stoppedTitle, last.stoppedText));
            stopSelf();
        });
    }

    /** Page absente : la notification le dit, avec la perte du GPS au titre tant qu'elle dure. */
    private void showClosedNotification() {
        Settings current = settings;
        if (current == null) return;
        boolean lost = watch != null && watch.lost() && !current.gpsLostTitle.isEmpty();
        synchronized (STATE) {
            if (!active || page != null) return;
            post(NOTIFICATION_ID, ongoing(lost ? current.gpsLostTitle : current.title, current.closedText.isEmpty() ? current.text : current.closedText));
            closedShown = true;
        }
    }

    private void requestUpdates() {
        Settings current = settings;
        if (current == null) return;
        if (manager == null) manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (listener == null) {
            listener = new LocationListenerCompat() {
                @Override
                public void onLocationChanged(@NonNull Location location) {
                    onLocation(location);
                }

                @Override
                public void onProviderDisabled(@NonNull String provider) {
                    // Localisation du téléphone coupée : dit une fois. Aucune relance tant qu'elle l'est : rien ne viendrait.
                    // Les positions ne reviennent pas toujours seules à son retour : le service le guette (locationMode)
                    // et refait alors son inscription.
                    if (!active) return;
                    restart.onLocationDisabled();
                    worker.removeCallbacks(gpsSilent);
                    if (disabledTold) return;
                    disabledTold = true;
                    tellPage(ERROR_LOCATION_DISABLED, "Localisation du téléphone coupée");
                }

                @Override
                public void onProviderEnabled(@NonNull String provider) {
                    if (active) onLocationBack();
                }
            };
        }
        if (manager == null) {
            tellPage(ERROR_START_FAILED, "Service de localisation absent");
            return;
        }
        try {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, current.intervalMs, current.distanceFilterM, listener, thread.getLooper());
            listening = true;
        } catch (SecurityException e) {
            Log.e(TAG, "Position refusée", e);
            tellPage(ERROR_NOT_AUTHORIZED, "Autorisation de position retirée");
        } catch (RuntimeException e) {
            // Téléphone sans GPS, par exemple.
            Log.e(TAG, "GPS impossible à écouter", e);
            tellPage(ERROR_START_FAILED, "GPS du téléphone indisponible");
        }
    }

    /**
     * Localisation rendue, dite par l'inscription au GPS ou guettée par le service : la page quitte l'alerte pour
     * l'attente de la position, et une nouvelle coupure sera redite. Sans dommage si les deux avis arrivent.
     */
    private void onLocationBack() {
        disabledTold = false;
        restart.onLocationEnabled();
        worker.removeCallbacks(gpsSilent);
        Page target = page;
        if (target != null) target.onLocationEnabled();
    }

    /** Retire puis refait l'inscription au GPS, sur ce fil : une inscription restée inactive repart, sans doublon. */
    private void relisten(String reason) {
        if (!active) return;
        worker.removeCallbacks(gpsSilent);
        worker.removeCallbacks(gpsRelisten);
        Log.i(TAG, "Inscription au GPS refaite : " + reason);
        stopUpdates();
        requestUpdates();
    }

    /** « Réessayer » du GPS, sur ce fil : l'inscription est refaite, localisation allumée, sans position depuis le départ. */
    private void retryListen() {
        if (!active || resubscribe == null) return;
        boolean on = locationEnabled();
        if (resubscribe.onRetry(on)) {
            // L'avis du retour de la localisation a pu ne jamais arriver : la page quitte ici aussi son alerte.
            onLocationBack();
            relisten("Réessayer");
        } else Log.i(TAG, "Réessayer : inscription au GPS gardée (localisation " + (on ? "allumée, position déjà reçue" : "coupée") + ")");
    }

    private boolean locationEnabled() {
        if (manager == null) manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        return manager != null && LocationManagerCompat.isLocationEnabled(manager);
    }

    private void stopUpdates() {
        listening = false;
        if (manager == null || listener == null) return;
        try {
            manager.removeUpdates(listener);
        } catch (RuntimeException e) {
            Log.w(TAG, "Écoute du GPS mal rendue", e);
        }
    }

    /** Arme (ou repousse) la relance pour `delayMs` ; négatif, ne l'arme pas. */
    private void armRestart(long delayMs) {
        worker.removeCallbacks(gpsSilent);
        if (delayMs >= 0) worker.postDelayed(gpsSilent, delayMs);
    }

    // Sans échéance : le verrou dure ce que dure l'enregistrement, et il est toujours rendu par `end`.
    @SuppressLint("WakelockTimeout")
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power == null) return;
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tracker:Enregistrement");
            wakeLock.acquire();
        } catch (RuntimeException e) {
            Log.e(TAG, "Verrou de veille refusé", e);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (RuntimeException e) {
            Log.w(TAG, "Verrou de veille mal rendu", e);
        }
        wakeLock = null;
    }

    // ---------- notifications ----------

    private void leaveForeground() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    }

    private void post(int id, Notification notification) {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (notifications == null) return;
        try {
            notifications.notify(id, notification);
        } catch (RuntimeException e) {
            Log.w(TAG, "Notification refusée", e);
        }
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Notification permanente de l'enregistrement, lisible écran verrouillé, sans bouton : « Arrêter » se tient dans l'application. */
    private Notification ongoing(String title, String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** Notification simple laissée par la garde : la toucher ouvre l'application, qui range la session. */
    private Notification stopped(String title, String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }
}
