package io.github.segneur.tracker;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Dossier mémoire sur le téléphone (docs/ETAT_DU_PROJET.md, §6 et §12).
 *
 * L'utilisateur désigne une fois le dossier par le sélecteur d'Android ;
 * l'application garde ensuite l'autorisation, y compris pour les fichiers
 * qu'elle n'a pas écrits elle-même (copiés depuis le PC, ou écrits avant une
 * réinstallation), sans demander l'accès à tous les fichiers.
 *
 * Les chemins sont relatifs au dossier choisi (« sessions/x.json »). Chaque
 * méthode reçoit l'adresse du dossier : le plugin ne retient rien, c'est la
 * couche web (src/platform/memoryFolder.ts) qui la garde. Les méthodes
 * tournent sur le fil des plugins de Capacitor, jamais sur celui de
 * l'interface.
 *
 * Un fichier existant n'est jamais réécrit sur place : le nouveau contenu va
 * d'abord à côté (« nom.tracker-tmp »), puis prend sa place (`replace` de
 * MemoryWriter). Une coupure en plein échange est reprise à la lecture suivante
 * du dossier (`list`) : une fiche n'est jamais laissée à moitié écrite. Un
 * fichier neuf est écrit de même sous « nom.tracker-new », puis renommé
 * (`createNew`) ; un « .tracker-new » resté seul, création interrompue, est
 * effacé par `list`. Un provisoire que la liaison avec l'ordinateur tient
 * ouvert n'est ni effacé ni renommé (`MemoryWriter.settle`).
 *
 * Un fichier absent n'est pas une erreur (`text` ou `data` nul, `exists` faux).
 * Une erreur est rejetée avec un code (`rejectCoded`), qui dit à la couche web
 * ce qui s'est passé sans lire la phrase d'Android.
 */
@CapacitorPlugin(name = "MemoryFolder")
public class MemoryFolderPlugin extends Plugin {

    private static final String LOG_TAG = "MemoryFolder";

    // --- Choix du dossier ---

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Le sélecteur s'ouvre sur Documents, où le dossier Tracker est attendu.
            Uri documents = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Documents");
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, documents);
        }
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("uri", JSONObject.NULL);
            call.resolve(ret);
            return;
        }
        Uri tree = data.getData();
        // Sans `persist` (dossier lu une fois, pour un import), l'accès accordé par le
        // sélecteur suffit : Android limite le nombre d'autorisations gardées.
        if (call.getBoolean("persist", true)) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(
                    tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (SecurityException e) {
                rejectCoded(call, "Android a refusé de garder l'accès au dossier", e);
                return;
            }
        }
        ret.put("uri", tree.toString());
        ret.put("name", folderLabel(tree));
        call.resolve(ret);
    }

    /** Vrai si l'autorisation gardée vaut toujours, en lecture et en écriture, et que le dossier existe. */
    @PluginMethod
    public void hasAccess(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        boolean granted = false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) {
                granted = true;
                break;
            }
        }
        if (granted) {
            try {
                granted = memory().exists(tree, DocumentsContract.getTreeDocumentId(tree));
            } catch (Exception e) {
                granted = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    // --- Fichiers ---

    @PluginMethod
    public void list(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        JSArray entries = new JSArray();
        try {
            String dirId = resolve(tree, call.getString("path", ""), false);
            if (dirId != null) {
                for (MemoryWriter.Shown shown : writer().settle(tree, memory().children(tree, dirId))) {
                    entries.put(entryOf(shown.name, shown.child));
                }
            }
        } catch (Exception e) {
            rejectCoded(call, "Lecture du dossier impossible", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    /**
     * Contenu d'un fichier texte ; `text` nul s'il n'existe pas. La réponse part
     * dans le `try` : sa mise en texte peut, elle aussi, manquer de mémoire.
     */
    @PluginMethod
    public void readText(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        try {
            JSObject ret = new JSObject();
            String id = resolve(tree, call.getString("path", ""), false);
            if (id == null) {
                ret.put("text", JSONObject.NULL);
            } else {
                try (InputStream in = resolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    ret.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
                }
            }
            call.resolve(ret);
        } catch (Exception | OutOfMemoryError e) {
            rejectCoded(call, "Lecture impossible", e);
        }
    }

    /**
     * Contenu d'un fichier quelconque (capteurs), en base64 ; `data` nul s'il
     * n'existe pas. Le fichier tient en entier en mémoire : trop gros, c'est
     * `OutOfMemoryError`, qui n'est pas une `Exception`, et qui ne doit pas passer
     * pour un fichier absent ni faire tomber l'application. La réponse part dans le
     * `try` : sa mise en texte peut, elle aussi, manquer de mémoire.
     */
    @PluginMethod
    public void readBase64(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        try {
            JSObject ret = new JSObject();
            String id = resolve(tree, call.getString("path", ""), false);
            if (id == null) {
                ret.put("data", JSONObject.NULL);
            } else {
                try (InputStream in = resolver().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                }
            }
            call.resolve(ret);
        } catch (Exception | OutOfMemoryError e) {
            rejectCoded(call, "Lecture impossible", e);
        }
    }

    /**
     * Taille et date d'un fichier, sans le lire ; `exists` faux s'il n'existe pas
     * ou si c'est un dossier. `mtimeMs` vaut 0 si le fournisseur ne la donne pas.
     */
    @PluginMethod
    public void stat(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        JSObject ret = new JSObject();
        boolean exists = false;
        try {
            String id = resolve(tree, call.getString("path", ""), false);
            if (id != null) {
                String[] columns = { Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED };
                try (Cursor c = resolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, id), columns, null, null, null)) {
                    if (c != null && c.moveToFirst() && !Document.MIME_TYPE_DIR.equals(c.getString(0))) {
                        exists = true;
                        ret.put("size", c.isNull(1) ? 0 : c.getLong(1));
                        ret.put("mtimeMs", c.isNull(2) ? 0 : c.getLong(2));
                    }
                }
            }
        } catch (Exception e) {
            rejectCoded(call, "Lecture du fichier impossible", e);
            return;
        }
        ret.put("exists", exists);
        call.resolve(ret);
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        String text = call.getString("text", "");
        writeBytes(call, text.getBytes(StandardCharsets.UTF_8));
    }

    /** Écrit un fichier quelconque (capteurs), reçu en base64. */
    @PluginMethod
    public void writeBase64(PluginCall call) {
        byte[] data;
        try {
            data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            rejectCoded(call, "Données illisibles", e);
            return;
        }
        writeBytes(call, data);
    }

    private void writeBytes(PluginCall call, byte[] data) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        String path = call.getString("path", "");
        try {
            int slash = path.lastIndexOf('/');
            String parentPath = slash < 0 ? "" : path.substring(0, slash);
            String name = path.substring(slash + 1);
            String parentId = resolve(tree, parentPath, true);
            String id = memory().findChild(tree, parentId, name);
            MemoryWriter writer = writer();
            if (id != null) {
                writer.replace(tree, parentId, name, DocumentsContract.buildDocumentUriUsingTree(tree, id), data, path);
            } else {
                writer.createNew(tree, parentId, name, data, path);
            }
        } catch (Exception e) {
            rejectCoded(call, "Écriture impossible", e);
            return;
        }
        call.resolve();
    }

    private static JSObject entryOf(String name, MemoryTree.Child child) {
        JSObject entry = new JSObject();
        entry.put("name", name);
        entry.put("kind", child.isDir ? "directory" : "file");
        entry.put("size", child.isDir ? 0 : child.size);
        entry.put("mtimeMs", child.mtimeMs);
        return entry;
    }

    @PluginMethod
    public void remove(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        try {
            String id = resolve(tree, call.getString("path", ""), false);
            if (id != null) DocumentsContract.deleteDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
        } catch (Exception e) {
            rejectCoded(call, "Suppression impossible", e);
            return;
        }
        call.resolve();
    }

    // --- Erreurs ---

    /**
     * Rejette l'appel avec un code (`errorCode`) ; le message reste « phrase :
     * détail d'Android », et le détail complet va au journal d'Android.
     */
    private void rejectCoded(PluginCall call, String phrase, Throwable e) {
        Log.w(LOG_TAG, phrase, e);
        call.reject(phrase + " : " + e.getMessage(), MemoryTree.errorCode(e));
    }

    // --- Chemins ---

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    /** Lecture de l'arbre, commune avec la liaison à l'ordinateur. */
    private MemoryTree memory() {
        return new MemoryTree(resolver());
    }

    /** Écriture dans l'arbre, commune avec la liaison à l'ordinateur. */
    private MemoryWriter writer() {
        return new MemoryWriter(resolver());
    }

    private Uri treeOf(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("Adresse du dossier manquante.");
            return null;
        }
        return Uri.parse(uri);
    }

    /**
     * Identifiant du document au chemin donné, `null` s'il n'existe pas. Avec
     * `create`, les dossiers manquants sont créés.
     */
    private String resolve(Uri tree, String path, boolean create) throws Exception {
        return writer().resolve(tree, path, create);
    }

    /**
     * Libellé lisible du dossier choisi : « Documents/Tracker » pour
     * « primary:Documents/Tracker » ou « home:Tracker » (la racine Documents
     * du sélecteur).
     */
    private static String folderLabel(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        int colon = id.indexOf(':');
        String root = colon < 0 ? "" : id.substring(0, colon);
        String rest = colon < 0 ? id : id.substring(colon + 1);
        if (root.equals("home")) return rest.isEmpty() ? "Documents" : "Documents/" + rest;
        return rest.isEmpty() ? root : rest;
    }
}
