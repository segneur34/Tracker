package io.github.segneur.tracker;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bips et vibrations du guidage vers les balises d'un parcours de voile
 * (src/recording/markGuide.ts, src/platform/beeper.ts).
 *
 * Le rythme est tenu ici, sur un fil à lui : écran éteint, les minuteries de
 * la WebView sont bridées, pas celles d'Android, et le service GPS de
 * l'enregistrement garde le processeur éveillé. La couche web ne fait que
 * régler l'intervalle à chaque position reçue.
 *
 * Le son passe par le flux des alarmes : audible téléphone en silencieux, au
 * volume des alarmes. Les sons sont synthétisés une fois (sinus, fondus de
 * quelques millisecondes pour éviter les claquements), puis rejoués.
 */
@CapacitorPlugin(name = "Beeper")
public class BeeperPlugin extends Plugin {

    /** Durées, en millisecondes : bip d'approche, bip de validation, pause entre les trois bips de fin (comme beeper.ts). */
    private static final int SHORT_MS = 120;
    private static final int LONG_MS = 800;
    private static final int FINISH_GAP_MS = 250;
    /** Vibrations, en millisecondes : avec un bip d'approche, à la validation. */
    private static final int SHORT_VIBRATION_MS = 80;
    private static final int LONG_VIBRATION_MS = 600;
    /** Hauteur des bips : vers 2 kHz, un haut-parleur de téléphone porte le mieux. */
    private static final double TONE_HZ = 2000;
    private static final int SAMPLE_RATE = 44100;
    private static final int FADE_MS = 5;

    private HandlerThread thread;
    private Handler handler;
    private AudioTrack shortTone;
    private AudioTrack longTone;

    // État du rythme, lu et écrit sur le fil des bips seulement.
    /** Intervalle entre deux bips, en millisecondes ; 0 : silence. */
    private long intervalMs = 0;
    private boolean vibrate = false;
    private long lastBeepAt = 0;

    private final Runnable beep = new Runnable() {
        @Override
        public void run() {
            if (intervalMs <= 0) return;
            play(shortTone(), SHORT_VIBRATION_MS);
            lastBeepAt = SystemClock.uptimeMillis();
            handler.postDelayed(this, intervalMs);
        }
    };

    private synchronized Handler handler() {
        if (handler == null) {
            thread = new HandlerThread("TrackerBeeper");
            thread.start();
            handler = new Handler(thread.getLooper());
        }
        return handler;
    }

    // --- Méthodes ---

    @PluginMethod
    public void setInterval(PluginCall call) {
        Integer requested = call.getInt("intervalMs");
        boolean vibrateRequested = Boolean.TRUE.equals(call.getBoolean("vibrate", false));
        long next = requested == null || requested <= 0 ? 0 : requested;
        Handler h = handler();
        h.post(() -> {
            vibrate = vibrateRequested;
            if (next == intervalMs) return;
            intervalMs = next;
            h.removeCallbacks(beep);
            if (next == 0) return;
            // Le bip suivant tombe un intervalle après le précédent ; tout de suite s'il est déjà dépassé.
            h.postDelayed(beep, Math.max(0, lastBeepAt + next - SystemClock.uptimeMillis()));
        });
        call.resolve();
    }

    @PluginMethod
    public void validated(PluginCall call) {
        boolean vibrateRequested = Boolean.TRUE.equals(call.getBoolean("vibrate", false));
        Handler h = handler();
        h.post(() -> {
            silence();
            vibrate = vibrateRequested;
            play(longTone(), LONG_VIBRATION_MS);
            // Le bip suivant attend la fin du bip long.
            lastBeepAt = SystemClock.uptimeMillis() + LONG_MS;
        });
        call.resolve();
    }

    @PluginMethod
    public void finished(PluginCall call) {
        boolean vibrateRequested = Boolean.TRUE.equals(call.getBoolean("vibrate", false));
        Handler h = handler();
        h.post(() -> {
            silence();
            vibrate = vibrateRequested;
            for (int k = 0; k < 3; k++) {
                h.postDelayed(() -> play(longTone(), LONG_VIBRATION_MS), (long) k * (LONG_MS + FINISH_GAP_MS));
            }
            lastBeepAt = SystemClock.uptimeMillis() + 3L * LONG_MS + 2L * FINISH_GAP_MS;
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Handler h = handler();
        h.post(() -> {
            silence();
            h.removeCallbacksAndMessages(null);
            release();
        });
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        Handler h = handler;
        if (h != null) {
            h.removeCallbacksAndMessages(null);
            h.post(this::release);
            thread.quitSafely();
        }
    }

    // --- Sons et vibrations, sur le fil des bips ---

    private void silence() {
        intervalMs = 0;
        handler.removeCallbacks(beep);
    }

    private AudioTrack shortTone() {
        if (shortTone == null) shortTone = buildTone(SHORT_MS);
        return shortTone;
    }

    private AudioTrack longTone() {
        if (longTone == null) longTone = buildTone(LONG_MS);
        return longTone;
    }

    private void release() {
        if (shortTone != null) shortTone.release();
        if (longTone != null) longTone.release();
        shortTone = null;
        longTone = null;
    }

    /** Sinus de `durationMs`, fondu à l'entrée et à la sortie, prêt à être rejoué. */
    private static AudioTrack buildTone(int durationMs) {
        int n = SAMPLE_RATE * durationMs / 1000;
        int fade = SAMPLE_RATE * FADE_MS / 1000;
        short[] pcm = new short[n];
        for (int i = 0; i < n; i++) {
            double envelope = Math.min(1.0, Math.min(i, n - 1 - i) / (double) fade);
            pcm[i] = (short) (Math.sin(2 * Math.PI * TONE_HZ * i / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.9);
        }
        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(n * 2)
            .build();
        track.write(pcm, 0, n);
        return track;
    }

    /** Joue un son depuis son début, avec la vibration si elle est demandée. */
    private void play(AudioTrack track, int vibrationMs) {
        try {
            if (track.getPlayState() != AudioTrack.PLAYSTATE_STOPPED) track.stop();
            track.reloadStaticData();
            track.play();
        } catch (IllegalStateException e) {
            // Son indisponible (sortie audio occupée ou coupée) : la vibration reste.
        }
        if (vibrate) vibrate(vibrationMs);
    }

    /**
     * Vibration d'alarme : une application en arrière-plan, écran éteint, ne
     * vibre que si l'usage est déclaré (alarme, sonnerie, notification).
     */
    private void vibrate(int durationMs) {
        Context context = getContext();
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager != null ? manager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
            );
        } else {
            vibrator.vibrate(durationMs, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
    }
}
