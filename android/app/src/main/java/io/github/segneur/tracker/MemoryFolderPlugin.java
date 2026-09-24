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
import java.io.OutputStream;
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
 */
@CapacitorPlugin(name = "MemoryFolder")
public class MemoryFolderPlugin extends Plugin {

    /** Type des fichiers créés : Android n'ajoute alors aucune extension au nom demandé. */
    private static final String FILE_MIME = "application/octet-stream";

    private static final String[] CHILD_COLUMNS = {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
    };

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
                call.reject("Android a refusé de garder l'accès au dossier : " + e.getMessage());
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
                granted = exists(tree, DocumentsContract.getTreeDocumentId(tree));
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
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
                try (Cursor c = resolver().query(children, CHILD_COLUMNS, null, null, null)) {
                    while (c != null && c.moveToNext()) {
                        boolean isDir = Document.MIME_TYPE_DIR.equals(c.getString(2));
                        JSObject entry = new JSObject();
                        entry.put("name", c.getString(1));
                        entry.put("kind", isDir ? "directory" : "file");
                        entry.put("size", isDir || c.isNull(3) ? 0 : c.getLong(3));
                        entry.put("mtimeMs", c.isNull(4) ? 0 : c.getLong(4));
                        entries.put(entry);
                    }
                }
            }
        } catch (Exception e) {
            call.reject("Lecture du dossier impossible : " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        JSObject ret = new JSObject();
        try {
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
        } catch (Exception e) {
            call.reject("Lecture impossible : " + e.getMessage());
            return;
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        String path = call.getString("path", "");
        String text = call.getString("text", "");
        try {
            int slash = path.lastIndexOf('/');
            String parentPath = slash < 0 ? "" : path.substring(0, slash);
            String name = path.substring(slash + 1);
            String parentId = resolve(tree, parentPath, true);
            String id = findChild(tree, parentId, name);
            Uri target;
            if (id != null) {
                target = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            } else {
                target = DocumentsContract.createDocument(
                    resolver(),
                    DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
                    FILE_MIME,
                    name
                );
                if (target == null) throw new Exception("création refusée pour " + path);
            }
            // « wt » : le fichier est tronqué avant l'écriture, sans quoi une fiche plus
            // courte que la précédente en garderait la fin.
            try (OutputStream out = resolver().openOutputStream(target, "wt")) {
                if (out == null) throw new Exception("écriture refusée pour " + path);
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            call.reject("Écriture impossible : " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        Uri tree = treeOf(call);
        if (tree == null) return;
        try {
            String id = resolve(tree, call.getString("path", ""), false);
            if (id != null) DocumentsContract.deleteDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
        } catch (Exception e) {
            call.reject("Suppression impossible : " + e.getMessage());
            return;
        }
        call.resolve();
    }

    // --- Chemins ---

    private ContentResolver resolver() {
        return getContext().getContentResolver();
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
        String id = DocumentsContract.getTreeDocumentId(tree);
        for (String part : path.split("/")) {
            if (part.isEmpty()) continue;
            String child = findChild(tree, id, part);
            if (child == null) {
                if (!create) return null;
                Uri created = DocumentsContract.createDocument(
                    resolver(),
                    DocumentsContract.buildDocumentUriUsingTree(tree, id),
                    Document.MIME_TYPE_DIR,
                    part
                );
                if (created == null) throw new Exception("création du dossier " + part + " refusée");
                child = DocumentsContract.getDocumentId(created);
            }
            id = child;
        }
        return id;
    }

    /**
     * Enfant d'un dossier, par son nom. Sur le stockage du téléphone,
     * l'identifiant d'un document est son chemin (« primary:Documents/Tracker/sessions ») :
     * on le construit et on vérifie qu'il existe, une requête au lieu de lire
     * tout le dossier. Pour un autre fournisseur, repli sur la recherche par nom.
     */
    private String findChild(Uri tree, String parentId, String name) {
        String guess = parentId.endsWith(":") ? parentId + name : parentId + "/" + name;
        try {
            if (name.equals(displayName(tree, guess))) return guess;
        } catch (Exception e) {
            // Document absent, ou fournisseur aux identifiants opaques : recherche par nom.
        }
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        try (Cursor c = resolver().query(children, CHILD_COLUMNS, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return c.getString(0);
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    private String displayName(Uri tree, String id) {
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        try (Cursor c = resolver().query(uri, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getString(0) : null;
        }
    }

    private boolean exists(Uri tree, String id) {
        try {
            return displayName(tree, id) != null;
        } catch (Exception e) {
            return false;
        }
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
