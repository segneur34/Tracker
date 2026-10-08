package io.github.segneur.tracker;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.os.SystemClock;
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
 * celui du GPS en tient lieu, comme pour les bips des balises. Un verrou
 * partiel garde en plus le processeur éveillé, pour que les mesures ne
 * débordent pas des tampons des capteurs. La capture suit la pause manuelle
 * (le GPS aussi s'arrête) ; un arrêt brutal ne perd que le dernier paquet.
 */
@CapacitorPlugin(name = "Motion")
public class MotionPlugin extends Plugin implements SensorEventListener {

    /** Cadence demandée : 100 Hz. */
    private static final int SAMPLING_US = 10_000;
    /** Regroupement permis par Android avant livraison : les mesures arrivent par paquets, sans perte. */
    private static final int MAX_LATENCY_US = 1_000_000;
    /** Écriture d'un paquet du fichier, en millisecondes. */
    private static final long FLUSH_MS = 1000;
    /** Garde du verrou, au-delà de toute séance : il est rendu à l'arrêt. */
    private static final long WAKE_TIMEOUT_MS = 8L * 3600 * 1000;
    static final String DIR = "capteurs";

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
    private PowerManager.WakeLock wakeLock;
    private long accelCount = 0;
    private long lastAccelNs = 0;
    private long firstNs = 0;
    private long longestGapNs = 0;
    private String writeError = null;

    private final Runnable flush = new Runnable() {
        @Override
        public void run() {
            if (writer == null) return;
            try {
                writer.flushChunk();
            } catch (Exception e) {
                writeError = e.getMessage();
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
     * l'en-tête). Une capture déjà en cours est d'abord close.
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
            try {
                File dir = new File(getContext().getFilesDir(), DIR);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("dossier " + DIR + " impossible à créer");
                relativePath = DIR + "/" + startedAtMs + ".imu";
                file = new File(dir, startedAtMs + ".imu");
                // Les deux horloges lues d'un coup : elles relient les instants des capteurs à l'heure.
                startNs = SystemClock.elapsedRealtimeNanos();
                long wallMs = System.currentTimeMillis();
                ImuWriter.Stream[] streams = pressure != null
                    ? new ImuWriter.Stream[] { accelStream(), gyroStream(), pressureStream() }
                    : new ImuWriter.Stream[] { accelStream(), gyroStream() };
                writer = new ImuWriter(file, header(startedAtMs, startNs, wallMs, placement, foil, accel, gyro, pressure).toString(), streams);
                accelCount = 0;
                lastAccelNs = 0;
                firstNs = 0;
                longestGapNs = 0;
                writeError = null;
                acquireWakeLock();
                listen();
                handler.postDelayed(flush, FLUSH_MS);
            } catch (Exception e) {
                closeCapture();
                call.reject("capture impossible : " + e.getMessage());
                return;
            }
            JSObject ret = new JSObject();
            ret.put("path", relativePath);
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
                    writeError = e.getMessage();
                }
                releaseWakeLock();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        handler().post(() -> {
            if (writer != null && !listening) {
                acquireWakeLock();
                listen();
            }
            call.resolve();
        });
    }

    /**
     * Arrête la capture et ferme le fichier. Rend son chemin relatif au dossier
     * privé, sa taille, la durée mesurée, le nombre de mesures de
     * l'accéléromètre et son plus long trou ; `path` nul si rien ne tournait.
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
            closeCapture();
            ret.put("path", path);
            ret.put("bytes", file != null ? file.length() : 0);
            ret.put("durationS", durationS);
            ret.put("samples", count);
            ret.put("longestGapS", longestGapS);
            if (error != null) ret.put("error", error);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (handler != null) handler.post(this::closeCapture);
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
                writeError = e.getMessage();
            }
            writer = null;
        }
        releaseWakeLock();
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tracker:capteurs");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire(WAKE_TIMEOUT_MS);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
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
        long startedAtMs, long startNs, long wallMs, String placement, boolean foil, Sensor accel, Sensor gyro, Sensor pressure
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
        header.put("setup", setup);
        JSONArray streams = new JSONArray();
        streams.put(streamInfo(ACCEL, "accel", 3, 0.01, 0, accel));
        streams.put(streamInfo(GYRO, "gyro", 3, 0.002, 0, gyro));
        if (pressure != null) streams.put(streamInfo(PRESSURE, "pressure", 1, 0.01, 1000, pressure));
        header.put("streams", streams);
        return header;
    }
}
