package io.github.segneur.tracker;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.ArrayDeque;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "TrackerRendu";
    /** Recharges de la page permises après une chute du moteur de rendu, sur la fenêtre qui suit. */
    private static final int MAX_RENDER_RELOADS = 3;
    private static final long RENDER_RELOADS_WINDOW_MS = 10 * 60_000L;
    /** Attente de la page rechargée : au-delà, l'activité repart de zéro. */
    private static final long PAGE_LOAD_TIMEOUT_MS = 20_000L;

    /**
     * Instants des dernières recharges. Lus et écrits sur le fil principal. Statiques : la
     * garde vaut pour le processus, un `recreate()` ne la remet pas à zéro.
     */
    private static final ArrayDeque<Long> RENDER_RELOADS = new ArrayDeque<>();
    /** Gardé d'une activité à l'autre : le son doit durer après le `recreate()` qui le suit. */
    private static TonePlayer pageLostTone;

    private final Handler main = new Handler(Looper.getMainLooper());

    /** La page n'est pas revenue : le son « GPS perdu » prévient, puis l'activité repart, service GPS arrêté avec elle. */
    private final Runnable pageLoadMissed = () -> {
        Log.e(TAG, "Page non rechargée après une chute du moteur de rendu : activité relancée");
        if (pageLostTone == null) pageLostTone = new TonePlayer(getApplicationContext());
        pageLostTone.playGpsLost();
        if (!isFinishing() && !isDestroyed()) recreate();
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propres à l'application, déclarés avant le démarrage du pont.
        registerPlugin(MemoryFolderPlugin.class);
        registerPlugin(BeeperPlugin.class);
        registerPlugin(MotionPlugin.class);
        registerPlugin(DownloadsPlugin.class);
        registerPlugin(RecordingNotificationPlugin.class);
        registerPlugin(ScreenPlugin.class);
        registerPlugin(HeartRatePlugin.class);
        registerPlugin(PermissionsPlugin.class);
        registerPlugin(GnssPlugin.class);
        registerPlugin(ShareFilePlugin.class);
        registerPlugin(RecoveryPlugin.class);
        registerPlugin(IncomingFilePlugin.class);
        // Sans écouteur qui réponde vrai, Android tue tout le processus avec le moteur de rendu, service GPS compris.
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                return reloadAfterRendererGone(detail);
            }

            @Override
            public void onPageLoaded(WebView webView) {
                // Peut arriver deux fois pour une seule recharge : ne fait que retirer l'échéance, ne compte rien.
                main.removeCallbacks(pageLoadMissed);
            }
        });
        // Avant le pont, qui lit l'intention de départ : celle d'une activité restaurée est déjà traitée.
        IncomingFilePlugin.forgetReplayedFile(this, savedInstanceState);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(pageLoadMissed);
        super.onDestroy();
    }

    /** La page répond (RecoveryPlugin) : elle est revenue, même si Capacitor n'a pas dit `onPageLoaded`. */
    void pageAnswered() {
        main.removeCallbacks(pageLoadMissed);
    }

    /**
     * Recharge la page, sur la même WebView : une activité recréée arrêterait le service GPS
     * (`BackgroundGeolocation.handleOnDestroy`). La sonde du 04/11 a montré qu'elle repart, écran
     * éteint compris, et que le service et ses positions survivent. Au-delà de la garde, ou sans
     * pont : faux, Android tue le processus, et la réouverture propose de continuer. Compté ici
     * seulement, une seule fois par chute.
     */
    private boolean reloadAfterRendererGone(RenderProcessGoneDetail detail) {
        Log.e(TAG, "Moteur de rendu tombé : " + describe(detail));
        long now = SystemClock.elapsedRealtime();
        while (!RENDER_RELOADS.isEmpty() && now - RENDER_RELOADS.peekFirst() >= RENDER_RELOADS_WINDOW_MS) RENDER_RELOADS.pollFirst();
        if (RENDER_RELOADS.size() >= MAX_RENDER_RELOADS || bridge == null) {
            Log.e(TAG, "Trop de chutes rapprochées : pas de nouvelle recharge");
            return false;
        }
        RENDER_RELOADS.addLast(now);
        main.removeCallbacks(pageLoadMissed);
        main.postDelayed(pageLoadMissed, PAGE_LOAD_TIMEOUT_MS);
        bridge.reload();
        return true;
    }

    /** Android n'appelle l'écouteur qu'à partir de la version 8 : ces deux lectures n'existent pas avant. */
    private static String describe(RenderProcessGoneDetail detail) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || detail == null) return "cause inconnue";
        return "plantage=" + detail.didCrash() + ", priorité=" + detail.rendererPriorityAtExit();
    }
}
