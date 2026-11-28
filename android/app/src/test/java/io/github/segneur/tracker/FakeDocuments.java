package io.github.segneur.tracker;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import org.robolectric.Robolectric;

/**
 * Faux fournisseur de documents (accès SAF), adossé à un dossier du disque, pour éprouver sous Robolectric ce qui
 * écrit dans le dossier mémoire (MemoryWriter, ComputerLinkCommands) par les vrais appels de DocumentsContract.
 *
 * Un simple ContentProvider qui parle le langage de DocumentsContract (adresses d'un arbre, `call` pour créer,
 * renommer, déplacer et effacer, `query` et `openFile`), plutôt qu'une sous-classe de DocumentsProvider : le ContentResolver
 * de Robolectric appelle l'ancienne forme de `query`, que DocumentsProvider refuse et ne laisse pas redéfinir.
 *
 * L'identifiant d'un document est son chemin depuis la racine (« racine/sessions/a.json »), comme chez le
 * fournisseur du stockage du téléphone, mais sous une autre autorité : MemoryTree cherche alors un enfant par son
 * nom quand le chemin deviné manque, comme chez un fournisseur aux identifiants opaques. Comme le stockage du
 * téléphone, une création ou un renommage vers un nom déjà pris reçoit un nom voisin (« a (1).json »).
 */
public class FakeDocuments extends ContentProvider {

    static final String AUTHORITY = "io.github.segneur.tracker.essais.documents";
    static final String ROOT_ID = "racine";

    /** Méthodes de `call` et clé de l'adresse, telles que DocumentsContract les envoie (cachées dans son API). */
    private static final String METHOD_CREATE = "android:createDocument";
    private static final String METHOD_RENAME = "android:renameDocument";
    private static final String METHOD_DELETE = "android:deleteDocument";
    private static final String METHOD_MOVE = "android:moveDocument";
    private static final String EXTRA_URI = "uri";
    /** Dossier d'arrivée d'un déplacement (`DocumentsContract.EXTRA_TARGET_URI`). */
    private static final String EXTRA_TARGET_URI = "android.content.extra.TARGET_URI";

    private static final String[] DOCUMENT_COLUMNS = {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
        Document.COLUMN_FLAGS,
    };

    private File root;
    /** Faux : le fournisseur n'annonce pas le renommage et le refuse. */
    boolean renames = true;
    /** Vrai : le renommage est annoncé, puis refusé. */
    boolean refusesRename;
    /** Faux : le fournisseur n'annonce pas le déplacement et le refuse (le stockage du téléphone sait déplacer). */
    boolean moves = true;
    /** Vrai : le déplacement est annoncé, puis refusé. */
    boolean refusesMove;
    /** Chemin depuis la racine (« sessions/a.json ») dont l'effacement est refusé (fichier tenu), `null` sinon. */
    String undeletable;
    /** Déplacements faits par le fournisseur lui-même. */
    int moved;

    /** Le fournisseur, inscrit auprès du ContentResolver de Robolectric, sur le dossier `root`. */
    static FakeDocuments install(File root) {
        ProviderInfo info = new ProviderInfo();
        info.authority = AUTHORITY;
        FakeDocuments provider = Robolectric.buildContentProvider(FakeDocuments.class).create(info).get();
        provider.root = root;
        return provider;
    }

    /** L'arbre désigné, tel que le sélecteur d'Android le rendrait pour la racine du fournisseur. */
    static Uri tree() {
        return DocumentsContract.buildTreeDocumentUri(AUTHORITY, ROOT_ID);
    }

    // ---------- outils des essais ----------

    /** Le fichier du disque au chemin donné depuis la racine (« sessions/a.json »). */
    File file(String path) {
        return new File(root, path);
    }

    /** Écrit un fichier au chemin donné, dossiers compris, sans passer par le fournisseur. */
    void put(String path, String content) throws IOException {
        File f = file(path);
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("dossier non créé : " + parent);
        Files.write(f.toPath(), content.getBytes(StandardCharsets.UTF_8));
    }

    /** Contenu du fichier au chemin donné, `null` s'il n'existe pas. */
    String read(String path) throws IOException {
        File f = file(path);
        return f.isFile() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : null;
    }

    /** Noms du dossier au chemin donné (la racine pour ""), triés. */
    String[] names(String path) {
        String[] names = file(path).list();
        if (names == null) return new String[0];
        Arrays.sort(names);
        return names;
    }

    // ---------- documents ----------

    private File fileOf(String id) throws FileNotFoundException {
        if (ROOT_ID.equals(id)) return root;
        if (!id.startsWith(ROOT_ID + "/")) throw new FileNotFoundException("Document inconnu : " + id);
        // Un identifiant ne remonte jamais au-dessus de la racine, comme chez un vrai fournisseur.
        for (String part : id.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new FileNotFoundException("Document inconnu : " + id);
        File f = new File(root, id.substring(ROOT_ID.length() + 1));
        if (!f.exists()) throw new FileNotFoundException("Document absent : " + id);
        return f;
    }

    private String idOf(File f) {
        String relative = root.toPath().relativize(f.toPath()).toString().replace(File.separatorChar, '/');
        return relative.isEmpty() ? ROOT_ID : ROOT_ID + "/" + relative;
    }

    /** Le document d'une adresse d'arbre, qui doit être sous l'arbre désigné, comme DocumentsProvider l'exige. */
    private static String documentOf(Uri uri) throws FileNotFoundException {
        String id = DocumentsContract.getDocumentId(uri);
        String treeId = DocumentsContract.getTreeDocumentId(uri);
        if (!id.equals(treeId) && !id.startsWith(treeId + "/")) throw new SecurityException("Document hors de l'arbre : " + id);
        return id;
    }

    private void addRow(MatrixCursor cursor, File f) {
        int flags = Document.FLAG_SUPPORTS_DELETE | (renames ? Document.FLAG_SUPPORTS_RENAME : 0) | (moves ? Document.FLAG_SUPPORTS_MOVE : 0);
        flags |= f.isDirectory() ? Document.FLAG_DIR_SUPPORTS_CREATE : Document.FLAG_SUPPORTS_WRITE;
        cursor.newRow()
            .add(Document.COLUMN_DOCUMENT_ID, idOf(f))
            .add(Document.COLUMN_DISPLAY_NAME, f.equals(root) ? ROOT_ID : f.getName())
            .add(Document.COLUMN_MIME_TYPE, f.isDirectory() ? Document.MIME_TYPE_DIR : "application/octet-stream")
            .add(Document.COLUMN_SIZE, f.isDirectory() ? null : f.length())
            .add(Document.COLUMN_LAST_MODIFIED, f.lastModified())
            .add(Document.COLUMN_FLAGS, flags);
    }

    /** Un nom libre dans `dir`, voisin de `name` s'il est pris, comme le stockage du téléphone. */
    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        for (int n = 1; f.exists(); n++) f = new File(dir, stem + " (" + n + ")" + extension);
        return f;
    }

    private void delete(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File child : children) delete(child);
        if (!f.delete()) throw new IllegalStateException("Effacement refusé : " + f);
    }

    // ---------- fournisseur ----------

    @Override
    public boolean onCreate() {
        return true;
    }

    /** Un document (`…/document/id`) ou les enfants d'un dossier (`…/document/id/children`), sur une adresse d'arbre. */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(projection != null ? projection : DOCUMENT_COLUMNS);
        try {
            File f = fileOf(documentOf(uri));
            List<String> segments = uri.getPathSegments();
            if (!"children".equals(segments.get(segments.size() - 1))) {
                addRow(cursor, f);
                return cursor;
            }
            File[] children = f.listFiles();
            if (children != null) {
                Arrays.sort(children);
                for (File child : children) addRow(cursor, child);
            }
            return cursor;
        } catch (FileNotFoundException e) {
            // Comme DocumentsProvider : un document absent donne une requête sans réponse.
            return null;
        }
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileOf(documentOf(uri));
        if (f.isDirectory()) throw new FileNotFoundException("Dossier : " + uri);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        try {
            Uri uri = extras.getParcelable(EXTRA_URI);
            File f = fileOf(documentOf(uri));
            Bundle out = new Bundle();
            switch (method) {
                case METHOD_CREATE: {
                    File created = unique(f, extras.getString(Document.COLUMN_DISPLAY_NAME));
                    boolean ok = Document.MIME_TYPE_DIR.equals(extras.getString(Document.COLUMN_MIME_TYPE)) ? created.mkdir() : created.createNewFile();
                    if (!ok) throw new IllegalStateException("Création refusée : " + created);
                    out.putParcelable(EXTRA_URI, DocumentsContract.buildDocumentUriUsingTree(uri, idOf(created)));
                    return out;
                }
                case METHOD_RENAME: {
                    if (!renames || refusesRename) throw new UnsupportedOperationException("Renommage refusé");
                    File after = unique(f.getParentFile(), extras.getString(Document.COLUMN_DISPLAY_NAME));
                    if (!f.renameTo(after)) throw new IllegalStateException("Renommage refusé : " + after);
                    out.putParcelable(EXTRA_URI, DocumentsContract.buildDocumentUriUsingTree(uri, idOf(after)));
                    return out;
                }
                case METHOD_DELETE:
                    if (undeletable != null && f.equals(file(undeletable))) throw new IllegalStateException("Effacement refusé : " + f);
                    delete(f);
                    return out;
                case METHOD_MOVE: {
                    if (!moves || refusesMove) throw new UnsupportedOperationException("Déplacement refusé");
                    File dir = fileOf(documentOf(extras.getParcelable(EXTRA_TARGET_URI)));
                    File after = new File(dir, f.getName());
                    // Comme le stockage du téléphone : jamais par-dessus un document qui existe.
                    if (after.exists()) throw new IllegalStateException("Déjà pris : " + after);
                    if (!f.renameTo(after)) throw new IllegalStateException("Déplacement refusé : " + after);
                    moved++;
                    out.putParcelable(EXTRA_URI, DocumentsContract.buildDocumentUriUsingTree(uri, idOf(after)));
                    return out;
                }
                default:
                    throw new UnsupportedOperationException("Méthode inconnue : " + method);
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
