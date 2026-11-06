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
 * compteur du fractionné (IntervalTimerService) : un bip bref, un bip court, un bip long,
 * et le long double de la fin d'une séance, chacun avec sa vibration ; et le
 * son « GPS perdu » de l'enregistrement (BeeperPlugin.watchGps, lot 115).
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

    /** Durées, en millisecondes : bip bref, bip court, bip long, long double (comme src/platform/beeper.ts). */
    static final int BRIEF_MS = 65;
    static final int SHORT_MS = 120;
    static final int LONG_MS = 800;
    static final int FINAL_MS = 1600;
    /** Vibrations, en millisecondes : avec un bip court, avec un bip long, avec le long double. */
    static final int BRIEF_VIBRATION_MS = 40;
    static final int SHORT_VIBRATION_MS = 80;
    static final int LONG_VIBRATION_MS = 600;
    static final int FINAL_VIBRATION_MS = 1300;
    /**
     * « GPS perdu » (comme src/core/beepDurations.ts) : deux notes
     * descendantes, la hauteur réglée puis ses 2/3, en millisecondes, jouées
     * deux fois à GPS_LOST_GAP_MS d'écart, toujours avec vibration.
     */
    static final int GPS_LOST_HIGH_MS = 250;
    static final int GPS_LOST_LOW_MS = 500;
    static final int GPS_LOST_GAP_MS = 150;
    private static final double GPS_LOST_LOW_RATIO = 2.0 / 3.0;
    /**
     * « FC perdue » (comme src/core/beepDurations.ts) : trois notes descendantes,
     * la hauteur réglée puis ses 5/6 et ses 2/3, une seule fois, avec vibration.
     */
    static final int BELT_LOST_NOTE_MS = 220;
    private static final double[] BELT_LOST_RATIOS = { 1.0, 5.0 / 6.0, 2.0 / 3.0 };
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
    private AudioTrack briefTone;
    private AudioTrack shortTone;
    private AudioTrack longTone;
    private AudioTrack finalTone;
    private AudioTrack gpsLostTone;
    private AudioTrack beltLostTone;
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

    void playBrief(boolean vibrate) {
        ensurePitch();
        if (briefTone == null) briefTone = buildTone(BRIEF_MS, builtHz);
        play(briefTone, vibrate ? BRIEF_VIBRATION_MS : 0);
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

    /** « GPS perdu » : un seul son synthétisé (les quatre notes et le silence), avec sa vibration en deux temps. */
    void playGpsLost() {
        ensurePitch();
        if (gpsLostTone == null) gpsLostTone = buildGpsLostTone(builtHz);
        play(gpsLostTone, 0);
        int on = GPS_LOST_HIGH_MS + GPS_LOST_LOW_MS;
        vibratePattern(new long[] { 0, on, GPS_LOST_GAP_MS, on });
    }

    /** « FC perdue » : un seul son synthétisé (les trois notes), avec sa vibration. */
    void playBeltLost() {
        ensurePitch();
        if (beltLostTone == null) beltLostTone = buildBeltLostTone(builtHz);
        play(beltLostTone, BELT_LOST_NOTE_MS * BELT_LOST_RATIOS.length);
    }

    void release() {
        if (briefTone != null) briefTone.release();
        if (shortTone != null) shortTone.release();
        if (longTone != null) longTone.release();
        if (finalTone != null) finalTone.release();
        if (gpsLostTone != null) gpsLostTone.release();
        if (beltLostTone != null) beltLostTone.release();
        briefTone = null;
        shortTone = null;
        longTone = null;
        finalTone = null;
        gpsLostTone = null;
        beltLostTone = null;
    }

    /** Sinus de `durationMs` à `hz`, fondu à l'entrée et à la sortie, prêt à être rejoué. */
    private static AudioTrack buildTone(int durationMs, int hz) {
        int n = SAMPLE_RATE * durationMs / 1000;
        short[] pcm = new short[n];
        writeNote(pcm, 0, n, hz);
        return track(pcm);
    }

    /** « GPS perdu » : note haute, note basse, silence, puis les deux notes de nouveau, dans un seul son. */
    private static AudioTrack buildGpsLostTone(int hz) {
        int high = SAMPLE_RATE * GPS_LOST_HIGH_MS / 1000;
        int low = SAMPLE_RATE * GPS_LOST_LOW_MS / 1000;
        int gap = SAMPLE_RATE * GPS_LOST_GAP_MS / 1000;
        int lowHz = (int) Math.round(hz * GPS_LOST_LOW_RATIO);
        short[] pcm = new short[2 * (high + low) + gap];
        int at = 0;
        for (int k = 0; k < 2; k++) {
            writeNote(pcm, at, high, hz);
            writeNote(pcm, at + high, low, lowHz);
            at += high + low + gap;
        }
        return track(pcm);
    }

    /** « FC perdue » : les trois notes à la suite, dans un seul son. */
    private static AudioTrack buildBeltLostTone(int hz) {
        int note = SAMPLE_RATE * BELT_LOST_NOTE_MS / 1000;
        short[] pcm = new short[note * BELT_LOST_RATIOS.length];
        for (int k = 0; k < BELT_LOST_RATIOS.length; k++) {
            writeNote(pcm, k * note, note, (int) Math.round(hz * BELT_LOST_RATIOS[k]));
        }
        return track(pcm);
    }

    /** Écrit dans `pcm`, à partir de `from`, un sinus de `n` échantillons à `hz`, fondu à l'entrée et à la sortie. */
    private static void writeNote(short[] pcm, int from, int n, int hz) {
        int fade = SAMPLE_RATE * FADE_MS / 1000;
        for (int i = 0; i < n; i++) {
            double envelope = Math.min(1.0, Math.min(i, n - 1 - i) / (double) fade);
            pcm[from + i] = (short) (Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE) * envelope * Short.MAX_VALUE * 0.9);
        }
    }

    /**
     * Son statique prêt à être rejoué, sur le flux des alarmes ; `null` si
     * Android refuse la piste (sortie audio occupée, trop de pistes ouvertes) :
     * la vibration reste seule, l'application ne s'arrête pas (lot 143). Une
     * piste refusée est redemandée au bip suivant.
     */
    private static AudioTrack track(short[] pcm) {
        int n = pcm.length;
        AudioTrack track;
        try {
            track = new AudioTrack.Builder()
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
        } catch (RuntimeException e) {
            return null;
        }
        // Piste statique : STATE_NO_STATIC_DATA jusqu'à l'écriture du son, STATE_UNINITIALIZED si Android l'a refusée.
        if (track.getState() == AudioTrack.STATE_UNINITIALIZED || track.write(pcm, 0, n) < 0) {
            track.release();
            return null;
        }
        return track;
    }

    /** Joue un son depuis son début (sans son si sa piste a été refusée), puis vibre `vibrationMs` (0 : sans vibration). */
    private void play(AudioTrack track, int vibrationMs) {
        if (track != null) {
            try {
                if (track.getPlayState() != AudioTrack.PLAYSTATE_STOPPED) track.stop();
                track.reloadStaticData();
                track.play();
            } catch (RuntimeException e) {
                // Son indisponible (sortie audio occupée ou coupée) : la vibration reste.
            }
        }
        if (vibrationMs > 0) vibrate(vibrationMs);
    }

    /**
     * Vibration d'alarme : une application en arrière-plan, écran éteint, ne
     * vibre que si l'usage est déclaré (alarme, sonnerie, notification).
     * Seule, sans son : le retour du bouton « Note » (BeeperPlugin.buzz).
     */
    void vibrate(int durationMs) {
        Vibrator vibrator = vibrator();
        if (vibrator == null) return;
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

    /** Vibreur du téléphone, `null` s'il n'en a pas. */
    private Vibrator vibrator() {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = manager != null ? manager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        return vibrator != null && vibrator.hasVibrator() ? vibrator : null;
    }

    /** Vibration d'alarme en plusieurs temps : `timings` alterne attente et vibration, en millisecondes, en commençant par une attente. */
    private void vibratePattern(long[] timings) {
        Vibrator vibrator = vibrator();
        if (vibrator == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(
                VibrationEffect.createWaveform(timings, -1),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createWaveform(timings, -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
            );
        } else {
            vibrator.vibrate(timings, -1, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        }
    }
}
