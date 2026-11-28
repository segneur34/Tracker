package io.github.segneur.tracker;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Lecture de l'arbre du dossier mémoire désigné par le sélecteur d'Android (accès SAF), commune au dossier mémoire
 * (MemoryFolderPlugin) et à la liaison avec l'ordinateur (ComputerLinkPlugin), qui y écrivent tous deux par
 * MemoryWriter. Rien ici n'écrit, ne renomme ni n'efface : on y trouve aussi les noms des provisoires et ce que la
 * lecture d'un dossier fait de chacun (`fate`), et les provisoires en cours d'écriture, qu'elle épargne.
 *
 * Les chemins sont relatifs au dossier choisi (« sessions/x.json »), séparés par `/`.
 */
final class MemoryTree {

    /** Suffixe du fichier écrit à côté de celui qu'il remplace, le temps de l'échange. */
    static final String TEMP_SUFFIX = ".tracker-tmp";
    /**
     * Suffixe d'un fichier neuf, le temps de l'écrire : distinct de TEMP_SUFFIX, qu'une
     * coupure fait reprendre par la lecture du dossier, alors qu'un fichier neuf interrompu est seulement effacé.
     */
    static final String NEW_SUFFIX = ".tracker-new";

    /** Fournisseur du stockage du téléphone, dont l'identifiant d'un document est son chemin. */
    private static final String EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents";

    // ---------- provisoires en cours d'écriture ----------

    /**
     * Provisoires qu'une écriture tient en ce moment (celles de la page, d'un bloc, et celles de la liaison avec
     * l'ordinateur, bloc par bloc), comptés par nom : la lecture d'un dossier ne les efface ni ne les renomme, et
     * deux écritures du même nom ne se libèrent pas l'une l'autre. Par nom seul, sans le dossier : un homonyme resté
     * d'une coupure dans un autre dossier n'est alors effacé qu'à la lecture suivante, sans autre effet.
     */
    private static final Map<String, Integer> WRITING = new HashMap<>();

    /** Note une écriture de plus sous ce nom de provisoire ; chaque appel est suivi d'un `stopWriting`. */
    static void startWriting(String provisionalName) {
        synchronized (WRITING) {
            WRITING.merge(provisionalName, 1, Integer::sum);
        }
    }

    /** Note une écriture sous ce nom, sauf si une autre le tient déjà : faux alors, et rien n'est noté. */
    static boolean tryStartWriting(String provisionalName) {
        synchronized (WRITING) {
            if (WRITING.containsKey(provisionalName)) return false;
            WRITING.put(provisionalName, 1);
            return true;
        }
    }

    /** Fin d'une écriture notée par `startWriting` ou `tryStartWriting`. */
    static void stopWriting(String provisionalName) {
        synchronized (WRITING) {
            Integer n = WRITING.get(provisionalName);
            if (n == null) return;
            if (n <= 1) WRITING.remove(provisionalName);
            else WRITING.put(provisionalName, n - 1);
        }
    }

    static boolean writing(String provisionalName) {
        synchronized (WRITING) {
            return WRITING.containsKey(provisionalName);
        }
    }

    /** Ce que la lecture d'un dossier fait de l'un de ses enfants. */
    enum Fate {
        /** Montré sous son nom. */
        SHOW,
        /** Création interrompue avant son renommage (« nom.tracker-new ») : effacé, puis refait. */
        DELETE_NEW,
        /** Remplacement interrompu, l'original intact à côté : le provisoire, peut-être incomplet, est effacé. */
        DELETE_TEMP,
        /** Remplacement interrompu après le retrait de l'original : le provisoire, complet, reprend son nom. */
        RESTORE_TEMP,
        /** Provisoire en cours d'écriture : caché, sans y toucher. */
        HIDE,
        /** Remplacement en cours dont l'original vient d'être retiré : montré sous le nom de l'original, sans y toucher. */
        SHOW_AS_ORIGINAL,
    }

    /** Vrai pour un nom de provisoire : le suffixe, précédé d'au moins un caractère. */
    private static boolean hasSuffix(String name, String suffix) {
        return name.endsWith(suffix) && name.length() > suffix.length();
    }

    /** Nom de l'original d'un « nom.tracker-tmp ». */
    static String originalOf(String tempName) {
        return tempName.substring(0, tempName.length() - TEMP_SUFFIX.length());
    }

    /**
     * Sort d'un enfant à la lecture de son dossier : `names` sont les noms présents dans le dossier (l'original d'un
     * provisoire y est-il ?), `writing` dit si le provisoire est tenu ouvert par une écriture (`writing(name)`).
     * Suffixes en casse exacte ; un dossier est toujours montré.
     */
    static Fate fate(String name, boolean isDir, Set<String> names, boolean writing) {
        if (isDir) return Fate.SHOW;
        if (hasSuffix(name, NEW_SUFFIX)) return writing ? Fate.HIDE : Fate.DELETE_NEW;
        if (hasSuffix(name, TEMP_SUFFIX)) {
            boolean original = names.contains(originalOf(name));
            if (writing) return original ? Fate.HIDE : Fate.SHOW_AS_ORIGINAL;
            return original ? Fate.DELETE_TEMP : Fate.RESTORE_TEMP;
        }
        return Fate.SHOW;
    }

    private static final String[] CHILD_COLUMNS = {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED,
    };

    private final ContentResolver resolver;

    MemoryTree(ContentResolver resolver) {
        this.resolver = resolver;
    }

    /** Un enfant d'un dossier, tel que le fournisseur le décrit ; taille et date à 0 s'il ne les donne pas. */
    static final class Child {
        final String id;
        final String name;
        final boolean isDir;
        final long size;
        final long mtimeMs;
        /** Faux si le fournisseur ne donne pas la taille. */
        final boolean sizeKnown;

        Child(String id, String name, boolean isDir, long size, long mtimeMs, boolean sizeKnown) {
            this.id = id;
            this.name = name;
            this.isDir = isDir;
            this.size = size;
            this.mtimeMs = mtimeMs;
            this.sizeKnown = sizeKnown;
        }
    }

    /** Enfants d'un dossier, dans l'ordre du fournisseur. */
    List<Child> children(Uri tree, String dirId) {
        List<Child> children = new ArrayList<>();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId);
        try (Cursor c = resolver.query(childrenUri, CHILD_COLUMNS, null, null, null)) {
            while (c != null && c.moveToNext()) {
                children.add(new Child(
                    c.getString(0),
                    c.getString(1),
                    Document.MIME_TYPE_DIR.equals(c.getString(2)),
                    c.isNull(3) ? 0 : c.getLong(3),
                    c.isNull(4) ? 0 : c.getLong(4),
                    !c.isNull(3)
                ));
            }
        }
        return children;
    }

    /** Identifiant du document au chemin donné, `null` s'il n'existe pas. */
    String resolveExisting(Uri tree, String path) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        for (String part : path.split("/")) {
            if (part.isEmpty()) continue;
            String child = findChild(tree, id, part);
            if (child == null) return null;
            id = child;
        }
        return id;
    }

    /**
     * Identifiant du dossier mémoire dans l'arbre : la racine de l'arbre sans `base`, sinon son sous-dossier `base`
     * (« Tracker » quand l'utilisateur a désigné le dossier qui le contient). `null` si ce sous-dossier n'existe pas,
     * ou si `base` sortirait de l'arbre (`ComputerLinkProtocol.baseAllowed`) : rien n'est alors cherché.
     */
    String baseDir(Uri tree, String base) {
        if (base == null || base.isEmpty()) return DocumentsContract.getTreeDocumentId(tree);
        if (!ComputerLinkProtocol.baseAllowed(base)) return null;
        return resolveExisting(tree, base);
    }

    /** Taille du fichier d'identifiant donné, -1 si c'est un dossier, s'il n'existe plus ou si sa taille est inconnue. */
    long fileSize(Uri tree, String id) {
        String[] columns = { Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE };
        try (Cursor c = resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, id), columns, null, null, null)) {
            if (c == null || !c.moveToFirst() || Document.MIME_TYPE_DIR.equals(c.getString(0)) || c.isNull(1)) return -1;
            return c.getLong(1);
        }
    }

    /** Le document d'identifiant donné, décrit comme un enfant de son dossier ; `null` s'il n'existe plus. */
    Child describe(Uri tree, String id) {
        try (Cursor c = resolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, id), CHILD_COLUMNS, null, null, null)) {
            if (c == null || !c.moveToFirst()) return null;
            return new Child(
                c.getString(0),
                c.getString(1),
                Document.MIME_TYPE_DIR.equals(c.getString(2)),
                c.isNull(3) ? 0 : c.getLong(3),
                c.isNull(4) ? 0 : c.getLong(4),
                !c.isNull(3)
            );
        }
    }

    /** Flux de lecture d'un document de l'arbre. */
    InputStream open(Uri tree, String id) throws FileNotFoundException {
        InputStream in = resolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id));
        if (in == null) throw new FileNotFoundException("Lecture refusée par le fournisseur");
        return in;
    }

    /**
     * Enfant d'un dossier, par son nom. Sur le stockage du téléphone,
     * l'identifiant d'un document est son chemin (« primary:Documents/Tracker/sessions ») :
     * on le construit et on vérifie qu'il existe, une requête au lieu de lire
     * tout le dossier. Chez ce fournisseur, un document absent l'est vraiment :
     * pas de relecture du dossier (le temporaire d'une réécriture est presque
     * toujours absent, et `sessions/` compte des centaines de fichiers). Pour
     * un autre fournisseur, ou une autre erreur, repli sur la recherche par nom.
     */
    String findChild(Uri tree, String parentId, String name) {
        String guess = parentId.endsWith(":") ? parentId + name : parentId + "/" + name;
        boolean pathIds = EXTERNAL_STORAGE_AUTHORITY.equals(tree.getAuthority());
        try {
            String found = displayName(tree, guess);
            if (name.equals(found)) return guess;
            if (pathIds && found == null) return null;
        } catch (IllegalArgumentException e) {
            // Le fournisseur du stockage dit ainsi « aucun document à ce chemin ».
            if (pathIds) return null;
        } catch (Exception e) {
            // Fournisseur aux identifiants opaques, ou erreur passagère : recherche par nom.
        }
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        try (Cursor c = resolver.query(children, CHILD_COLUMNS, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return c.getString(0);
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    String displayName(Uri tree, String id) {
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        try (Cursor c = resolver.query(uri, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getString(0) : null;
        }
    }

    boolean exists(Uri tree, String id) {
        try {
            return displayName(tree, id) != null;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Ce qui s'est passé, d'après l'erreur et ses causes : `TOO_LARGE` (mémoire
     * manquante), `PERMISSION`, `NO_SPACE`, `NOT_FOUND`, sinon `UNKNOWN`. Un accès
     * refusé arrive souvent en `FileNotFoundException` (« EACCES ») : il passe donc
     * avant `NOT_FOUND`, retenu seulement si aucune cause n'en dit plus.
     */
    static String errorCode(Throwable e) {
        boolean notFound = false;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof OutOfMemoryError) return "TOO_LARGE";
            if (t instanceof SecurityException) return "PERMISSION";
            String message = String.valueOf(t.getMessage());
            if (message.contains("EACCES") || message.contains("EPERM")) return "PERMISSION";
            if (message.contains("ENOSPC") || message.contains("No space left")) return "NO_SPACE";
            if (t instanceof FileNotFoundException || message.contains("Missing file") || message.contains("FileNotFoundException")) notFound = true;
        }
        return notFound ? "NOT_FOUND" : "UNKNOWN";
    }
}
