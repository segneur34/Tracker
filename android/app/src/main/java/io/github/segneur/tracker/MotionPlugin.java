package io.github.segneur.tracker;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capteurs du téléphone pendant un enregistrement, pour mesurer les sauts en
 * voile (src/platform/motion.ts) : accéléromètre et gyroscope bruts à 100 Hz,
 * baromètre s'il existe, écrits par paquets d'environ une seconde dans le
 * fichier privé capteurs/<startedAtMs>.imu (format : src/core/imuFile.ts,
 * écrit par ImuWriter).
 *
 * Tout se passe sur un fil à lui. Écran éteint, Android ne coupe ces capteurs
 * qu'aux applications sans service au premier plan : pendant l'enregistrement,
 * celui du GPS en tient lieu, comme pour les bips des balises, et son verrou
 * partiel garde le processeur éveillé, pour que les mesures ne débordent pas
 * des tampons des capteurs. La capture suit la pause manuelle (le GPS, lui,
 * reste allumé) ; un arrêt brutal ne perd que le dernier paquet. La capture se
 * ferme avec l'activité ; un enregistrement repris la relance en ajout au même
 * fichier (`start`, `append`).
 */
@CapacitorPlugin(name = "Motion")
public class MotionPlugin extends Plugin implements SensorEventListener {

    private static final String TAG = "TrackerMotion";
    /** Ce que la page dit d'une écriture en échec ; la cause va au journal d'Android. */
    private static final String WRITE_ERROR = "erreur du stockage du téléphone";

    /** Cadence demandée : 100 Hz. */
    private static final int SAMPLING_US = 10_000;
    /** Regroupement permis par Android avant livraison : les mesures arrivent par paquets, sans perte. */
    private static final int MAX_LATENCY_US = 1_000_000;
    /** Écriture d'un paquet du fichier, en millisecondes. */
    private static final long FLUSH_MS = 1000;
    static final String DIR = "capteurs";
    /**
     * Seul format repris par `start` en ajout : celui que `header` écrit, en toutes lettres, pour que
     * src/core/imuFile.reference.test.ts le relise dans cette source.
     */
    private static final String FORMAT = "tracker-capteurs";
    /**
     * Écart toléré, en millisecondes, entre le temps écoulé et l'heure depuis le départ d'une capture reprise :
     * au-delà, le téléphone a redémarré entre-temps (ou son heure a été changée), et la base se déduit de l'heure.
     */
    private static final long SAME_BOOT_TOLERANCE_MS = 5_000;

    private static final int ACCEL = 0;
    private static final int GYRO = 1;
    private static final int PRESSURE = 2;

    private HandlerThread thread;
    private Handler handler;

    // État de la capture, lu et écrit sur le fil des capteurs seulement.
    private ImuWriter writer;
    private File file;
    private String relativePath;
    private long startNs;
    private boolean listening = false;
    private long accelCount = 0;
    private long lastAccelNs = 0;
    private long firstNs = 0;
    private long longestGapNs = 0;
    private String writeError = null;
    /** Capture reprise sur un fichier qui gardait déjà des mesures : compteurs et durée ne disent que la suite. */
    private boolean earlierMeasures = false;
    // Réglages de la capture en cours, rendus par `status`.
    private String placement = "poitrine";
    private boolean foil = false;
    private boolean jumps = true;
    private boolean cadence = false;

    private final Runnable flush = new Runnable() {
        @Override
        public void run() {
            if (writer == null) return;
            try {
                writer.flushChunk();
            } catch (Exception e) {
                noteWriteError(e);
            }
            handler.postDelayed(this, FLUSH_MS);
        }
    };

    private synchronized Handler handler() {
        if (handler == null) {
            thread = new HandlerThread("TrackerCapteurs");
            thread.start();
            handler = new Handler(thread.getLooper());
        }
        return handler;
    }

    private SensorManager sensors() {
        return (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    }

    // --- Méthodes ---

    /** Capteurs présents : sans gyroscope, pas de mesure des sauts. Plage de l'accéléromètre en m/s². */
    @PluginMethod
    public void capabilities(PluginCall call) {
        SensorManager sm = sensors();
        Sensor accel = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        Sensor gyro = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        Sensor pressure = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
        JSObject ret = new JSObject();
        ret.put("accelerometer", accel != null);
        ret.put("gyroscope", gyro != null);
        ret.put("barometer", pressure != null);
        if (accel != null) ret.put("accelMaxRange", accel.getMaximumRange());
        if (gyro != null) ret.put("gyroMaxRange", gyro.getMaximumRange());
        call.resolve(ret);
    }

    /**
     * Démarre la capture : `startedAtMs` (instant de l'en-tête du journal, qui
     * nomme le fichier), `placement` et `foil` (réglages des sauts, gardés dans
     * l'en-tête), `jumps` et `cadence` (ce que la capture mesure, gardé dans
     * l'en-tête). Une capture déjà en cours est d'abord close.
     *
     * `append` (reprise d'un enregistrement après une coupure) : un fichier déjà
     * là est complété, avec ses flux et sa base de temps (`resumedStartNs`) ; le
     * trou entre les deux parties est laissé tel quel aux lecteurs, qui ne le
     * franchissent pas (`measuredPieces`). Fichier absent : départ neuf. En-tête
     * illisible : refus, sans toucher au fichier. Rend `appended` vrai si le
     * fichier a été complété.
     */
    @PluginMethod
    public void start(PluginCall call) {
        // Un instant en millisecondes dépasse un int : JSON le livre en Long, que getDouble ne lit pas.
        Object rawStart = call.getData().opt("startedAtMs");
        if (!(rawStart instanceof Number)) {
            call.reject("instant de départ manquant");
            return;
        }
        long startedAtMs = ((Number) rawStart).longValue();
        String placement = call.getString("placement", "poitrine");
        boolean foil = Boolean.TRUE.equals(call.getBoolean("foil", false));
        boolean jumps = !Boolean.FALSE.equals(call.getBoolean("jumps", true));
        boolean cadence = Boolean.TRUE.equals(call.getBoolean("cadence", false));
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        handler().post(() -> {
            closeCapture();
            SensorManager sm = sensors();
            Sensor accel = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            Sensor gyro = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            Sensor pressure = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
            if (accel == null || gyro == null) {
                call.reject("ce téléphone n'a pas d'accéléromètre ou de gyroscope");
                return;
            }
            boolean appended = false;
            earlierMeasures = false;
            try {
                File dir = new File(getContext().getFilesDir(), DIR);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("dossier " + DIR + " impossible à créer");
                relativePath = DIR + "/" + startedAtMs + ".imu";
                file = new File(dir, startedAtMs + ".imu");
                // Les deux horloges lues d'un coup : elles relient les instants des capteurs à l'heure.
                long nowNs = SystemClock.elapsedRealtimeNanos();
                long wallMs = System.currentTimeMillis();
                if (append && file.isFile()) {
                    ImuWriter.Existing existing;
                    ImuWriter.Stream[] streams;
                    try {
                        existing = ImuWriter.readExisting(file);
                        JSONObject header = new JSONObject(existing.headerJson);
                        if (!FORMAT.equals(header.optString("format"))) throw new JSONException("format inconnu");
                        streams = streamsOf(header.getJSONArray("streams"));
                        startNs = resumedStartNs(header.getJSONObject("clock"), nowNs, wallMs);
                    } catch (Exception e) {
                        Log.w(TAG, "Capture à reprendre illisible, laissée telle quelle : " + relativePath, e);
                        call.reject("fichier de mesures illisible, la mesure ne reprend pas");
                        return;
                    }
                    writer = new ImuWriter(file, existing, streams);
                    appended = true;
                    earlierMeasures = existing.hasPackets;
                    Log.i(TAG, "Capture : reprise en ajout de " + relativePath + " (" + existing.end + " octets gardés)");
                } else {
                    startNs = nowNs;
                    ImuWriter.Stream[] streams = pressure != null
                        ? new ImuWriter.Stream[] { accelStream(), gyroStream(), pressureStream() }
                        : new ImuWriter.Stream[] { accelStream(), gyroStream() };
                    writer = new ImuWriter(file, header(startedAtMs, startNs, wallMs, placement, foil, jumps, cadence, accel, gyro, pressure).toString(), streams);
                }
                accelCount = 0;
                lastAccelNs = 0;
                firstNs = 0;
                longestGapNs = 0;
                writeError = null;
                this.placement = placement;
                this.foil = foil;
                this.jumps = jumps;
                this.cadence = cadence;
                listen();
                handler.postDelayed(flush, FLUSH_MS);
            } catch (Exception e) {
                Log.w(TAG, "Capture impossible à démarrer", e);
                closeCapture();
                call.reject("fichier de mesures impossible à créer");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("path", relativePath);
            ret.put("appended", appended);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        handler().post(() -> {
            if (writer != null) {
                stopListening();
                try {
                    writer.flushChunk();
                } catch (Exception e) {
                    noteWriteError(e);
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        handler().post(() -> {
            if (writer != null && !listening) {
                listen();
            }
            call.resolve();
        });
    }

    /**
     * Arrête la capture et ferme le fichier. Rend son chemin relatif au dossier
     * privé, sa taille, la durée mesurée, le nombre de mesures de
     * l'accéléromètre et son plus long trou ; `path` nul si rien ne tournait.
     * Capture reprise en ajout : durée, nombre et trou ne comptent que depuis la
     * relance, et `earlierMeasures` dit si le fichier gardait des mesures d'avant.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        handler().post(() -> {
            JSObject ret = new JSObject();
            if (writer == null) {
                ret.put("path", JSONObject.NULL);
                call.resolve(ret);
                return;
            }
            String path = relativePath;
            long count = accelCount;
            double durationS = count > 1 ? (lastAccelNs - firstNs) / 1e9 : 0;
            double longestGapS = longestGapNs / 1e9;
            String error = writeError;
            boolean earlier = earlierMeasures;
            closeCapture();
            ret.put("path", path);
            ret.put("bytes", file != null ? file.length() : 0);
            ret.put("durationS", durationS);
            ret.put("samples", count);
            ret.put("longestGapS", longestGapS);
            ret.put("earlierMeasures", earlier);
            if (error != null) ret.put("error", error);
            call.resolve(ret);
        });
    }

    /**
     * État de la capture, sans y toucher : la page reprise après une chute du moteur de
     * rendu la suit ainsi tant qu'elle tourne ; `start` en ajout ne sert qu'à celle qui
     * s'est arrêtée (activité détruite). `path` nul si rien ne tourne ; `listening` faux
     * pendant une pause.
     */
    @PluginMethod
    public void status(PluginCall call) {
        handler().post(() -> {
            JSObject ret = new JSObject();
            if (writer == null) {
                ret.put("path", JSONObject.NULL);
                call.resolve(ret);
                return;
            }
            ret.put("path", relativePath);
            ret.put("listening", listening);
            ret.put("placement", placement);
            ret.put("foil", foil);
            ret.put("jumps", jumps);
            ret.put("cadence", cadence);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        Handler h = handler;
        if (h != null) {
            // La fermeture passe avant la sortie du fil : quitSafely finit les messages déjà postés.
            h.post(this::closeCapture);
            thread.quitSafely();
        }
        super.handleOnDestroy();
    }

    // --- Capteurs ---

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (writer == null) return;
        long timeUs = (event.timestamp - startNs) / 1000;
        switch (event.sensor.getType()) {
            case Sensor.TYPE_ACCELEROMETER:
                writer.add(ACCEL, timeUs, event.values);
                if (accelCount == 0) firstNs = event.timestamp;
                else longestGapNs = Math.max(longestGapNs, event.timestamp - lastAccelNs);
                lastAccelNs = event.timestamp;
                accelCount += 1;
                break;
            case Sensor.TYPE_GYROSCOPE:
                writer.add(GYRO, timeUs, event.values);
                break;
            case Sensor.TYPE_PRESSURE:
                writer.add(PRESSURE, timeUs, event.values);
                break;
            default:
                break;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Sans effet : les mesures sont gardées brutes.
    }

    private void listen() {
        SensorManager sm = sensors();
        if (sm == null) return;
        for (int type : new int[] { Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE, Sensor.TYPE_PRESSURE }) {
            Sensor sensor = sm.getDefaultSensor(type);
            if (sensor != null) sm.registerListener(this, sensor, SAMPLING_US, MAX_LATENCY_US, handler);
        }
        listening = true;
    }

    private void stopListening() {
        SensorManager sm = sensors();
        // Les mesures encore regroupées par Android (moins d'une seconde) sont perdues : sans effet sur une pause ou la fin.
        if (sm != null && listening) sm.unregisterListener(this);
        listening = false;
    }

    private void closeCapture() {
        stopListening();
        handler().removeCallbacks(flush);
        if (writer != null) {
            try {
                writer.close();
            } catch (Exception e) {
                noteWriteError(e);
            }
            writer = null;
        }
    }

    /** Une écriture en échec : retenue pour la page ; au journal d'Android une fois seulement, un disque plein échouant à chaque paquet. */
    private void noteWriteError(Exception e) {
        if (writeError == null) Log.w(TAG, "Écriture du fichier des capteurs impossible", e);
        writeError = WRITE_ERROR;
    }

    // --- En-tête ---

    private static ImuWriter.Stream accelStream() {
        return new ImuWriter.Stream(ACCEL, 3, 0.01, 0);
    }

    private static ImuWriter.Stream gyroStream() {
        return new ImuWriter.Stream(GYRO, 3, 0.002, 0);
    }

    private static ImuWriter.Stream pressureStream() {
        return new ImuWriter.Stream(PRESSURE, 1, 0.01, 1000);
    }

    /** Flux d'un fichier repris, tels que son en-tête les décrit : les mesures ajoutées s'écrivent dans la même échelle. */
    private static ImuWriter.Stream[] streamsOf(JSONArray list) throws JSONException {
        if (list.length() == 0) throw new JSONException("aucun flux");
        ImuWriter.Stream[] streams = new ImuWriter.Stream[list.length()];
        for (int i = 0; i < list.length(); i++) {
            JSONObject info = list.getJSONObject(i);
            int axes = info.getInt("axes");
            double unit = info.getDouble("unit");
            if (axes < 1 || !(unit > 0)) throw new JSONException("flux " + i + " mal décrit");
            streams[i] = new ImuWriter.Stream(info.getInt("id"), axes, unit, info.getDouble("offset"));
        }
        return streams;
    }

    /**
     * Base de temps d'une capture reprise, en nanosecondes du temps écoulé du système. Téléphone non redémarré
     * (temps écoulé et heure ont avancé d'autant depuis le départ, à `SAME_BOOT_TOLERANCE_MS` près) : celle de
     * l'en-tête. Sinon, le temps écoulé étant reparti de zéro, elle se déduit de l'heure.
     */
    private static long resumedStartNs(JSONObject clock, long nowNs, long wallMs) throws JSONException {
        long elapsedUs = clock.getLong("elapsedUs");
        long sinceByWallMs = wallMs - clock.getLong("wallMs");
        long sinceByElapsedMs = nowNs / 1_000_000 - elapsedUs / 1000;
        if (sinceByElapsedMs >= 0 && Math.abs(sinceByElapsedMs - sinceByWallMs) <= SAME_BOOT_TOLERANCE_MS) {
            return elapsedUs * 1000;
        }
        return nowNs - sinceByWallMs * 1_000_000;
    }

    private static JSONObject streamInfo(int id, String kind, int axes, double unit, double offset, Sensor sensor) throws JSONException {
        JSONObject info = new JSONObject();
        info.put("id", id);
        info.put("kind", kind);
        info.put("axes", axes);
        info.put("unit", unit);
        info.put("offset", offset);
        JSONObject s = new JSONObject();
        s.put("name", sensor.getName());
        s.put("vendor", sensor.getVendor());
        s.put("maxRange", (double) sensor.getMaximumRange());
        s.put("resolution", (double) sensor.getResolution());
        s.put("minDelayUs", sensor.getMinDelay());
        info.put("sensor", s);
        return info;
    }

    private static JSONObject header(
        long startedAtMs, long startNs, long wallMs, String placement, boolean foil, boolean jumps, boolean cadence,
        Sensor accel, Sensor gyro, Sensor pressure
    ) throws JSONException {
        JSONObject header = new JSONObject();
        header.put("format", "tracker-capteurs");
        header.put("version", 1);
        header.put("startedAtMs", startedAtMs);
        JSONObject clock = new JSONObject();
        clock.put("elapsedUs", startNs / 1000);
        clock.put("wallMs", wallMs);
        header.put("clock", clock);
        JSONObject device = new JSONObject();
        device.put("manufacturer", Build.MANUFACTURER);
        device.put("model", Build.MODEL);
        device.put("android", Build.VERSION.SDK_INT);
        header.put("device", device);
        JSONObject setup = new JSONObject();
        setup.put("placement", placement);
        setup.put("foil", foil);
        setup.put("jumps", jumps);
        setup.put("cadence", cadence);
        header.put("setup", setup);
        JSONArray streams = new JSONArray();
        streams.put(streamInfo(ACCEL, "accel", 3, 0.01, 0, accel));
        streams.put(streamInfo(GYRO, "gyro", 3, 0.002, 0, gyro));
        if (pressure != null) streams.put(streamInfo(PRESSURE, "pressure", 1, 0.01, 1000, pressure));
        header.put("streams", streams);
        return header;
    }
}
