package io.github.segneur.tracker;

import android.content.Intent;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bips et vibrations : le guidage vers les balises d'un parcours de voile
 * (src/recording/markGuide.ts, src/platform/beeper.ts), et le compteur du
 * fractionné (src/platform/intervalClock.ts), confié à IntervalTimerService.
 *
 * Le rythme des balises est tenu ici, sur un fil à lui : écran éteint, les
 * minuteries de la WebView sont bridées, pas celles d'Android, et le service
 * GPS de l'enregistrement garde le processeur éveillé. La couche web ne fait
 * que régler l'intervalle à chaque position reçue. Sons et vibrations :
 * TonePlayer.
 */
@CapacitorPlugin(name = "Beeper")
public class BeeperPlugin extends Plugin {

    /** Pause entre les trois bips de fin (comme beeper.ts), en millisecondes. */
    private static final int FINISH_GAP_MS = 250;

    private HandlerThread thread;
    private Handler handler;
    private TonePlayer tones;

    // État du rythme, lu et écrit sur le fil des bips seulement.
    /** Intervalle entre deux bips, en millisecondes ; 0 : silence. */
    private long intervalMs = 0;
    private boolean vibrate = false;
    private long lastBeepAt = 0;

    private final Runnable beep = new Runnable() {
        @Override
        public void run() {
            if (intervalMs <= 0) return;
            tones().playShort(vibrate);
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

    private TonePlayer tones() {
        if (tones == null) tones = new TonePlayer(getContext());
        return tones;
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
            tones().playLong(vibrate);
            // Le bip suivant attend la fin du bip long.
            lastBeepAt = SystemClock.uptimeMillis() + TonePlayer.LONG_MS;
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
                h.postDelayed(() -> tones().playLong(vibrate), (long) k * (TonePlayer.LONG_MS + FINISH_GAP_MS));
            }
            lastBeepAt = SystemClock.uptimeMillis() + 3L * TonePlayer.LONG_MS + 2L * FINISH_GAP_MS;
        });
        call.resolve();
    }

    /**
     * Un motif joué une fois, chaque son (court, long, final) à son délai en
     * millisecondes : « Écouter » de Réglages, signaux des tests. Il ne touche
     * ni au rythme des balises ni au service du compteur.
     */
    @PluginMethod
    public void pattern(PluginCall call) {
        JSArray list = call.getArray("tones", new JSArray());
        boolean vibrateRequested = Boolean.TRUE.equals(call.getBoolean("vibrate", false));
        try {
            long[] delays = new long[list.length()];
            int[] kinds = new int[list.length()];
            for (int i = 0; i < list.length(); i++) {
                JSONObject tone = list.getJSONObject(i);
                delays[i] = Math.max(0, tone.getLong("delayMs"));
                kinds[i] = IntervalTimerService.toneKind(tone.optString("tone", "court"));
            }
            Handler h = handler();
            for (int i = 0; i < delays.length; i++) {
                int kind = kinds[i];
                h.postDelayed(() -> {
                    if (kind == IntervalTimerService.TONE_FINAL) tones().playFinal(vibrateRequested);
                    else if (kind == IntervalTimerService.TONE_LONG) tones().playLong(vibrateRequested);
                    else tones().playShort(vibrateRequested);
                }, delays[i]);
            }
            call.resolve();
        } catch (JSONException e) {
            call.reject("Motif illisible : " + e.getMessage());
        }
    }

    /** Hauteur de tous les bips, en hertz (Réglages) : ceux d'ici et ceux du compteur. */
    @PluginMethod
    public void setPitch(PluginCall call) {
        Integer hz = call.getInt("hz");
        if (hz == null) {
            call.reject("Hauteur manquante.");
            return;
        }
        TonePlayer.setPitch(getContext(), hz);
        call.resolve();
    }

    /** Vibration seule, sans son ni effet sur le rythme des balises : le bouton « Note ». */
    @PluginMethod
    public void buzz(PluginCall call) {
        int durationMs = Math.max(1, Math.min(1000, call.getInt("durationMs", 80)));
        handler().post(() -> tones().vibrate(durationMs));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Handler h = handler();
        h.post(() -> {
            silence();
            h.removeCallbacksAndMessages(null);
            if (tones != null) tones.release();
            tones = null;
        });
        call.resolve();
    }

    /**
     * Compteur du fractionné : remplace le programme en cours par celui-ci
     * (sons et changements de phase, chacun à un délai en millisecondes) et
     * lance le service qui le joue, écran éteint compris ; `stopAfterMs` : le
     * service s'arrête de lui-même après ce délai (fin de séance), 0 jamais.
     */
    @PluginMethod
    public void scheduleIntervals(PluginCall call) {
        JSArray toneList = call.getArray("tones", new JSArray());
        JSArray cueList = call.getArray("cues", new JSArray());
        try {
            long[] toneDelays = new long[toneList.length()];
            int[] toneKinds = new int[toneList.length()];
            for (int i = 0; i < toneList.length(); i++) {
                JSONObject tone = toneList.getJSONObject(i);
                toneDelays[i] = tone.getLong("delayMs");
                toneKinds[i] = IntervalTimerService.toneKind(tone.optString("tone", "court"));
            }
            long[] cueDelays = new long[cueList.length()];
            long[] cuePhaseMs = new long[cueList.length()];
            String[] cueTitles = new String[cueList.length()];
            for (int i = 0; i < cueList.length(); i++) {
                JSONObject cue = cueList.getJSONObject(i);
                cueDelays[i] = cue.getLong("delayMs");
                cuePhaseMs[i] = cue.optLong("phaseMs", 0);
                cueTitles[i] = cue.optString("title", "");
            }
            Intent intent = new Intent(getContext(), IntervalTimerService.class)
                .setAction(IntervalTimerService.ACTION_SCHEDULE)
                .putExtra(IntervalTimerService.EXTRA_TONE_DELAYS, toneDelays)
                .putExtra(IntervalTimerService.EXTRA_TONE_KINDS, toneKinds)
                .putExtra(IntervalTimerService.EXTRA_CUE_DELAYS, cueDelays)
                .putExtra(IntervalTimerService.EXTRA_CUE_PHASE_MS, cuePhaseMs)
                .putExtra(IntervalTimerService.EXTRA_CUE_TITLES, cueTitles)
                .putExtra(IntervalTimerService.EXTRA_VIBRATE, Boolean.TRUE.equals(call.getBoolean("vibrate", false)))
                .putExtra(IntervalTimerService.EXTRA_STOP_AFTER_MS, (long) call.getInt("stopAfterMs", 0));
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (JSONException | RuntimeException e) {
            call.reject("Compteur impossible à lancer : " + e.getMessage());
        }
    }

    /** Arrête le compteur du fractionné : silence, plus de notification. */
    @PluginMethod
    public void stopIntervals(PluginCall call) {
        getContext().stopService(new Intent(getContext(), IntervalTimerService.class));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        Handler h = handler;
        if (h != null) {
            h.removeCallbacksAndMessages(null);
            h.post(() -> {
                if (tones != null) tones.release();
                tones = null;
            });
            thread.quitSafely();
        }
    }

    private void silence() {
        intervalMs = 0;
        handler.removeCallbacks(beep);
    }
}
