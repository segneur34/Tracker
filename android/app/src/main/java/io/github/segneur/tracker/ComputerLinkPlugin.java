package io.github.segneur.tracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import io.github.segneur.tracker.ComputerLinkProtocol.Endpoint;
import io.github.segneur.tracker.ComputerLinkProtocol.Frame;
import io.github.segneur.tracker.ComputerLinkProtocol.FrameDecoder;
import io.github.segneur.tracker.ComputerLinkProtocol.FrameException;
import io.github.segneur.tracker.ComputerLinkProtocol.Incoming;
import io.github.segneur.tracker.ComputerLinkProtocol.ProbeAnswer;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509ExtendedTrustManager;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Liaison sans fil avec le programme Windows (format : ComputerLinkProtocol, et les en-têtes de bureau/trames.ts,
 * appairage.ts et sonde.ts). Le PC écoute, le téléphone se connecte, puis répond aux commandes du PC (`lister`,
 * `lire`, `ping`, et, la capacité « ecriture » annoncée, `listerTout`, `ecrire`, `valider`, `deplacer`,
 * `listerCorbeille`) dans le dossier mémoire désigné ; les réponses aux commandes et l'écriture en cours sont dans
 * ComputerLinkCommands, une par liaison.
 *
 * - Écriture : l'appairage vaut accord, comme le câble ; rien n'est écrit ni déplacé pendant un enregistrement, le
 *   compteur du fractionné ou une séance à la ceinture seule (ForegroundWork, `erreur` PERMISSION), ni hors de la
 *   liste blanche (`ComputerLinkProtocol.writeAllowed`, sous le sous-dossier `base`). Un fichier arrive bloc par bloc
 *   dans son provisoire (`.tracker-new`, ou `.tracker-tmp` s'il remplace un fichier), flux tenu ouvert pour la
 *   liaison, une écriture à la fois ; `valider` relit la taille puis le met en place (MemoryWriter). Bloc hors
 *   d'ordre, taille fausse ou liaison coupée : provisoire effacé, original intact.
 * - Aucune commande n'efface un fichier de l'utilisateur : ce que l'ordinateur retire va dans la corbeille du
 *   téléphone (`deplacer`), que la page tient seule.
 * - `lister` et `listerTout` terminent d'abord les échanges interrompus, comme la lecture du dossier par
 *   l'application (`MemoryWriter.settle`) : un remplacement interrompu ne fait jamais croire un fichier supprimé.
 *
 * - Réseaux : tout réseau local du téléphone à adresse IPv4 privée, sans condition sur le réseau actif : le Wi-Fi
 *   (point d'accès du PC compris) comme le point d'accès du téléphone, quand il partage sa connexion et que le PC
 *   en est client. Jamais le réseau mobile, un tunnel ou un VPN, jamais une adresse publique.
 * - Découverte : l'adresse donnée par la page si elle en donne une ; sinon la dernière adresse connue (1 s), si
 *   elle est sur un réseau local présent, puis une question en diffusion UDP sur chaque réseau local (3 s).
 *   Une seule question, un seul format : la réponse porte la trace de l'identifiant du PC liée à la question
 *   (`ComputerLinkProtocol.probeId`), vérifiée ici, jamais l'identifiant en clair. Jusqu'à 4 PC sont retenus et
 *   essayés à tour de rôle : un appareil qui répond à la place du PC ne le cache pas. Sans réponse, la page montre le
 *   champ « Adresse ».
 * - TLS à empreinte fixée : aucune chaîne de confiance ; à l'appairage, l'empreinte reçue est l'identité du PC dans
 *   l'échange SPAKE2 ; ensuite, tout certificat d'une autre empreinte est refusé avant le moindre message.
 * - Appairage par le code affiché sur le PC, échange SPAKE2 (bureau/spake2.ts) mené par la page, qui seule voit le
 *   code et fait le calcul ; ce greffon transporte, en quatre étapes qui portent chacune la génération de la
 *   recherche qui les a ouvertes : `pairSearch` (découverte), `pairOffer` (liaison TLS, `appairer` avec la part du
 *   téléphone, `defi` avec celle du PC), `pairConfirm` (`preuve` avec la confirmation du téléphone, `appaire` avec
 *   celle du PC), puis `pairFinish`. Entre deux étapes, la liaison et ce que le PC a rendu attendent dans `pending`,
 *   sous une échéance de 20 s ; rien n'est écrit avant l'ordre de garder (`pairFinish` avec `keep`), que la page ne
 *   donne qu'après avoir vérifié la confirmation du PC. Jeton, empreinte, identifiant et nom du PC, dernière
 *   adresse : dans les préférences privées de ce greffon (exclues de toute sauvegarde), jamais rendus à la page (le
 *   jeton ne traverse jamais le pont). Un seul PC connu.
 * - Tout le réseau tourne hors du fil principal : un fil pour les tentatives, un fil par liaison pour les commandes,
 *   un fil pour les fermetures. Aucun service, aucune tâche de fond : la liaison se ferme quand l'application n'est
 *   plus à l'écran, et la page la rouvre au retour.
 *
 * Pour la page : `status()`, `connect({ address?, folder?, base? })`, `forget()`, et les étapes de l'appairage
 * `pairSearch({ address? })`, `pairOffer({ generation, endpoint, partA })`, `pairConfirm({ generation, cA })`,
 * `pairFinish({ generation, keep, folder?, base?, error?, notFound? })`, qui rendent toutes l'état
 * (`statusObject`), les étapes avec leurs champs en plus (`stepResult`) ; et l'événement `status`, du même contenu
 * que l'état, à chaque changement et à chaque demande du PC (au plus une fois par seconde). `folder` est l'adresse
 * SAF du dossier désigné, `base` le sous-dossier où est la mémoire (« Tracker »), absent ou vide quand c'est le
 * dossier désigné lui-même. Octets en hexadécimal minuscule.
 */
@CapacitorPlugin(
    name = "ComputerLink",
    permissions = { @Permission(alias = ComputerLinkPlugin.LOCAL_NETWORK, strings = { ComputerLinkPlugin.ACCESS_LOCAL_NETWORK }) }
)
public class ComputerLinkPlugin extends Plugin {

    private static final String TAG = "TrackerLiaison";

    static final String LOCAL_NETWORK = "localNetwork";
    /**
     * Accès au réseau local : Android 17 (API 37) ne l'impose qu'aux applications qui visent 37 ou plus, et sa
     * documentation demande de ne pas le déclarer avant. Demandé seulement quand le téléphone et la cible de
     * l'application atteignent 37 ; le manifeste ne le déclare qu'à ce passage.
     */
    static final String ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK";
    private static final int LOCAL_NETWORK_SDK = 37;

    static final String EVENT_STATUS = "status";

    /** Préférences privées du greffon : rien d'autre ne les lit. */
    static final String PREFS = "tracker.ordinateur";
    private static final String KEY_TOKEN = "jeton";
    private static final String KEY_FINGERPRINT = "empreinte";
    private static final String KEY_COMPUTER_ID = "identifiant";
    private static final String KEY_COMPUTER_NAME = "nom";
    private static final String KEY_ADDRESS = "adresse";
    private static final String KEY_LAST_SENT = "dernierEnvoi";

    /** États rendus à la page. */
    static final String STATE_UNPAIRED = "unpaired";
    static final String STATE_IDLE = "idle";
    static final String STATE_SEARCHING = "searching";
    static final String STATE_PAIRING = "pairing";
    static final String STATE_LINKED = "linked";
    static final String STATE_NOT_FOUND = "notFound";

    /** Raison du dernier échec, rendue à la page qui la dit en clair. */
    /** Aucun réseau local (Wi-Fi ou point d'accès du téléphone), ou adresse sur aucun d'eux. */
    static final String ERROR_NO_LOCAL_NETWORK = "noLocalNetwork";
    static final String ERROR_LOCAL_NETWORK = "localNetwork";
    static final String ERROR_CODE = "code";
    static final String ERROR_WINDOW = "window";
    static final String ERROR_NONCE = "nonce";
    static final String ERROR_TOKEN = "token";
    static final String ERROR_VERSION = "version";
    static final String ERROR_CERTIFICATE = "certificate";
    static final String ERROR_PROOF = "proof";
    static final String ERROR_NETWORK = "network";
    static final String ERROR_PROTOCOL = "protocol";

    /**
     * Échec d'une étape de l'appairage pour un PC candidat, en plus des raisons ci-dessus : liaison impossible avec
     * lui. La page passe alors au candidat suivant, et ne la montre jamais telle quelle.
     */
    static final String FAILURE_UNREACHABLE = "unreachable";
    /** Raisons que la page peut poser en fermant un appairage (`pairFinish`) ; toute autre se lit « network ». */
    private static final List<String> FINISH_ERRORS = Arrays.asList(
        ERROR_CODE, ERROR_WINDOW, ERROR_NONCE, ERROR_VERSION, ERROR_PROOF, ERROR_NETWORK, ERROR_PROTOCOL
    );

    /** Codes de refus d'un appel mal formé. */
    static final String REJECT_BAD_ADDRESS = "BAD_ADDRESS";
    static final String REJECT_BAD_BASE = "BAD_BASE";

    /** Attente de la dernière adresse connue : si le PC y est, il répond en quelques millisecondes. */
    private static final int LAST_ADDRESS_TIMEOUT_MS = 1_000;
    /** Durée de la découverte ; la question part deux fois, à 1 s d'écart, contre un paquet perdu. */
    private static final int DISCOVERY_MS = 3_000;
    private static final int DISCOVERY_RESEND_MS = 1_000;
    /** Écoute de chaque socket de la découverte à chaque tour. */
    private static final int DISCOVERY_POLL_MS = 50;
    /**
     * Écoute prolongée après la première réponse retenue : les autres PC (ou le vrai, si un autre appareil a répondu
     * plus vite) répondent dans le même instant.
     */
    private static final int DISCOVERY_GRACE_MS = 300;
    /**
     * Échéance d'un appairage, depuis la recherche : découverte, liaison et réponses des candidats comprises. À son
     * terme, la tentative est fermée quoi qu'il arrive, sans rien garder.
     */
    private static final int PAIR_DEADLINE_MS = 20_000;
    /** Connexion TCP à une adresse trouvée ou saisie. */
    private static final int CONNECT_TIMEOUT_MS = 3_000;
    /** Poignée de main TLS et chaque réponse attendue pendant l'accueil. */
    private static final int HANDSHAKE_TIMEOUT_MS = 10_000;
    /** Silence du PC au-delà duquel la liaison est tenue pour morte : il envoie `ping` bien plus souvent. */
    private static final int IDLE_TIMEOUT_MS = 120_000;
    private static final int READ_BUFFER = 16_384;
    /**
     * Écart minimal entre deux annonces d'une demande du PC à la page : une synchronisation envoie des dizaines de
     * demandes par seconde, la page n'a besoin que de savoir qu'un échange dure (elle garde l'écran allumé).
     */
    private static final long EXCHANGE_NOTIFY_MS = 1_000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService closer = Executors.newSingleThreadExecutor();
    /** Échéance des appairages. */
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final SecureRandom random = new SecureRandom();

    // Sous le verrou de l'instance.
    private String state;
    private String error;
    private Connection link;
    private int sentFiles;
    /** Heure de la dernière demande du PC (hors `ping`), 0 si aucune depuis l'ouverture de l'application. */
    private long lastExchangeMs;
    /** Heure de la dernière annonce d'une demande à la page. */
    private long exchangeNotifiedMs;
    /** Augmente à chaque fermeture voulue (arrière-plan, oubli, nouvel appairage) : une tentative plus ancienne s'arrête. */
    private int generation;
    /** Sockets de la tentative en cours, fermées par une fermeture voulue pour la débloquer. */
    private final Set<Closeable> attemptSockets = new LinkedHashSet<>();
    /** Appairage en cours entre deux étapes de la page, `null` sinon. */
    private PendingPair pending;

    // ---------- méthodes de la page ----------

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    /**
     * Première étape de l'appairage : ferme toute liaison et tentative, ouvre une génération et son échéance, puis
     * cherche le PC (l'adresse donnée, sinon la découverte). Rend l'état, `generation`, et `candidates` : les adresses
     * « a.b.c.d:port » des PC trouvés, dans l'ordre où les essayer (4 au plus). Sans candidat, l'appairage est déjà
     * fermé (état `notFound`).
     */
    @PluginMethod
    public void pairSearch(PluginCall call) {
        if (!addressValid(call)) return;
        if (needsLocalNetworkPermission()) {
            requestPermissionForAlias(LOCAL_NETWORK, call, "pairSearchAfterPermission");
            return;
        }
        startPairSearch(call);
    }

    @PermissionCallback
    private void pairSearchAfterPermission(PluginCall call) {
        if (needsLocalNetworkPermission()) {
            refusedLocalNetwork(call);
            return;
        }
        startPairSearch(call);
    }

    /**
     * Deuxième étape, pour un candidat : liaison TLS sans empreinte fixée, `appairer` avec la part du téléphone
     * (`partA`, 65 octets), puis `defi`. Rend l'état et `failure` (nul si l'étape a abouti) ; abouti, `fingerprint`
     * (empreinte du certificat, identité du PC dans l'échange) et `partB` (part du PC, nulle chez un PC resté à
     * l'ancien échange). Le candidat précédent est fermé d'abord.
     */
    @PluginMethod
    public void pairOffer(PluginCall call) {
        final int gen = call.getInt("generation", -1);
        final String endpoint = call.getString("endpoint", "");
        final byte[] partA = ComputerLinkProtocol.fromHex(call.getString("partA"), ComputerLinkProtocol.PART_SIZE);
        worker.execute(() -> call.resolve(guardedStep(gen, () -> offerNow(gen, endpoint, partA))));
    }

    /**
     * Troisième étape : `preuve` avec la confirmation du téléphone (`cA`, 32 octets), puis `appaire`. Rend l'état et
     * `failure` ; abouti, `cB` (confirmation du PC, que la page vérifie). Jeton, identifiant et nom restent ici.
     */
    @PluginMethod
    public void pairConfirm(PluginCall call) {
        final int gen = call.getInt("generation", -1);
        final byte[] cA = ComputerLinkProtocol.fromHex(call.getString("cA"), ComputerLinkProtocol.CONFIRMATION_SIZE);
        worker.execute(() -> call.resolve(guardedStep(gen, () -> confirmNow(gen, cA))));
    }

    /**
     * Dernière étape. `keep` vrai (la page a vérifié la confirmation du PC) : garde le PC confirmé et reste relié,
     * avec le dossier `folder` et `base`. Sinon, ferme l'appairage sans rien écrire, sur la raison `error` (filtrée
     * par `FINISH_ERRORS`), en état `notFound` si `notFound` est vrai. Rend l'état.
     */
    @PluginMethod
    public void pairFinish(PluginCall call) {
        if (!baseValid(call)) return;
        final int gen = call.getInt("generation", -1);
        final boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        final MemoryRoot root = rootOf(call);
        final String failure = FINISH_ERRORS.contains(call.getString("error", "")) ? call.getString("error") : ERROR_NETWORK;
        final boolean notFound = Boolean.TRUE.equals(call.getBoolean("notFound", false));
        worker.execute(() -> {
            try {
                if (keep) keepPairing(gen, root);
                else endPairing(gen, notFound ? STATE_NOT_FOUND : null, failure);
            } catch (RuntimeException e) {
                Log.w(TAG, "appairage : fin interrompue", e);
                endPairing(gen, null, ERROR_NETWORK);
            }
            call.resolve(statusObject());
        });
    }

    /** Relie le téléphone au PC appairé ; sans effet s'il l'est déjà. Rend l'état une fois la tentative finie. */
    @PluginMethod
    public void connect(PluginCall call) {
        if (!addressValid(call) || !baseValid(call)) return;
        if (needsLocalNetworkPermission()) {
            requestPermissionForAlias(LOCAL_NETWORK, call, "connectAfterPermission");
            return;
        }
        startConnect(call);
    }

    @PermissionCallback
    private void connectAfterPermission(PluginCall call) {
        if (needsLocalNetworkPermission()) {
            refusedLocalNetwork(call);
            return;
        }
        startConnect(call);
    }

    /** Ferme la liaison et oublie le PC : jeton, empreinte, adresse. */
    @PluginMethod
    public void forget(PluginCall call) {
        synchronized (this) {
            stopAll();
            prefs().edit().clear().commit();
            sentFiles = 0;
            state = STATE_UNPAIRED;
            error = null;
        }
        notifyStatus();
        call.resolve(statusObject());
    }

    // ---------- cycle de vie ----------

    /** L'application n'est plus à l'écran : liaison et tentative fermées, sans service pour les garder. */
    @Override
    protected void handleOnStop() {
        boolean changed;
        synchronized (this) {
            changed = link != null || pending != null || !attemptSockets.isEmpty() || STATE_SEARCHING.equals(state) || STATE_PAIRING.equals(state);
            stopAll();
            if (changed) {
                state = restState();
                error = null;
            }
        }
        if (changed) notifyStatus();
        super.handleOnStop();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (this) {
            stopAll();
        }
        worker.shutdownNow();
        timer.shutdownNow();
        closer.shutdown();
        super.handleOnDestroy();
    }

    /** Ferme liaison, tentative et appairage en cours ; appelé sous le verrou. */
    private void stopAll() {
        generation++;
        dropPending();
        if (link != null) {
            link.closed = true;
            closeLater(link.socket);
            link = null;
        }
        for (Closeable s : attemptSockets) closeLater(s);
        attemptSockets.clear();
    }

    // ---------- tentatives ----------

    private void startPairSearch(PluginCall call) {
        final String address = blankToNull(call.getString("address"));
        final int gen;
        synchronized (this) {
            stopAll();
            gen = generation;
            PendingPair p = new PendingPair(gen, SystemClock.elapsedRealtime() + PAIR_DEADLINE_MS);
            try {
                p.expiry = timer.schedule(() -> expirePairing(gen), PAIR_DEADLINE_MS, TimeUnit.MILLISECONDS);
                pending = p;
            } catch (RuntimeException e) {
                // Greffon en train de s'arrêter : aucun appairage sans échéance.
                Log.w(TAG, "échéance de l'appairage impossible", e);
            }
        }
        worker.execute(() -> call.resolve(searchNow(gen, address)));
    }

    private void startConnect(PluginCall call) {
        final String address = blankToNull(call.getString("address"));
        final MemoryRoot root = rootOf(call);
        final int gen;
        final boolean pairing;
        synchronized (this) {
            gen = generation;
            pairing = pending != null;
        }
        // Un appairage en cours garde la main : aucune liaison ne s'ouvre à côté de la sienne.
        if (pairing) {
            call.resolve(statusObject());
            return;
        }
        worker.execute(() -> call.resolve(guarded(gen, () -> connectNow(gen, address, root))));
    }

    /** Le dossier mémoire donné par l'appel ; `null` sans `folder`. `base` a passé `baseValid`. */
    private static MemoryRoot rootOf(PluginCall call) {
        String folder = blankToNull(call.getString("folder"));
        if (folder == null) return null;
        String base = call.getString("base");
        return new MemoryRoot(folder, base == null || base.isEmpty() ? null : base);
    }

    private interface Attempt {
        void run() throws IOException;
    }

    /** Une tentative, dont aucune erreur imprévue ne laisse l'appel sans réponse ni l'état en recherche. */
    private JSObject guarded(int gen, Attempt attempt) {
        try {
            attempt.run();
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "tentative interrompue", e);
            finish(gen, null, ERROR_NETWORK);
        }
        return statusObject();
    }

    // ---------- appairage ----------

    /**
     * Un appairage entre deux étapes de la page : sa génération, son échéance, les candidats trouvés, puis le
     * candidat en cours (liaison TLS, qui porte l'empreinte vue, et adresse) et, après `appaire`, ce que le PC a rendu
     * (jeton, identifiant, nom), gardé ici jusqu'à l'ordre de garder. Sous le verrou de l'instance.
     */
    private static final class PendingPair {
        final int generation;
        /** Échéance, en `SystemClock.elapsedRealtime`. */
        final long deadline;
        ScheduledFuture<?> expiry;
        List<Found> candidates = new ArrayList<>();
        Connection connection;
        Found target;
        /** Le `defi` du candidat en cours portait la part du PC : une confirmation, une seule, peut partir. */
        boolean offered;
        byte[] token;
        byte[] computerId;
        String computerName;

        PendingPair(int generation, long deadline) {
            this.generation = generation;
            this.deadline = deadline;
        }

        /** Le candidat de cette adresse, trouvé par la recherche ; `null` pour toute autre adresse. */
        Found candidate(String endpoint) {
            for (Found f : candidates) if (f.endpoint.toString().equals(endpoint)) return f;
            return null;
        }
    }

    private interface Step {
        JSObject run() throws IOException;
    }

    /** Une étape, dont aucune erreur imprévue ne laisse l'appel sans réponse ni la liaison du candidat ouverte. */
    private JSObject guardedStep(int gen, Step step) {
        try {
            return step.run();
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "appairage : étape interrompue", e);
            synchronized (this) {
                PendingPair p = livePending(gen);
                if (p != null) dropCandidate(p);
            }
            return stepResult(ERROR_NETWORK);
        }
    }

    /** L'état, avec `failure` : nul si l'étape a abouti, sinon sa raison. */
    private JSObject stepResult(String failure) {
        JSObject ret = statusObject();
        ret.put("failure", failure == null ? JSONObject.NULL : failure);
        return ret;
    }

    /** L'appairage de cette génération, s'il vaut encore ; sous le verrou. */
    private PendingPair livePending(int gen) {
        return pending != null && pending.generation == gen && gen == generation ? pending : null;
    }

    /** Ferme la liaison du candidat en cours et oublie ce qu'il a rendu ; sous le verrou. */
    private void dropCandidate(PendingPair p) {
        if (p.connection != null) {
            attemptSockets.remove(p.connection.socket);
            p.connection.close(this);
        }
        p.connection = null;
        p.target = null;
        p.offered = false;
        p.token = null;
        p.computerId = null;
        p.computerName = null;
    }

    /** Ferme l'appairage en cours sans rien garder : liaison, échéance, ce que le PC a rendu ; sous le verrou. */
    private void dropPending() {
        if (pending == null) return;
        if (pending.expiry != null) pending.expiry.cancel(false);
        dropCandidate(pending);
        pending = null;
    }

    /** Fin d'un appairage sans rien garder : `next` nul rend l'état de repos. Sans effet après une fermeture voulue. */
    private void endPairing(int gen, String next, String failure) {
        synchronized (this) {
            if (gen != generation) return;
            dropPending();
            state = next != null ? next : restState();
            error = failure;
        }
        notifyStatus();
    }

    /** Échéance passée : tout est fermé, étape en cours comprise (sa lecture échoue), et rien n'est gardé. */
    private void expirePairing(int gen) {
        synchronized (this) {
            if (livePending(gen) == null) return;
            Log.w(TAG, "appairage : échéance passée");
            stopAll();
            state = restState();
            error = ERROR_NETWORK;
        }
        notifyStatus();
    }

    /** La recherche : l'état, `generation` et `candidates` ; sans candidat, l'appairage est fermé ici. */
    private JSObject searchNow(int gen, String address) {
        JSONArray shown = new JSONArray();
        try {
            List<Found> found = searchCandidates(gen, address);
            if (found != null) {
                boolean kept;
                synchronized (this) {
                    PendingPair p = livePending(gen);
                    kept = p != null;
                    if (kept) {
                        p.candidates = found;
                        for (Found f : found) shown.put(f.endpoint.toString());
                    }
                }
                if (!kept) endPairing(gen, null, ERROR_NETWORK);
            }
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "appairage : recherche interrompue", e);
            endPairing(gen, null, ERROR_NETWORK);
        }
        JSObject ret = statusObject();
        ret.put("generation", gen);
        ret.put("candidates", shown);
        return ret;
    }

    /** Les PC candidats ; `null` après avoir fermé l'appairage sur sa raison (aucun réseau local, aucun PC trouvé). */
    private List<Found> searchCandidates(int gen, String address) throws IOException {
        List<LocalLink> links = localLinks();
        if (links.isEmpty()) {
            endPairing(gen, STATE_NOT_FOUND, ERROR_NO_LOCAL_NETWORK);
            return null;
        }
        if (!enter(gen, STATE_SEARCHING)) return null;
        if (address != null) {
            Found typed = onLocalLink(links, ComputerLinkProtocol.parseEndpoint(address));
            if (typed == null) {
                endPairing(gen, STATE_NOT_FOUND, ERROR_NO_LOCAL_NETWORK);
                return null;
            }
            List<Found> one = new ArrayList<>();
            one.add(typed);
            return one;
        }
        List<Found> found = discover(gen, links, null);
        if (found.isEmpty()) {
            endPairing(gen, STATE_NOT_FOUND, null);
            return null;
        }
        return found;
    }

    /** `appairer` puis `defi` avec un candidat de la recherche (`pairOffer`). */
    private JSObject offerNow(int gen, String endpoint, byte[] partA) throws IOException {
        Found target;
        synchronized (this) {
            PendingPair p = livePending(gen);
            if (p == null) return stepResult(ERROR_NETWORK);
            dropCandidate(p);
            target = p.candidate(endpoint);
        }
        if (target == null || partA == null) return stepResult(ERROR_PROTOCOL);
        if (!enter(gen, STATE_PAIRING)) return stepResult(ERROR_NETWORK);
        Connection c;
        try {
            c = openTls(gen, target, null, connectTimeout(gen));
        } catch (IOException e) {
            Log.w(TAG, "PC injoignable pour l'appairage à " + target.endpoint, e);
            return stepResult(FAILURE_UNREACHABLE);
        }
        if (!holdCandidate(gen, c, target)) {
            c.close(this);
            return stepResult(ERROR_NETWORK);
        }
        try {
            byte[] nonceTelephone = randomBytes(ComputerLinkProtocol.NONCE_SIZE);
            c.send(ComputerLinkProtocol.encodePair(ComputerLinkProtocol.deviceName(Build.MODEL), nonceTelephone, partA));
            Incoming defi = nextBeforeDeadline(gen, c);
            String refusal = pairRefusal(defi);
            if (refusal != null) return dropped(gen, c, refusal);
            if (defi == null || !"defi".equals(defi.type)) throw new FrameException(ComputerLinkProtocol.UNKNOWN_MESSAGE, "Défi attendu.");
            JSObject ret = stepResult(null);
            ret.put("fingerprint", ComputerLinkProtocol.toHex(c.fingerprint));
            if (defi.partB == null) {
                // PC resté à l'ancien échange : aucune confirmation ne partira vers lui, la page s'arrête sur « version ».
                dropped(gen, c, null);
                ret.put("partB", JSONObject.NULL);
                return ret;
            }
            synchronized (this) {
                PendingPair p = livePending(gen);
                if (p == null || p.connection != c) return stepResult(ERROR_NETWORK);
                p.offered = true;
            }
            ret.put("partB", ComputerLinkProtocol.toHex(defi.partB));
            return ret;
        } catch (FrameException e) {
            Log.w(TAG, "appairage : message illisible", e);
            return dropped(gen, c, ERROR_PROTOCOL);
        } catch (IOException e) {
            Log.w(TAG, "appairage : liaison coupée", e);
            return dropped(gen, c, ERROR_NETWORK);
        }
    }

    /** `preuve` puis `appaire` avec le candidat en cours (`pairConfirm`). Ce que le PC rend attend dans `pending`. */
    private JSObject confirmNow(int gen, byte[] cA) throws IOException {
        Connection c;
        synchronized (this) {
            PendingPair p = livePending(gen);
            if (p == null || p.connection == null) return stepResult(ERROR_NETWORK);
            // Sans part du PC reçue, ou confirmation déjà partie, ou mal formée : rien ne part.
            if (!p.offered || cA == null) {
                dropCandidate(p);
                return stepResult(ERROR_PROTOCOL);
            }
            // Une seule confirmation par candidat.
            p.offered = false;
            c = p.connection;
        }
        try {
            c.send(ComputerLinkProtocol.encodeProof(cA));
            Incoming answer = nextBeforeDeadline(gen, c);
            String refusal = pairRefusal(answer);
            if (refusal != null) return dropped(gen, c, refusal);
            if (answer == null || !"appaire".equals(answer.type)) throw new FrameException(ComputerLinkProtocol.UNKNOWN_MESSAGE, "Réponse d'appairage attendue.");
            synchronized (this) {
                PendingPair p = livePending(gen);
                if (p == null || p.connection != c) return stepResult(ERROR_NETWORK);
                p.token = answer.token;
                p.computerId = answer.computerId;
                p.computerName = answer.computerName;
            }
            // Le nom du PC n'est montré qu'une fois gardé, par l'état : ici, il n'est pas encore confirmé.
            JSObject ret = stepResult(null);
            ret.put("cB", ComputerLinkProtocol.toHex(answer.proof));
            return ret;
        } catch (FrameException e) {
            Log.w(TAG, "appairage : message illisible", e);
            return dropped(gen, c, ERROR_PROTOCOL);
        } catch (IOException e) {
            Log.w(TAG, "appairage : liaison coupée", e);
            return dropped(gen, c, ERROR_NETWORK);
        }
    }

    /**
     * Garde le PC confirmé (`pairFinish` avec `keep`) : préférences écrites d'un bloc, puis la liaison sert. Sans PC
     * confirmé à garder, l'appairage se ferme sans rien écrire.
     */
    private void keepPairing(int gen, MemoryRoot root) {
        Connection c = null;
        synchronized (this) {
            PendingPair p = livePending(gen);
            // Fermé entre-temps (échéance, arrière-plan, oubli) : l'état le dit déjà.
            if (p == null) return;
            if (p.connection != null && p.token != null) {
                c = p.connection;
                prefs().edit()
                    .clear()
                    .putString(KEY_TOKEN, ComputerLinkProtocol.toHex(p.token))
                    .putString(KEY_FINGERPRINT, ComputerLinkProtocol.toHex(c.fingerprint))
                    .putString(KEY_COMPUTER_ID, ComputerLinkProtocol.toHex(p.computerId))
                    .putString(KEY_COMPUTER_NAME, p.computerName)
                    .putString(KEY_ADDRESS, p.target.endpoint.toString())
                    .commit();
                // La liaison passe à `link` : ni l'appairage ni la tentative ne la ferment plus.
                attemptSockets.remove(c.socket);
                p.connection = null;
            }
            dropPending();
        }
        if (c == null) {
            endPairing(gen, null, ERROR_NETWORK);
            return;
        }
        if (!startServing(gen, c, root)) c.close(this);
    }

    /** Pose la liaison ouverte comme candidat en cours ; faux si l'appairage a été fermé entre-temps. */
    private boolean holdCandidate(int gen, Connection c, Found target) {
        synchronized (this) {
            PendingPair p = livePending(gen);
            if (p == null) return false;
            dropCandidate(p);
            p.connection = c;
            p.target = target;
            attemptSockets.add(c.socket);
            return true;
        }
    }

    /** Ferme la liaison d'un candidat (refus, message illisible, coupure) et rend l'échec de l'étape. */
    private JSObject dropped(int gen, Connection c, String failure) {
        synchronized (this) {
            PendingPair p = livePending(gen);
            if (p != null && p.connection == c) dropCandidate(p);
            attemptSockets.remove(c.socket);
        }
        c.close(this);
        return failure == null ? null : stepResult(failure);
    }

    /** Délai de connexion d'un candidat, borné par l'échéance de l'appairage. */
    private int connectTimeout(int gen) {
        long left;
        synchronized (this) {
            PendingPair p = livePending(gen);
            left = p == null ? 0 : p.deadline - SystemClock.elapsedRealtime();
        }
        return (int) Math.max(1, Math.min(CONNECT_TIMEOUT_MS, left));
    }

    /**
     * Message suivant du candidat, attente bornée par l'échéance de l'appairage, recalculée à chaque message ; la
     * tâche de l'échéance ferme de toute façon la liaison à son terme.
     */
    private Incoming nextBeforeDeadline(int gen, Connection c) throws IOException {
        long left;
        synchronized (this) {
            PendingPair p = livePending(gen);
            if (p == null) throw new IOException("Appairage fermé.");
            left = p.deadline - SystemClock.elapsedRealtime();
        }
        if (left <= 0) throw new SocketTimeoutException("Échéance de l'appairage passée.");
        c.socket.setSoTimeout((int) Math.min(HANDSHAKE_TIMEOUT_MS, left));
        return c.next();
    }

    /**
     * La raison d'un refus du PC pendant l'appairage, `null` si le message n'en est pas un. Aucun jeton n'est envoyé
     * pendant un appairage : un refus du jeton vient d'un hôte qui n'a rien prouvé, il échoue comme une confirmation
     * fausse et ne touche à rien de gardé.
     */
    private static String pairRefusal(Incoming m) {
        if (m == null || !"refus".equals(m.type)) return null;
        switch (m.reason) {
            case ComputerLinkProtocol.REFUSED_CODE:
                return ERROR_CODE;
            case ComputerLinkProtocol.REFUSED_WINDOW:
                return ERROR_WINDOW;
            case ComputerLinkProtocol.REFUSED_NONCE:
                return ERROR_NONCE;
            case ComputerLinkProtocol.REFUSED_TOKEN:
                return ERROR_PROOF;
            default:
                return ERROR_VERSION;
        }
    }

    private void connectNow(int gen, String address, MemoryRoot root) throws IOException {
        synchronized (this) {
            if (link != null) {
                if (root != null) link.root = root;
                return;
            }
        }
        SharedPreferences p = prefs();
        byte[] token = ComputerLinkProtocol.fromHex(p.getString(KEY_TOKEN, null), ComputerLinkProtocol.TOKEN_SIZE);
        byte[] pin = ComputerLinkProtocol.fromHex(p.getString(KEY_FINGERPRINT, null), ComputerLinkProtocol.FINGERPRINT_SIZE);
        byte[] computerId = ComputerLinkProtocol.fromHex(p.getString(KEY_COMPUTER_ID, null), ComputerLinkProtocol.COMPUTER_ID_SIZE);
        if (token == null || pin == null || computerId == null) {
            finish(gen, STATE_UNPAIRED, null);
            return;
        }
        List<LocalLink> links = localLinks();
        if (links.isEmpty()) {
            finish(gen, STATE_NOT_FOUND, ERROR_NO_LOCAL_NETWORK);
            return;
        }
        if (!enter(gen, STATE_SEARCHING)) return;
        Connection c = null;
        if (address != null) {
            Found typed = onLocalLink(links, ComputerLinkProtocol.parseEndpoint(address));
            if (typed == null) {
                finish(gen, STATE_NOT_FOUND, ERROR_NO_LOCAL_NETWORK);
                return;
            }
            c = openOrReport(gen, typed, pin, CONNECT_TIMEOUT_MS);
            if (c == null) return;
        } else {
            // La dernière adresse n'est essayée que si elle est sur un réseau local présent : jamais par le réseau mobile.
            Found last = onLocalLink(links, ComputerLinkProtocol.parseEndpoint(p.getString(KEY_ADDRESS, null)));
            if (last != null) {
                try {
                    c = openTls(gen, last, pin, LAST_ADDRESS_TIMEOUT_MS);
                } catch (IOException e) {
                    // Le PC a changé d'adresse, ou un autre appareil l'a prise : on le cherche.
                    c = null;
                }
            }
            if (c == null) {
                if (!alive(gen)) return;
                List<Found> found = discover(gen, links, computerId);
                if (found.isEmpty()) {
                    finish(gen, STATE_NOT_FOUND, null);
                    return;
                }
                c = openFirst(gen, found, pin);
                if (c == null) return;
            }
        }
        boolean kept = false;
        try {
            c.send(ComputerLinkProtocol.encodeHello(ComputerLinkProtocol.deviceName(Build.MODEL), token));
            Incoming answer = c.next();
            // Liaison épinglée sur l'empreinte gardée : un refus du jeton vient bien du PC appairé.
            if (refused(gen, answer, true)) return;
            if (answer == null || !"bienvenue".equals(answer.type)) throw new FrameException(ComputerLinkProtocol.UNKNOWN_MESSAGE, "Bienvenue attendue.");
            synchronized (this) {
                if (gen != generation) return;
                prefs().edit()
                    .putString(KEY_COMPUTER_ID, ComputerLinkProtocol.toHex(answer.computerId))
                    .putString(KEY_COMPUTER_NAME, answer.computerName)
                    .putString(KEY_ADDRESS, c.endpoint.toString())
                    .commit();
            }
            kept = startServing(gen, c, root);
        } catch (FrameException e) {
            Log.w(TAG, "accueil : message illisible", e);
            finish(gen, null, ERROR_PROTOCOL);
        } catch (IOException e) {
            Log.w(TAG, "accueil : liaison coupée", e);
            finish(gen, null, ERROR_NETWORK);
        } finally {
            if (!kept) c.close(this);
        }
    }

    /** Liaison TLS à une adresse ; `null` après avoir dit l'échec (certificat d'une autre empreinte, PC injoignable). */
    private Connection openOrReport(int gen, Found target, byte[] pin, int timeoutMs) {
        try {
            return openTls(gen, target, pin, timeoutMs);
        } catch (PinMismatchException e) {
            Log.w(TAG, "certificat inattendu à " + target.endpoint);
            finish(gen, null, ERROR_CERTIFICATE);
        } catch (IOException e) {
            Log.w(TAG, "PC injoignable à " + target.endpoint, e);
            finish(gen, STATE_NOT_FOUND, ERROR_NETWORK);
        }
        return null;
    }

    /**
     * Liaison au premier candidat de la découverte qui présente le certificat gardé : un certificat d'une autre
     * empreinte (un autre appareil a répondu à la place du PC) passe au suivant. `null` après avoir dit l'échec :
     * certificat si chaque candidat joint en présentait un autre, PC injoignable sinon.
     */
    private Connection openFirst(int gen, List<Found> candidates, byte[] pin) {
        boolean unreachable = false;
        for (Found target : candidates) {
            if (!alive(gen)) return null;
            try {
                return openTls(gen, target, pin, CONNECT_TIMEOUT_MS);
            } catch (PinMismatchException e) {
                Log.w(TAG, "certificat inattendu à " + target.endpoint);
            } catch (IOException e) {
                Log.w(TAG, "PC injoignable à " + target.endpoint, e);
                unreachable = true;
            }
        }
        if (unreachable) finish(gen, STATE_NOT_FOUND, ERROR_NETWORK);
        else finish(gen, null, ERROR_CERTIFICATE);
        return null;
    }

    /**
     * Vrai si le PC a refusé : la raison est dite à la page. Un jeton refusé n'est oublié que sur une
     * liaison épinglée (reconnexion, `pinnedLink` vrai) ; pendant un appairage, où l'hôte qui répond
     * n'a encore rien prouvé, ce refus n'a pas de sens et fait seulement échouer la tentative comme
     * une preuve fausse, sans toucher à l'appairage gardé.
     */
    private boolean refused(int gen, Incoming m, boolean pinnedLink) {
        if (m == null || !"refus".equals(m.type)) return false;
        switch (m.reason) {
            case ComputerLinkProtocol.REFUSED_TOKEN:
                if (ComputerLinkProtocol.refusalForgetsPairing(m.reason, pinnedLink)) {
                    synchronized (this) {
                        if (gen == generation) prefs().edit().clear().commit();
                    }
                    finish(gen, STATE_UNPAIRED, ERROR_TOKEN);
                } else {
                    finish(gen, null, ERROR_PROOF);
                }
                break;
            case ComputerLinkProtocol.REFUSED_CODE:
                finish(gen, null, ERROR_CODE);
                break;
            case ComputerLinkProtocol.REFUSED_WINDOW:
                finish(gen, null, ERROR_WINDOW);
                break;
            case ComputerLinkProtocol.REFUSED_NONCE:
                finish(gen, null, ERROR_NONCE);
                break;
            default:
                finish(gen, null, ERROR_VERSION);
                break;
        }
        return true;
    }

    /** La liaison est établie : un fil à elle répond aux commandes du PC. Faux si une fermeture voulue est passée. */
    private boolean startServing(int gen, Connection c, MemoryRoot root) {
        synchronized (this) {
            if (gen != generation) return false;
            c.root = root;
            link = c;
            sentFiles = 0;
            state = STATE_LINKED;
            error = null;
        }
        // Le PC reconnu peut désormais envoyer un corps : celui d'un bloc d'écriture.
        c.decoder.limits = ComputerLinkProtocol.COMMAND_LIMITS;
        notifyStatus();
        Thread thread = new Thread(() -> serve(c), "Tracker-liaison");
        thread.setDaemon(true);
        thread.start();
        return true;
    }

    // ---------- commandes du PC ----------

    private void serve(Connection c) {
        String failure = null;
        try {
            c.socket.setSoTimeout(IDLE_TIMEOUT_MS);
            for (;;) {
                Incoming m = c.next();
                if (m == null) break;
                c.send(c.commands.answer(m, c.root));
            }
        } catch (FrameException e) {
            Log.w(TAG, "liaison : message illisible", e);
            failure = ERROR_PROTOCOL;
        } catch (IOException | RuntimeException e) {
            if (!c.closed) Log.w(TAG, "liaison coupée", e);
            failure = ERROR_NETWORK;
        }
        // Liaison coupée en pleine écriture : provisoire effacé, original intact.
        c.commands.abandon();
        boolean wasCurrent;
        synchronized (this) {
            wasCurrent = link == c;
            if (wasCurrent) {
                link = null;
                state = restState();
                error = c.closed ? null : failure;
            }
        }
        c.close(this);
        if (wasCurrent) notifyStatus();
    }

    /**
     * Les réponses aux commandes d'une liaison (ComputerLinkCommands) : dossier mémoire par le ContentResolver de
     * l'application, état « enregistre » lu aux trois services de premier plan (ForegroundWork, la même garde que le
     * câble), et les annonces de ce greffon.
     */
    private ComputerLinkCommands newCommands() {
        return new ComputerLinkCommands(getContext().getContentResolver(), ForegroundWork::busy, this::exchanged, this::fileSent);
    }

    /** Un fichier vient de partir jusqu'à son dernier octet. */
    private void fileSent() {
        synchronized (this) {
            sentFiles++;
            prefs().edit().putLong(KEY_LAST_SENT, System.currentTimeMillis()).apply();
        }
        notifyStatus();
    }

    /**
     * Une demande du PC vient d'arriver : son heure est gardée pour l'état, et annoncée à la page au plus une fois
     * par seconde. Le `ping`, envoyé toutes les quelques secondes tant que la liaison tient, n'en est pas une : la
     * page garderait sinon l'écran allumé tant que le téléphone est relié.
     */
    private void exchanged() {
        boolean announce;
        synchronized (this) {
            long now = System.currentTimeMillis();
            lastExchangeMs = now;
            announce = now - exchangeNotifiedMs >= EXCHANGE_NOTIFY_MS || now < exchangeNotifiedMs;
            if (announce) exchangeNotifiedMs = now;
        }
        if (announce) notifyStatus();
    }

    // ---------- réseau ----------

    /**
     * Un réseau local du téléphone : une adresse IPv4 privée d'une interface qui n'est ni mobile, ni tunnel, ni VPN.
     * Le Wi-Fi où le téléphone est client (point d'accès du PC compris) porte son `Network` d'Android ; le point
     * d'accès du téléphone (partage de connexion) n'en a pas, ses routes sont dans la table locale d'Android.
     */
    private static final class LocalLink {
        final String interfaceName;
        final InetAddress address;
        final long ip;
        final int prefixLength;
        /** Réseau d'Android de l'interface, `null` pour le point d'accès du téléphone. */
        final Network network;

        LocalLink(String interfaceName, InetAddress address, long ip, int prefixLength, Network network) {
            this.interfaceName = interfaceName;
            this.address = address;
            this.ip = ip;
            this.prefixLength = prefixLength;
            this.network = network;
        }
    }

    /** Un PC à joindre et le réseau local par lequel le joindre. */
    private static final class Found {
        final Endpoint endpoint;
        final LocalLink link;

        Found(Endpoint endpoint, LocalLink link) {
            this.endpoint = endpoint;
            this.link = link;
        }
    }

    /**
     * Réseaux locaux du téléphone, sans condition sur le réseau actif : le Wi-Fi comme le point d'accès du
     * téléphone, dont le réseau actif est alors le réseau mobile. Écartés : les interfaces qu'Android range dans le
     * réseau mobile ou un VPN, celles dont le nom est celui d'une interface mobile ou d'un tunnel, les liaisons point
     * à point, et toute adresse qui n'est pas privée.
     */
    @SuppressWarnings("deprecation")
    private List<LocalLink> localLinks() {
        java.util.Map<String, Network> networks = new java.util.HashMap<>();
        Set<String> excluded = new java.util.HashSet<>();
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            try {
                for (Network n : cm.getAllNetworks()) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                    LinkProperties lp = cm.getLinkProperties(n);
                    String name = lp == null ? null : lp.getInterfaceName();
                    if (caps == null || name == null) continue;
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) excluded.add(name);
                    else networks.put(name, n);
                }
            } catch (SecurityException e) {
                Log.w(TAG, "état du réseau illisible", e);
            }
        }
        List<LocalLink> links = new ArrayList<>();
        try {
            java.util.Enumeration<NetworkInterface> all = NetworkInterface.getNetworkInterfaces();
            while (all != null && all.hasMoreElements()) {
                NetworkInterface ni = all.nextElement();
                String name = ni.getName();
                if (excluded.contains(name) || ComputerLinkProtocol.mobileInterfaceName(name)) continue;
                if (!ni.isUp() || ni.isLoopback() || ni.isPointToPoint()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (!(a instanceof Inet4Address)) continue;
                    long ip = ipv4(a.getAddress());
                    if (!ComputerLinkProtocol.privateIpv4(ip)) continue;
                    links.add(new LocalLink(name, a, ip, ia.getNetworkPrefixLength(), networks.get(name)));
                }
            }
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "interfaces réseau illisibles", e);
        }
        return links;
    }

    /** Le réseau local où se trouve l'adresse, `null` si elle n'est sur aucun : elle partirait par une autre route. */
    private static Found onLocalLink(List<LocalLink> links, Endpoint endpoint) {
        if (endpoint == null) return null;
        long ip = ComputerLinkProtocol.parseIpv4(endpoint.host);
        for (LocalLink link : links) {
            if (link.ip != ip && ComputerLinkProtocol.sameSubnet(link.ip, ip, link.prefixLength)) return new Found(endpoint, link);
        }
        return null;
    }

    /** Socket UDP ou TCP attachée à un réseau local : au `Network` d'Android s'il en a un, et à l'adresse locale. */
    private static void attach(LocalLink link, DatagramSocket socket) throws IOException {
        if (link.network != null) link.network.bindSocket(socket);
        socket.bind(new InetSocketAddress(link.address, 0));
    }

    private static void attach(LocalLink link, Socket socket) throws IOException {
        if (link.network != null) link.network.bindSocket(socket);
        socket.bind(new InetSocketAddress(link.address, 0));
    }

    private static long ipv4(byte[] b) {
        return ((b[0] & 0xffL) << 24) | ((b[1] & 0xffL) << 16) | ((b[2] & 0xffL) << 8) | (b[3] & 0xffL);
    }

    /**
     * Cherche le PC par une question diffusée sur chaque réseau local, depuis une socket attachée à ce réseau, vers
     * son adresse de diffusion (255.255.255.255 suivrait la route par défaut, le réseau mobile quand le téléphone
     * partage sa connexion) ; le Wi-Fi d'Android reçoit en plus la diffusion générale, que son `Network` attache.
     * Avec `computerId`, seul ce PC est retenu : sa réponse porte la trace de son identifiant pour le nonce de la
     * question (`ComputerLinkProtocol.answerFrom`). Rend les PC trouvés dans l'ordre où les essayer (`Candidates`), au plus
     * `CANDIDATES_MAX`, après une courte écoute de plus une fois le premier trouvé ; vide si aucun n'a répondu à
     * temps. Une réponse n'est pas une preuve : l'empreinte du certificat ou l'échange SPAKE2, ensuite, l'est.
     */
    private List<Found> discover(int gen, List<LocalLink> links, byte[] computerId) throws IOException {
        byte[] nonce = randomBytes(ComputerLinkProtocol.PROBE_NONCE_SIZE);
        byte[] question = ComputerLinkProtocol.encodeQuestion(nonce);
        ComputerLinkProtocol.Candidates<Found> found = new ComputerLinkProtocol.Candidates<>(ComputerLinkProtocol.CANDIDATES_MAX);
        List<DatagramSocket> sockets = new ArrayList<>();
        List<LocalLink> socketLinks = new ArrayList<>();
        List<List<InetAddress>> targets = new ArrayList<>();
        try {
            for (LocalLink link : links) {
                List<InetAddress> to = new ArrayList<>();
                if (link.prefixLength < 31) to.add(InetAddress.getByName(ComputerLinkProtocol.broadcastAddress(link.ip, link.prefixLength)));
                if (link.network != null) to.add(InetAddress.getByName("255.255.255.255"));
                if (to.isEmpty()) continue;
                DatagramSocket socket = new DatagramSocket((java.net.SocketAddress) null);
                if (!track(gen, socket)) return found.ordered();
                sockets.add(socket);
                try {
                    attach(link, socket);
                    socket.setBroadcast(true);
                } catch (IOException e) {
                    Log.w(TAG, "diffusion impossible sur " + link.interfaceName, e);
                    sockets.remove(socket);
                    untrack(socket);
                    socket.close();
                    continue;
                }
                socketLinks.add(link);
                targets.add(to);
            }
            if (sockets.isEmpty()) return found.ordered();
            long now = SystemClock.elapsedRealtime();
            long deadline = now + DISCOVERY_MS;
            long nextSend = now;
            int sends = 0;
            byte[] buffer = new byte[512];
            while (alive(gen)) {
                now = SystemClock.elapsedRealtime();
                if (now >= deadline || found.full()) break;
                if (sends < 2 && now >= nextSend) {
                    for (int i = 0; i < sockets.size(); i++) {
                        for (InetAddress target : targets.get(i)) {
                            try {
                                sockets.get(i).send(new DatagramPacket(question, question.length, target, ComputerLinkProtocol.PROBE_PORT));
                            } catch (IOException e) {
                                // Une adresse de diffusion refusée n'empêche pas les autres.
                            }
                        }
                    }
                    sends++;
                    nextSend = now + DISCOVERY_RESEND_MS;
                }
                // Chaque socket écoutée à tour de rôle, brièvement : les réponses attendent dans sa file.
                for (int i = 0; i < sockets.size(); i++) {
                    DatagramSocket socket = sockets.get(i);
                    socket.setSoTimeout(DISCOVERY_POLL_MS);
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(packet);
                    } catch (SocketTimeoutException e) {
                        continue;
                    }
                    ProbeAnswer answer = ComputerLinkProtocol.decodeAnswer(Arrays.copyOfRange(packet.getData(), packet.getOffset(), packet.getOffset() + packet.getLength()));
                    if (answer == null || !ComputerLinkProtocol.sameBytes(answer.nonce, nonce)) continue;
                    if (computerId != null && !ComputerLinkProtocol.answerFrom(answer, computerId, nonce)) continue;
                    if (!(packet.getAddress() instanceof Inet4Address)) continue;
                    long ip = ipv4(packet.getAddress().getAddress());
                    LocalLink link = socketLinks.get(i);
                    // Le PC doit être sur le réseau d'où vient sa réponse : jamais une adresse publique ou d'ailleurs.
                    if (!ComputerLinkProtocol.privateIpv4(ip) || !ComputerLinkProtocol.sameSubnet(ip, link.ip, link.prefixLength)) continue;
                    Endpoint endpoint = new Endpoint(ComputerLinkProtocol.formatIpv4(ip), answer.port);
                    // Une place par adresse, pas par port : l'écoute ne s'arrête tôt qu'avec 4 adresses distinctes.
                    if (found.add(endpoint.host, new Found(endpoint, link))) {
                        deadline = Math.min(deadline, SystemClock.elapsedRealtime() + DISCOVERY_GRACE_MS);
                    }
                }
            }
            return found.ordered();
        } finally {
            for (DatagramSocket socket : sockets) {
                untrack(socket);
                socket.close();
            }
        }
    }

    /** Le certificat présenté n'a pas l'empreinte gardée. */
    private static final class PinMismatchException extends SSLException {
        PinMismatchException() {
            super("Empreinte du certificat inattendue");
        }
    }

    /**
     * Liaison TLS par le réseau local où est le PC, socket attachée à ce réseau : elle ne part jamais par le réseau
     * mobile. Avec `pin`, le certificat doit avoir cette empreinte ; sans, il est admis et son empreinte retenue :
     * c'est l'identité du PC dans l'échange d'appairage, puis l'empreinte gardée s'il est gardé.
     */
    private Connection openTls(int gen, Found found, byte[] pin, int connectTimeoutMs) throws IOException {
        Endpoint target = found.endpoint;
        PinningTrustManager trust = new PinningTrustManager(pin);
        Socket plain = new Socket();
        if (!track(gen, plain)) throw new IOException("Liaison fermée.");
        try {
            attach(found.link, plain);
            plain.connect(new InetSocketAddress(InetAddress.getByName(target.host), target.port), connectTimeoutMs);
            plain.setSoTimeout(HANDSHAKE_TIMEOUT_MS);
            plain.setTcpNoDelay(true);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[] { trust }, random);
            SSLSocket ssl = (SSLSocket) context.getSocketFactory().createSocket(plain, target.host, target.port, true);
            ssl.setUseClientMode(true);
            ssl.setEnabledProtocols(modernProtocols(ssl.getSupportedProtocols()));
            ssl.setEnabledCipherSuites(ComputerLinkProtocol.authenticatedSuites(ssl.getEnabledCipherSuites()));
            // Une fermeture voulue ferme la socket TCP dessous, ce qui débloque la poignée de main.
            ssl.startHandshake();
            byte[] fingerprint = trust.seen;
            if (fingerprint == null) throw new SSLException("Aucun certificat présenté.");
            if (!alive(gen)) throw new IOException("Liaison fermée.");
            untrack(plain);
            return new Connection(ssl, target, fingerprint, newCommands());
        } catch (GeneralSecurityException e) {
            untrack(plain);
            closeQuietly(plain);
            throw new IOException(e);
        } catch (IOException e) {
            untrack(plain);
            closeQuietly(plain);
            if (trust.mismatch) throw new PinMismatchException();
            throw e;
        }
    }

    /** TLS 1.3 et 1.2 seulement, parmi ceux que le téléphone sait parler. */
    private static String[] modernProtocols(String[] supported) {
        List<String> kept = new ArrayList<>();
        for (String p : supported) if ("TLSv1.3".equals(p) || "TLSv1.2".equals(p)) kept.add(p);
        return kept.toArray(new String[0]);
    }

    /** Confiance réduite à une empreinte : aucune autorité, aucun nom, seul le certificat attendu passe. */
    private static final class PinningTrustManager extends X509ExtendedTrustManager {
        private final byte[] pin;
        volatile byte[] seen;
        volatile boolean mismatch;

        PinningTrustManager(byte[] pin) {
            this.pin = pin;
        }

        private void check(X509Certificate[] chain) throws CertificateException {
            if (chain == null || chain.length == 0) throw new CertificateException("Aucun certificat présenté.");
            byte[] fingerprint = ComputerLinkProtocol.sha256(chain[0].getEncoded());
            if (pin != null && !ComputerLinkProtocol.sameBytes(pin, fingerprint)) {
                mismatch = true;
                throw new CertificateException("Empreinte du certificat inattendue.");
            }
            seen = fingerprint;
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            check(chain);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            check(chain);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            check(chain);
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("Le téléphone n'accepte aucune connexion.");
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, Socket socket) throws CertificateException {
            throw new CertificateException("Le téléphone n'accepte aucune connexion.");
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType, SSLEngine engine) throws CertificateException {
            throw new CertificateException("Le téléphone n'accepte aucune connexion.");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    /**
     * Le dossier mémoire que lit la liaison, posé d'un bloc : l'arbre désigné (adresse SAF) et le sous-dossier où est
     * la mémoire, `null` quand c'est l'arbre lui-même.
     */
    static final class MemoryRoot {
        final String folder;
        final String base;

        MemoryRoot(String folder, String base) {
            this.folder = folder;
            this.base = base;
        }
    }

    /**
     * Une liaison TLS avec le PC : flux, décodeur aux limites de l'accueil, élargi au corps d'un bloc d'écriture une
     * fois relié (`COMMAND_LIMITS`), et les réponses aux commandes avec l'écriture en cours, que seul le fil de la
     * liaison touche.
     */
    private static final class Connection {
        final SSLSocket socket;
        final Endpoint endpoint;
        final byte[] fingerprint;
        final InputStream in;
        final OutputStream out;
        final FrameDecoder decoder = new FrameDecoder(ComputerLinkProtocol.WELCOME_LIMITS);
        final ArrayDeque<Frame> frames = new ArrayDeque<>();
        final byte[] buffer = new byte[READ_BUFFER];
        /** Dossier mémoire lu pour les commandes ; donné par la page. */
        volatile MemoryRoot root;
        /** Vrai une fois fermée exprès : l'erreur de lecture qui suit n'en est pas une. */
        volatile boolean closed;
        /** Réponses aux commandes du PC, et l'écriture en cours. */
        final ComputerLinkCommands commands;

        Connection(SSLSocket socket, Endpoint endpoint, byte[] fingerprint, ComputerLinkCommands commands) throws IOException {
            this.socket = socket;
            this.endpoint = endpoint;
            this.fingerprint = fingerprint;
            this.commands = commands;
            this.in = socket.getInputStream();
            this.out = new BufferedOutputStream(socket.getOutputStream(), 65_536);
        }

        /** Message suivant du PC ; `null` si le PC a fermé la liaison entre deux trames. */
        Incoming next() throws IOException {
            while (frames.isEmpty()) {
                int n = in.read(buffer);
                if (n < 0) {
                    decoder.end();
                    return null;
                }
                frames.addAll(decoder.push(buffer, 0, n));
            }
            return ComputerLinkProtocol.readMessage(frames.poll());
        }

        void send(byte[] bytes) throws IOException {
            out.write(bytes);
            out.flush();
        }

        void close(ComputerLinkPlugin owner) {
            closed = true;
            owner.closeLater(socket);
        }
    }

    // ---------- état ----------

    /** Note une socket de la tentative en cours ; faux si une fermeture voulue est passée depuis son début. */
    private synchronized boolean track(int gen, Closeable socket) {
        if (gen != generation) {
            closeLater(socket);
            return false;
        }
        attemptSockets.add(socket);
        return true;
    }

    private synchronized void untrack(Closeable socket) {
        attemptSockets.remove(socket);
    }

    private synchronized boolean alive(int gen) {
        return gen == generation;
    }

    /** Passe à un état de la tentative, si elle vaut encore. */
    private boolean enter(int gen, String next) {
        synchronized (this) {
            if (gen != generation) return false;
            state = next;
            error = null;
        }
        notifyStatus();
        return true;
    }

    /** Fin d'une tentative : `next` nul rend l'état de repos (appairé ou non). Sans effet après une fermeture voulue. */
    private void finish(int gen, String next, String failure) {
        synchronized (this) {
            if (gen != generation) return;
            state = next != null ? next : restState();
            error = failure;
        }
        notifyStatus();
    }

    private void refusedLocalNetwork(PluginCall call) {
        synchronized (this) {
            state = restState();
            error = ERROR_LOCAL_NETWORK;
        }
        notifyStatus();
        call.resolve(statusObject());
    }

    private String restState() {
        return prefs().contains(KEY_TOKEN) ? STATE_IDLE : STATE_UNPAIRED;
    }

    /**
     * L'état pour la page : `state`, `error` (raison du dernier échec ou null), `paired`, `computerName`, `address`
     * (« a.b.c.d:port », dernière adresse connue), `lastSentMs` (dernier fichier envoyé jusqu'au bout, ou null),
     * `sentFiles` (fichiers envoyés pendant la liaison en cours), `onLocalNetwork` (un réseau local est là : Wi-Fi ou
     * point d'accès du téléphone), `lastExchangeMs` (dernière demande du PC hors `ping`, ou null). Jamais le jeton
     * ni l'empreinte.
     */
    private JSObject statusObject() {
        SharedPreferences p = prefs();
        JSObject ret = new JSObject();
        synchronized (this) {
            boolean paired = p.contains(KEY_TOKEN);
            String shown = state == null || ((STATE_IDLE.equals(state) || STATE_UNPAIRED.equals(state))) ? (paired ? STATE_IDLE : STATE_UNPAIRED) : state;
            ret.put("state", shown);
            ret.put("error", error == null ? JSONObject.NULL : error);
            ret.put("paired", paired);
            ret.put("sentFiles", sentFiles);
            ret.put("computerName", orNull(paired ? p.getString(KEY_COMPUTER_NAME, null) : null));
            ret.put("address", orNull(paired ? p.getString(KEY_ADDRESS, null) : null));
            ret.put("lastSentMs", paired && p.contains(KEY_LAST_SENT) ? (Object) p.getLong(KEY_LAST_SENT, 0) : JSONObject.NULL);
            ret.put("lastExchangeMs", lastExchangeMs > 0 ? (Object) lastExchangeMs : JSONObject.NULL);
        }
        ret.put("onLocalNetwork", !localLinks().isEmpty());
        return ret;
    }

    private void notifyStatus() {
        JSObject data = statusObject();
        try {
            notifyListeners(EVENT_STATUS, data);
        } catch (RuntimeException e) {
            // Pont fermé avec l'activité : la page relira l'état à son retour.
        }
    }

    // ---------- outils ----------

    private boolean needsLocalNetworkPermission() {
        return Build.VERSION.SDK_INT >= LOCAL_NETWORK_SDK
            && getContext().getApplicationInfo().targetSdkVersion >= LOCAL_NETWORK_SDK
            && getPermissionState(LOCAL_NETWORK) != PermissionState.GRANTED;
    }

    /** Refuse l'appel si l'adresse donnée n'est pas une adresse privée du réseau local. */
    private boolean addressValid(PluginCall call) {
        String address = blankToNull(call.getString("address"));
        if (address != null && ComputerLinkProtocol.parseEndpoint(address) == null) {
            call.reject("Adresse refusée : une adresse du réseau local est attendue (192.168.x.x, 10.x.x.x ou 172.16 à 31.x.x).", REJECT_BAD_ADDRESS);
            return false;
        }
        return true;
    }

    /** Refuse l'appel si le sous-dossier donné sortirait du dossier désigné (`ComputerLinkProtocol.baseAllowed`). */
    private boolean baseValid(PluginCall call) {
        if (!ComputerLinkProtocol.baseAllowed(call.getString("base"))) {
            call.reject("Sous-dossier du dossier mémoire refusé : un nom de dossier relatif est attendu.", REJECT_BAD_BASE);
            return false;
        }
        return true;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        random.nextBytes(bytes);
        return bytes;
    }

    private void closeLater(Closeable socket) {
        try {
            closer.execute(() -> closeQuietly(socket));
        } catch (RuntimeException e) {
            // Fil des fermetures arrêté avec l'activité : fermée ici.
            closeQuietly(socket);
        }
    }

    private static void closeQuietly(Closeable c) {
        try {
            c.close();
        } catch (IOException | RuntimeException e) {
            // Déjà fermée.
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.trim().isEmpty() ? null : s.trim();
    }

    private static Object orNull(String s) {
        return s == null ? JSONObject.NULL : s;
    }
}
