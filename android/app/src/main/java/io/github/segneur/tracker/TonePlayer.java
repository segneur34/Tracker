package io.github.segneur.tracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Sons et vibrations communs aux bips des balises (BeeperPlugin) et au
 * compteur du fractionné (IntervalTimerService) : un bip court, un bip long,
 * et le long double de la fin d'une séance, chacun avec sa vibration.
 *
 * Le son passe par le flux des alarmes : audible téléphone en silencieux, au
 * volume des alarmes. Les sons sont synthétisés une fois (sinus, fondus de
 * quelques millisecondes pour éviter les claquements), puis rejoués. Chaque
 * utilisateur a son instance, appelée depuis un seul fil.
 *
 * Leur hauteur se choisit dans Réglages (src/recording/beepSound.ts, 24/10) :
 * gardée dans les préférences de l'application, elle vaut pour toutes les
 * instances, celle du service du compteur comprise ; une instance refait ses
 * sons au premier bip qui suit un changement.
 */
final class TonePlayer {

    /** Durées, en millisecondes : bip court, bip long, long double (comme src/platform/beeper.ts). */
    static final int SHORT_MS = 120;
    static final int LONG_MS = 800;
    static final int FINAL_MS = 1600;
    /** Vibrations, en millisecondes : avec un bip court, avec un bip long, avec le long double. */
    static final int SHORT_VIBRATION_MS = 80;
    static final int LONG_VIBRATION_MS = 600;
    static final int FINAL_VIBRATION_MS = 1300;
    /** Hauteur des bips par défaut : vers 2 kHz, un haut-parleur de téléphone porte le mieux. */
    static final int DEFAULT_PITCH_HZ = 2000;
    private static final int MIN_PITCH_HZ = 300;
    private static final int MAX_PITCH_HZ = 5000;
    private static final String PREFS = "tracker.sons";
    private static final String PREF_PITCH = "pitchHz";
    private static final int SAMPLE_RATE = 44100;
    private static final int FADE_MS = 5;

    /** Hauteur choisie, en hertz ; -1 tant qu'elle n'a pas été lue des préférences. */
    private static volatile int pitchHz = -1;

    private final Context context;
    private AudioTrack shortTone;
    private AudioTrack longTone;
    private AudioTrack finalTone;
    /** Hauteur des sons synthétisés de cette instance. */
    private int builtHz = 0;

    TonePlayer(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Hauteur de tous les bips, gardée pour les prochains lancements. */
    static void setPitch(Context context, int hz) {
        int clamped = Math.max(MIN_PITCH_HZ, Math.min(MAX_PITCH_HZ, hz));
        pitchHz = clamped;
        prefs(context).edit().putInt(PREF_PITCH, clamped).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static int pitch(Context context) {
        int hz = pitchHz;
        if (hz < 0) {
            hz = prefs(context).getInt(PREF_PITCH, DEFAULT_PITCH_HZ);
            pitchHz = hz;
        }
        return hz;
    }

    /** Sons refaits si la hauteur a changé depuis leur synthèse. */
    private void ensurePitch() {
        int hz = pitch(context);
        if (hz == builtHz) return;
        release();
        builtHz = hz;
    }

    void playShort(boolean vibrate) {
        ensurePitch();
        if (shortTone == null) shortTone = buildTone(SHORT_MS, builtHz);
        play(shortTone, vibrate ? SHORT_VIBRATION_MS : 0);
    }

    void playLong(boolean vibrate) {
        ensurePitch();
        if (longTone == null) longTone = buildTone(LONG_MS, builtHz);
        play(longTone, vibrate ? LONG_VIBRATION_MS : 0);
    }

    void playFinal(boolean vibrate) {
        ensurePitch();
        if (finalTone == null) finalTone = buildTone(FINAL_MS, builtHz);
        play(finalTone, vibrate ? FINAL_VIBRATION_MS : 0);
    }

    void release() {
        if (shortTone != null) shortTone.release();
        if (longTone != null) longTone.release();
        if (finalTone != null) finalTone.release();
        shortTone = null;
        longTone = null;
        finalTone = null;
    }

    /** Sinus de `durationMs` à `hz`, fondu à l'entrée et à la sortie, prêt à être rejoué. */
    private static AudioTrack buildTone(int durationMs, int hz) {
        int n = SAMPLE_RATE * durationMs / 1000;
        int fade = SAMPLE_RATE * FADE_MS / 1000;
        short[] pcm = new short[n];
        for (int i = 0; i < n; i++) {
            double envelope = Math.min(1.0, Math.min(i, n - 1 - i) / (double) fade);
            pcm[i] = (short) (Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.9);
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

    /** Joue un son depuis son début, puis vibre `vibrationMs` (0 : sans vibration). */
    private void play(AudioTrack track, int vibrationMs) {
        try {
            if (track.getPlayState() != AudioTrack.PLAYSTATE_STOPPED) track.stop();
            track.reloadStaticData();
            track.play();
        } catch (IllegalStateException e) {
            // Son indisponible (sortie audio occupée ou coupée) : la vibration reste.
        }
        if (vibrationMs > 0) vibrate(vibrationMs);
    }

    /**
     * Vibration d'alarme : une application en arrière-plan, écran éteint, ne
     * vibre que si l'usage est déclaré (alarme, sonnerie, notification).
     * Seule, sans son : le retour du bouton « Note » (BeeperPlugin.buzz).
     */
    void vibrate(int durationMs) {
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
