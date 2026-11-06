package io.github.segneur.tracker;

import android.app.Activity;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/**
 * « Ouvrir avec Tracker » et « Partager vers Tracker » d'un GPX ou d'un FIT (lot 35,
 * src/platform/incomingFile.ts, seul pont vers ce greffon) : une file privée des fichiers reçus,
 * sous `filesDir/recus/`, que la page vide quand elle le peut.
 *
 * Le droit de lire le fichier d'une autre application meurt avec l'activité : la copie part tout de
 * suite, même pendant un enregistrement, avant que la page n'ait rien décidé. Elle tourne sur un fil à
 * elle : ni le fil de l'interface (un fournisseur de fichiers peut être lent), ni celui des greffons de
 * Capacitor, partagé avec ceux de l'enregistrement. Rien d'autre ne se passe : aucune attente sur
 * l'enregistrement, aucune recréation d'activité (`singleTask`, la même activité reçoit l'intention).
 *
 * Points d'entrée (Capacitor 8.6, gardés par nativeConstants.test.ts) : `BridgeActivity.load()` passe
 * lui-même l'intention de départ à `onNewIntent`, donc `handleOnNewIntent` voit à la fois celle d'une
 * application fermée et celles d'une application déjà ouverte ; `load()` n'a pas à la lire aussi.
 *
 * Une intention lue est vidée (`setIntent`), ce qui la retire d'un `recreate()`. Après la mort du
 * processus, Android rend à l'activité restaurée son intention d'origine : `forgetReplayedFile` l'écarte,
 * sinon une ouverture normale recopierait un fichier déjà traité.
 *
 * Un fichier reçu porte tout dans son nom : `<id>__<état>__<nom d'origine>`, l'état étant `ok` ou le motif
 * du refus (fichier vide, gardé jusqu'à ce que la page l'ait dit). Une copie en cours porte `<id>.tmp`,
 * effacée au lancement suivant : un fichier listé est toujours entier.
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {

    private static final String TAG = "TrackerRecu";
    /** Plafond d'un fichier reçu, le même qu'au listage de la mémoire (`MAX_LISTED_FILE_BYTES`, nativeConstants.test.ts). */
    private static final long MAX_BYTES = 30L * 1024 * 1024;
    /** Début du fichier où chercher sa signature. */
    private static final int HEAD_BYTES = 8192;
    private static final int NAME_CHARS = 60;
    private static final String DIR = "recus";
    private static final String TMP_SUFFIX = ".tmp";
    private static final String SEPARATOR = "__";
    private static final String STATE_OK = "ok";
    private static final String REFUSED_FORMAT = "format";
    private static final String REFUSED_TOO_LARGE = "trop-gros";
    private static final String REFUSED_UNREADABLE = "illisible";
    private static final String EVENT_RECEIVED = "received";

    /** Statique : une activité recréée reprend la même file, et une copie en cours finit avant la lecture de la nouvelle page. */
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final AtomicLong SEQUENCE = new AtomicLong();

    /** Une tâche qui lève ferait tomber tout le processus, service GPS compris : elle est dite, sans plus. */
    private static void runOnWorker(Runnable task) {
        WORKER.execute(() -> {
            try {
                task.run();
            } catch (Exception | OutOfMemoryError e) {
                Log.e(TAG, "Tâche de la file interrompue", e);
            }
        });
    }

    @Override
    public void load() {
        Context context = getContext().getApplicationContext();
        runOnWorker(() -> deleteLeftovers(context));
    }

    /**
     * Activité restaurée (processus tué, ou retour par les applications récentes) : son intention
     * d'origine a déjà été traitée. À appeler avant le démarrage du pont, qui la lira. Une ouverture normale
     * n'est pas touchée.
     */
    static void forgetReplayedFile(Activity activity, Bundle savedInstanceState) {
        Intent intent = activity.getIntent();
        if (!isFileIntent(intent)) return;
        boolean fromHistory = (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (savedInstanceState != null || fromHistory) activity.setIntent(blankIntent(activity));
    }

    private static Intent blankIntent(Context context) {
        return Intent.makeMainActivity(new ComponentName(context, MainActivity.class));
    }

    private static boolean isFileIntent(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        return Intent.ACTION_VIEW.equals(action) || Intent.ACTION_SEND.equals(action);
    }

    /**
     * Adresse du fichier ; `null` si l'intention n'en porte aucune qu'on puisse lire. Seul `content://` :
     * le manifeste n'accepte que lui, mais une intention nommant l'activité passe outre, et un `file://` ferait lire à
     * Tracker ses propres fichiers privés au profit d'une autre application.
     */
    private static Uri fileOf(Intent intent) {
        Uri uri = null;
        try {
            uri = addressIn(intent);
        } catch (RuntimeException e) {
            // Intention mal formée, venue d'une autre application : un refus, pas une chute.
            Log.w(TAG, "Intention illisible", e);
        }
        return uri != null && ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()) ? uri : null;
    }

    @SuppressWarnings("deprecation")
    private static Uri addressIn(Intent intent) {
        return Intent.ACTION_SEND.equals(intent.getAction()) ? intent.getParcelableExtra(Intent.EXTRA_STREAM) : intent.getData();
    }

    /** Aucun fichier dans l'intention (partage de texte) : rien à rouvrir. Une intention mal formée, elle, en portait peut-être un. */
    private static boolean carriesNoFile(Intent intent) {
        try {
            return addressIn(intent) == null;
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isFileIntent(intent)) return;
        Uri uri = fileOf(intent);
        String refusalWithoutFile = carriesNoFile(intent) ? REFUSED_FORMAT : REFUSED_UNREADABLE;
        Activity activity = getActivity();
        if (activity != null && activity.getIntent() == intent) activity.setIntent(blankIntent(activity));
        Context context = getContext().getApplicationContext();
        runOnWorker(() -> {
            receive(context, uri, refusalWithoutFile);
            notifyListeners(EVENT_RECEIVED, new JSObject());
        });
    }

    private static File directory(Context context) {
        return new File(context.getFilesDir(), DIR);
    }

    /** Un refus peut finir par « .tmp » (nom d'origine) : lui porte le séparateur. */
    private static boolean isTemporary(String fileName) {
        return fileName.endsWith(TMP_SUFFIX) && !fileName.contains(SEPARATOR);
    }

    private static void deleteLeftovers(Context context) {
        File[] files = directory(context).listFiles();
        if (files == null) return;
        for (File file : files) {
            if (isTemporary(file.getName()) && !file.delete()) Log.w(TAG, "Copie interrompue non effacée : " + file.getName());
        }
    }

    /** Lit jusqu'à remplir `buffer` ou finir le fichier : un seul `read` peut rendre moins. */
    private static int fill(InputStream in, byte[] buffer) throws IOException {
        int total = 0;
        int n;
        while (total < buffer.length && (n = in.read(buffer, total, buffer.length - total)) > 0) total += n;
        return total;
    }

    /**
     * Extension d'après la signature : un motif de nom ne filtre pas un `content://`, et le nom donné par
     * l'application d'origine ne dit rien de sûr. `null` : ni GPX ni FIT.
     */
    private static String extensionOf(byte[] head, int length) {
        if (length >= 12 && head[8] == '.' && head[9] == 'F' && head[10] == 'I' && head[11] == 'T') return ".fit";
        return new String(head, 0, length, StandardCharsets.ISO_8859_1).contains("<gpx") ? ".gpx" : null;
    }

    /** Copie le fichier dans la file, ou y pose son refus (`refusalWithoutFile` sans adresse lisible). Jamais de copie gardée d'un fichier refusé. */
    private static void receive(Context context, Uri uri, String refusalWithoutFile) {
        File dir = directory(context);
        String id = System.currentTimeMillis() + "-" + SEQUENCE.incrementAndGet();
        String name = uri == null ? "fichier" : displayName(context.getContentResolver(), uri);
        if (!dir.isDirectory() && !dir.mkdirs()) Log.w(TAG, "Dossier des fichiers reçus non créé");
        if (uri == null) {
            markRefused(context, id, name, refusalWithoutFile);
            return;
        }
        File tmp = new File(dir, id + TMP_SUFFIX);
        String refusal = null;
        String extension = null;
        try (InputStream in = context.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new FileNotFoundException("aucun flux");
            byte[] head = new byte[HEAD_BYTES];
            int got = fill(in, head);
            extension = extensionOf(head, got);
            if (extension == null) {
                refusal = REFUSED_FORMAT;
            } else {
                out.write(head, 0, got);
                long total = got;
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) {
                        refusal = REFUSED_TOO_LARGE;
                        break;
                    }
                    out.write(buffer, 0, n);
                }
            }
        } catch (IOException | RuntimeException e) {
            // Droit de lecture perdu, fichier retiré, stockage plein : refusé, et l'original reste où il est.
            Log.w(TAG, "Copie impossible", e);
            refusal = REFUSED_UNREADABLE;
        }
        if (refusal == null && !tmp.renameTo(new File(dir, entryName(id, STATE_OK, withoutExtension(name) + extension)))) {
            refusal = REFUSED_UNREADABLE;
        }
        if (refusal != null) {
            if (tmp.exists() && !tmp.delete()) Log.w(TAG, "Copie refusée non effacée : " + tmp.getName());
            markRefused(context, id, name, refusal);
        }
    }

    /** Le refus attend que la page le dise, même après un arrêt. Stockage trop plein pour lui : dit tout de suite. */
    private static void markRefused(Context context, String id, String name, String refusal) {
        File marker = new File(directory(context), entryName(id, refusal, name));
        try {
            if (marker.createNewFile()) return;
        } catch (IOException | RuntimeException e) {
            Log.e(TAG, "Refus non gardé : " + refusal, e);
        }
        new Handler(Looper.getMainLooper()).post(() ->
            Toast.makeText(context, "Tracker n'a pas pu recevoir ce fichier.", Toast.LENGTH_LONG).show());
    }

    private static String entryName(String id, String state, String name) {
        return id + SEPARATOR + state + SEPARATOR + name;
    }

    /** Nom donné par l'application d'origine, à défaut la fin de l'adresse ; rendu sûr pour un nom de fichier, et court. */
    private static String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
        } catch (RuntimeException e) {
            Log.w(TAG, "Nom du fichier illisible", e);
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null) name = "";
        name = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).replaceAll("[\\p{Cntrl}:*?\"<>|]", "_").trim();
        if (name.length() > NAME_CHARS) {
            // Le début et l'extension : c'est ce que l'utilisateur reconnaît.
            int dot = name.lastIndexOf('.');
            String extension = dot > 0 && name.length() - dot <= 5 ? name.substring(dot) : "";
            name = name.substring(0, NAME_CHARS - extension.length()) + extension;
        }
        return name.isEmpty() ? "fichier" : name;
    }

    /** L'extension vient de la signature, pas du nom d'origine (« document:123 », « trace.xml »). */
    private static String withoutExtension(String name) {
        String base = name.replaceFirst("(?i)\\.(gpx|fit|xml|bin)$", "");
        return base.isEmpty() ? "fichier" : base;
    }

    /** Fichiers reçus, du plus ancien au plus récent, après toute copie demandée avant cet appel. */
    @PluginMethod
    public void list(PluginCall call) {
        Context context = getContext().getApplicationContext();
        runOnWorker(() -> {
            try {
                JSArray entries = new JSArray();
                File[] files = directory(context).listFiles();
                if (files != null) {
                    Arrays.sort(files);
                    for (File file : files) {
                        String[] parts = file.getName().split(SEPARATOR, 3);
                        if (parts.length < 3) continue;
                        JSObject entry = new JSObject();
                        entry.put("id", file.getName());
                        entry.put("name", parts[2]);
                        entry.put("size", file.length());
                        entry.put("refusal", STATE_OK.equals(parts[1]) ? JSONObject.NULL : parts[1]);
                        entries.put(entry);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("files", entries);
                call.resolve(ret);
            } catch (Exception | OutOfMemoryError e) {
                call.reject("Liste des fichiers reçus illisible", e instanceof Exception ? (Exception) e : null);
            }
        });
    }

    /** Fichier de la file désigné par la page ; `null` s'il n'y a pas de tel fichier ni d'autre chemin qu'un nom. */
    private File entryFile(PluginCall call) {
        String id = call.getString("id", "");
        if (id == null || id.isEmpty() || id.contains("/") || id.contains("\\") || id.equals("..")) return null;
        return new File(directory(getContext().getApplicationContext()), id);
    }

    /**
     * Contenu d'un fichier reçu, en base64 ; `data` nul s'il n'existe plus. Borné par le plafond de la copie.
     * Manquer de mémoire n'est pas une `Exception` : ce rejet-là garde la copie pour un autre essai.
     */
    @PluginMethod
    public void read(PluginCall call) {
        File file = entryFile(call);
        runOnWorker(() -> {
            try {
                JSObject ret = new JSObject();
                if (file == null || !file.isFile()) {
                    ret.put("data", JSONObject.NULL);
                } else {
                    try (InputStream in = new FileInputStream(file)) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(file.length(), MAX_BYTES));
                        byte[] buffer = new byte[65536];
                        int n;
                        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                        ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                    }
                }
                call.resolve(ret);
            } catch (Exception | OutOfMemoryError e) {
                Log.w(TAG, "Fichier reçu illisible", e);
                call.reject("Fichier reçu illisible");
            }
        });
    }

    /** Retire un fichier de la file, une fois son verdict rendu. Déjà absent : rien à faire. Toujours une réponse : la page l'attend. */
    @PluginMethod
    public void remove(PluginCall call) {
        File file = entryFile(call);
        runOnWorker(() -> {
            try {
                if (file == null || !file.exists() || file.delete()) call.resolve();
                else call.reject("Fichier reçu non retiré");
            } catch (RuntimeException e) {
                Log.w(TAG, "Fichier reçu non retiré", e);
                call.reject("Fichier reçu non retiré");
            }
        });
    }
}
