package io.github.segneur.tracker;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.location.LocationListenerCompat;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Greffon de l'enregistrement : la porte de la page vers le service de position (RecordingService) et son journal
 * (FixLog), et vers les autorisations de position et de notification.
 *
 * - `start`, `stop`, `setPaused` : les ordres de la page. `state` dit si le service tourne, pour quelle session, et
 *   s'il est en pause manuelle : la page rechargée ou rouverte sait ainsi s'il a survécu.
 * - `readLog`, `clearLog` : le journal des positions du service, que la page relit pour refaire celles qu'elle n'a
 *   pas reçues.
 * - `currentPosition` : une seule position, sans service ni notification, pour centrer une carte.
 * - `checkPermissions`, `requestPermissions` : position et notifications.
 * - Événements `fix` (une position, déjà écrite au journal), `error` (`code`, `message`) et `locationEnabled` (sans
 *   charge : la localisation du téléphone est rendue, le GPS cherche sa position).
 *
 * La page est « là » tant que ce greffon vit et qu'elle écoute `fix` ; le service le sait à chaque écouteur ajouté
 * ou retiré. Absente (application balayée, activité détruite, page en cours de recharge), il tient seul la veille
 * du GPS et la garde. Les refus portent un code, dont la page fait ses textes : aucun texte d'ici n'est montré.
 */
@CapacitorPlugin(
    name = "Recording",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }, alias = RecordingPlugin.LOCATION),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = RecordingPlugin.NOTIFICATION)
    }
)
public class RecordingPlugin extends Plugin {

    static final String LOCATION = "location";
    static final String NOTIFICATION = "notification";
    private static final String EVENT_FIX = "fix";
    private static final String EVENT_ERROR = "error";
    private static final String EVENT_LOCATION_ENABLED = "locationEnabled";

    private static final String ERROR_BAD_ARGUMENT = "BAD_ARGUMENT";
    private static final String ERROR_NOT_RUNNING = "NOT_RUNNING";
    private static final String ERROR_RUNNING = "RUNNING";
    private static final String ERROR_TIMEOUT = "TIMEOUT";

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Recherches d'une seule position en cours : rendues à la destruction de l'activité. Lu et écrit sur le fil principal. */
    private final Set<SingleFix> singles = new HashSet<>();

    /** Ce greffon vu du service : chaque message part sur le fil des greffons, celui où les écouteurs changent. */
    private final RecordingService.Page page = new RecordingService.Page() {
        @Override
        public void onFix(FixLog.Fix fix) {
            deliver(EVENT_FIX, fixObject(fix));
        }

        @Override
        public void onError(String code, String message) {
            JSObject data = new JSObject();
            data.put("code", code);
            data.put("message", message);
            deliver(EVENT_ERROR, data);
        }

        @Override
        public void onLocationEnabled() {
            deliver(EVENT_LOCATION_ENABLED, new JSObject());
        }
    };

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        RecordingService.ensureChannel(context);
        // L'application est rouverte : la notification laissée par la garde a fait son office.
        RecordingService.cancelStoppedNotification(context);
    }

    @Override
    protected void handleOnDestroy() {
        RecordingService.clearPage(page);
        main.post(() -> {
            for (SingleFix single : new HashSet<>(singles)) single.cancel();
        });
        super.handleOnDestroy();
    }

    // ---------- présence de la page ----------

    @Override
    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public void addListener(PluginCall call) {
        super.addListener(call);
        syncPage();
    }

    @Override
    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public void removeListener(PluginCall call) {
        super.removeListener(call);
        syncPage();
    }

    @Override
    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    public void removeAllListeners(PluginCall call) {
        super.removeAllListeners(call);
        syncPage();
    }

    /** Appelée par Capacitor quand la page se recharge : elle n'écoute plus, jusqu'à ce qu'elle se rebranche. */
    @Override
    public void removeAllListeners() {
        super.removeAllListeners();
        syncPage();
    }

    private void syncPage() {
        if (hasListeners(EVENT_FIX)) RecordingService.setPage(page);
        else RecordingService.clearPage(page);
    }

    private void deliver(String event, JSObject data) {
        try {
            bridge.execute(() -> notifyListeners(event, data));
        } catch (RuntimeException e) {
            // Pont fermé avec l'activité : la position reste au journal.
        }
    }

    // ---------- ordres ----------

    /**
     * Démarre l'enregistrement de `session`. Demande d'abord la position si elle n'est pas accordée (sauf
     * `requestPermissions: false`), puis les notifications dans la foulée. Rend l'état une fois le GPS demandé et
     * le journal ouvert. Localisation du téléphone coupée : le service démarre quand même, l'événement `error`
     * (`LOCATION_DISABLED`) le dit, `locationEnabled` dit son retour, et les positions arrivent ensuite.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            if (!Boolean.TRUE.equals(call.getBoolean("requestPermissions", true))) {
                call.reject("Position non autorisée", RecordingService.ERROR_NOT_AUTHORIZED);
                return;
            }
            requestPermissionForAlias(LOCATION, call, "startLocationAsked");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void startLocationAsked(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            call.reject("Position non autorisée", RecordingService.ERROR_NOT_AUTHORIZED);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATION, call, "startNotificationAsked");
            return;
        }
        launch(call);
    }

    /** Notifications refusées : l'enregistrement part quand même, sa notification restera invisible. */
    @PermissionCallback
    private void startNotificationAsked(PluginCall call) {
        launch(call);
    }

    private void launch(PluginCall call) {
        Double session = number(call, "session");
        Double intervalMs = number(call, "intervalMs");
        if (session == null || intervalMs == null || intervalMs <= 0) {
            call.reject("session et intervalMs sont requis", ERROR_BAD_ARGUMENT);
            return;
        }
        RecordingService.Settings settings = new RecordingService.Settings();
        settings.session = session.longValue();
        settings.intervalMs = intervalMs.longValue();
        settings.distanceFilterM = (float) Math.max(0, numberOr(call, "distanceFilterM", 0));
        settings.title = call.getString("title", "");
        settings.text = call.getString("text", "");
        settings.closedText = call.getString("closedText", "");
        settings.gpsLostTitle = call.getString("gpsLostTitle", "");
        settings.stoppedTitle = call.getString("stoppedTitle", "");
        settings.stoppedText = call.getString("stoppedText", "");
        settings.gpsLostDelayMs = secondsToMs(numberOr(call, "gpsLostDelayS", 0));
        settings.gpsLostRearmMs = secondsToMs(numberOr(call, "gpsLostRearmS", 0));
        settings.guardStillRadiusM = numberOr(call, "guardStillRadiusM", 0);
        settings.guardStillDelayMs = secondsToMs(numberOr(call, "guardStillDelayS", 0));
        settings.guardMaxClosedMs = secondsToMs(numberOr(call, "guardMaxClosedS", 0));
        settings.guardMovingSpeedMs = numberOr(call, "guardMovingSpeedMs", 0);
        settings.guardMovingHoldMs = secondsToMs(numberOr(call, "guardMovingHoldS", 0));
        Context context = getContext();
        RecordingService.cancelStoppedNotification(context);
        RecordingService.start(context, settings, new RecordingService.StartResult() {
            @Override
            public void started() {
                call.resolve(stateObject());
            }

            @Override
            public void failed(String code, String message) {
                call.reject(message, code);
            }
        });
    }

    /** Arrête l'enregistrement ; rend la main une fois le journal fermé, donc relisible en entier. Sans effet si rien ne tourne. */
    @PluginMethod
    public void stop(PluginCall call) {
        RecordingService.stop(call::resolve);
    }

    /** `running`, `session` (`null` si rien ne tourne), `paused`. */
    @PluginMethod
    public void state(PluginCall call) {
        // La page parle : l'activité n'a plus à repartir de zéro après une chute du moteur de rendu.
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).pageAnswered();
        call.resolve(stateObject());
    }

    /**
     * Pause manuelle ouverte (`paused: true`) ou levée, à l'heure `atMs` que la page écrit dans son propre journal
     * (à défaut, l'horloge du téléphone). Le GPS reste allumé. Refusé (`NOT_RUNNING`) si rien ne tourne.
     */
    @PluginMethod
    public void setPaused(PluginCall call) {
        Boolean paused = call.getBoolean("paused");
        if (paused == null) {
            call.reject("paused est requis", ERROR_BAD_ARGUMENT);
            return;
        }
        Double atMs = number(call, "atMs");
        RecordingService.setPaused(paused, atMs != null ? atMs.longValue() : System.currentTimeMillis(), (applied) -> {
            if (applied) call.resolve(stateObject());
            else call.reject("Aucun enregistrement en cours", ERROR_NOT_RUNNING);
        });
    }

    /**
     * Texte du journal des positions : `{ text }`, `null` sans fichier. Avec `afterMs` (l'heure de la dernière
     * position que la page a déjà), l'en-tête suivi de la seule fin utile ; sans, le fichier entier.
     */
    @PluginMethod
    public void readLog(PluginCall call) {
        Double afterMs = number(call, "afterMs");
        try {
            String text = FixLog.read(RecordingService.logFile(getContext()), afterMs != null ? Long.valueOf(afterMs.longValue()) : null);
            JSObject ret = new JSObject();
            ret.put("text", text != null ? text : JSONObject.NULL);
            call.resolve(ret);
        } catch (IOException | OutOfMemoryError e) {
            call.reject("Journal des positions illisible", RecordingService.ERROR_LOG_FAILED);
        }
    }

    /** Efface le journal des positions, une fois la session rangée ou jetée. Refusé (`RUNNING`) tant que le service tourne. */
    @PluginMethod
    public void clearLog(PluginCall call) {
        if (RecordingService.snapshot().running) {
            call.reject("Enregistrement en cours", ERROR_RUNNING);
            return;
        }
        Context context = getContext();
        RecordingService.cancelStoppedNotification(context);
        if (FixLog.delete(RecordingService.logFile(context))) call.resolve();
        else call.reject("Journal des positions impossible à effacer", RecordingService.ERROR_LOG_FAILED);
    }

    private static JSObject stateObject() {
        RecordingService.Snapshot snapshot = RecordingService.snapshot();
        JSObject ret = new JSObject();
        ret.put("running", snapshot.running);
        if (snapshot.running) ret.put("session", snapshot.session);
        else ret.put("session", JSONObject.NULL);
        ret.put("paused", snapshot.paused);
        return ret;
    }

    /** Une position pour la page, dans la forme de `LocationFix` (src/platform/location.ts) : ce que le téléphone ne donne pas est omis. */
    private static JSObject fixObject(FixLog.Fix fix) {
        JSObject data = new JSObject();
        data.put("timeMs", fix.timeMs);
        data.put("lat", fix.lat);
        data.put("lon", fix.lon);
        if (FixLog.known(fix.accuracyM)) data.put("accuracyM", fix.accuracyM);
        if (FixLog.known(fix.altitudeM)) data.put("altitudeM", fix.altitudeM);
        if (FixLog.known(fix.speedMs)) data.put("speedMs", fix.speedMs);
        if (FixLog.known(fix.bearingDeg)) data.put("bearingDeg", fix.bearingDeg);
        return data;
    }

    // ---------- une seule position ----------

    /**
     * Une position fraîche du GPS, sans service ni notification : l'application est visible, cela suffit. Possible
     * pendant un enregistrement. `timeoutMs` requis : au-delà, refus `TIMEOUT`. Demande la position si elle n'est pas
     * accordée ; refus `NOT_AUTHORIZED`, ou `LOCATION_DISABLED` si la localisation du téléphone est coupée.
     */
    @PluginMethod
    public void currentPosition(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(LOCATION, call, "currentPositionAsked");
            return;
        }
        locateOnce(call);
    }

    @PermissionCallback
    private void currentPositionAsked(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            call.reject("Position non autorisée", RecordingService.ERROR_NOT_AUTHORIZED);
            return;
        }
        locateOnce(call);
    }

    private void locateOnce(PluginCall call) {
        Double timeoutMs = number(call, "timeoutMs");
        if (timeoutMs == null || timeoutMs <= 0) {
            call.reject("timeoutMs est requis", ERROR_BAD_ARGUMENT);
            return;
        }
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null || !LocationManagerCompat.isLocationEnabled(manager)) {
            call.reject("Localisation du téléphone coupée", RecordingService.ERROR_LOCATION_DISABLED);
            return;
        }
        main.post(() -> new SingleFix(manager, call).start(timeoutMs.longValue()));
    }

    /** Écoute du GPS jusqu'à sa première position, ou jusqu'à l'échéance. Vit sur le fil principal. */
    private final class SingleFix implements LocationListenerCompat {
        private final LocationManager manager;
        private final PluginCall call;
        private final Runnable timeout;
        private boolean done = false;

        SingleFix(LocationManager manager, PluginCall call) {
            this.manager = manager;
            this.call = call;
            this.timeout = () -> finish(() -> call.reject("Position introuvable", ERROR_TIMEOUT));
        }

        void start(long timeoutMs) {
            singles.add(this);
            try {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, this, Looper.getMainLooper());
            } catch (SecurityException e) {
                finish(() -> call.reject("Position non autorisée", RecordingService.ERROR_NOT_AUTHORIZED));
                return;
            } catch (RuntimeException e) {
                finish(() -> call.reject("GPS du téléphone indisponible", RecordingService.ERROR_START_FAILED));
                return;
            }
            main.postDelayed(timeout, timeoutMs);
        }

        @Override
        public void onLocationChanged(@NonNull Location location) {
            FixLog.Fix fix = RecordingService.toFix(location);
            if (!FixLog.known(fix.lat) || !FixLog.known(fix.lon)) return;
            finish(() -> call.resolve(fixObject(fix)));
        }

        void cancel() {
            finish(() -> call.reject("Recherche abandonnée", ERROR_TIMEOUT));
        }

        private void finish(Runnable settle) {
            if (done) return;
            done = true;
            main.removeCallbacks(timeout);
            singles.remove(this);
            try {
                manager.removeUpdates(this);
            } catch (RuntimeException ignored) {
                // Écoute jamais posée : rien à rendre.
            }
            settle.run();
        }
    }

    // ---------- autorisations ----------

    /** `{ location, notification }` : `granted`, `denied` ou `prompt`. */
    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    /** Demande les autorisations nommées dans `permissions` (`location`, `notification` ; toutes à défaut), puis rend leur état. Un refus n'est pas une erreur. */
    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (wants(call, LOCATION) && getPermissionState(LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(LOCATION, call, "locationAsked");
            return;
        }
        askNotification(call);
    }

    @PermissionCallback
    private void locationAsked(PluginCall call) {
        askNotification(call);
    }

    private void askNotification(PluginCall call) {
        if (wants(call, NOTIFICATION) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATION, call, "notificationAsked");
            return;
        }
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void notificationAsked(PluginCall call) {
        call.resolve(permissionStatus());
    }

    /** Vrai si `alias` est demandé : nommé dans `permissions`, ou liste absente ou vide. */
    private static boolean wants(PluginCall call, String alias) {
        JSArray wanted = call.getArray("permissions");
        if (wanted == null || wanted.length() == 0) return true;
        try {
            for (int i = 0; i < wanted.length(); i++) {
                if (alias.equals(wanted.getString(i))) return true;
            }
        } catch (JSONException e) {
            return true;
        }
        return false;
    }

    private JSObject permissionStatus() {
        JSObject ret = new JSObject();
        ret.put(LOCATION, stateValue(getPermissionState(LOCATION)));
        // Avant Android 13, les notifications ne se demandent pas.
        ret.put(NOTIFICATION, Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? stateValue(getPermissionState(NOTIFICATION)) : "granted");
        return ret;
    }

    private static String stateValue(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    // ---------- arguments ----------

    /** Nombre donné par la page sous `name`, entier ou non ; `null` s'il manque ou n'en est pas un. */
    private static Double number(PluginCall call, String name) {
        Object value = call.getData().opt(name);
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        return FixLog.known(number) ? number : null;
    }

    private static double numberOr(PluginCall call, String name, double fallback) {
        Double value = number(call, name);
        return value != null ? value : fallback;
    }

    private static long secondsToMs(double seconds) {
        return seconds > 0 ? Math.round(seconds * 1000) : 0L;
    }
}
