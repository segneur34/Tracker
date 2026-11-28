package io.github.segneur.tracker;

import android.content.ContentResolver;
import android.net.Uri;
import android.util.Log;
import io.github.segneur.tracker.ComputerLinkPlugin.MemoryRoot;
import io.github.segneur.tracker.ComputerLinkProtocol.FrameException;
import io.github.segneur.tracker.ComputerLinkProtocol.Incoming;
import io.github.segneur.tracker.ComputerLinkProtocol.RawFile;
import io.github.segneur.tracker.ComputerLinkProtocol.RemoteFile;
import io.github.segneur.tracker.ComputerLinkProtocol.WriteSession;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

/**
 * Réponses du téléphone aux commandes du PC une fois relié (`ping`, `lister`, `lire`, `listerTout`, `ecrire`,
 * `valider`, `deplacer`, `listerCorbeille`), dans le dossier mémoire désigné, et l'écriture en cours de la liaison :
 * une instance par liaison, que seul le fil de la liaison touche. Le réseau, l'état rendu à la page et ses annonces
 * restent dans ComputerLinkPlugin, qui donne ici l'état « occupé » (`busy` : un service de premier plan tourne,
 * ForegroundWork) et ce qu'il fait d'une demande du PC (`exchanged`) et d'un fichier parti jusqu'à son dernier octet
 * (`fileSent`).
 *
 * Rien n'est écrit ni déplacé pendant un enregistrement, le compteur du fractionné ou une séance à la ceinture seule
 * (`erreur` PERMISSION). Un fichier arrive bloc par bloc dans son provisoire (`.tracker-new`, ou `.tracker-tmp` s'il
 * remplace un fichier), une écriture à la fois ; `valider` relit la taille puis le met en place (MemoryWriter). Bloc
 * hors d'ordre, taille fausse ou liaison coupée (`abandon`) : provisoire effacé, original intact.
 *
 * Aucune commande n'efface un fichier de l'utilisateur : ce que l'ordinateur retire de `sessions/` ou `itineraires/`
 * est déplacé dans la corbeille du téléphone (`deplacer`), à la place que le PC a choisie et où il a d'abord écrit
 * `depose.json`. La page du téléphone adopte ensuite le dépôt ; ce greffon n'écrit jamais l'index de la corbeille.
 */
final class ComputerLinkCommands {

    private static final String TAG = "TrackerLiaison";

    /** Phrase que la page reconnaît pour le dire en clair (`MESSAGE_ENREGISTREMENT` de bureau/telephone.ts). */
    static final String RECORDING_REFUSAL = "Le téléphone enregistre une session : rien n'y est écrit pendant ce temps.";
    private static final String NO_MEMORY_FOLDER = "Aucun dossier mémoire désigné sur le téléphone.";

    private final ContentResolver resolver;
    /** Vrai pendant un travail de premier plan (ForegroundWork) : le téléphone n'écrit ni ne déplace rien pour le PC. */
    private final BooleanSupplier busy;
    /** Une demande du PC (hors `ping`) vient d'arriver. */
    private final Runnable exchanged;
    /** Un fichier vient de partir jusqu'à son dernier octet. */
    private final Runnable fileSent;

    /** Écriture en cours : l'ordre de ses blocs, son provisoire ouvert et qui l'écrit ; tous nuls sinon. */
    private WriteSession writing;
    private MemoryWriter.Provisional provisional;
    private MemoryWriter writer;

    ComputerLinkCommands(ContentResolver resolver, BooleanSupplier busy, Runnable exchanged, Runnable fileSent) {
        this.resolver = resolver;
        this.busy = busy;
        this.exchanged = exchanged;
        this.fileSent = fileSent;
    }

    /**
     * La réponse à une commande du PC, dans le dossier mémoire `root` (`null` si la page n'en a désigné aucun). Lève
     * `MESSAGE_INCONNU` sur un message que le PC n'envoie pas une fois relié.
     */
    byte[] answer(Incoming m, MemoryRoot root) throws FrameException {
        if (!"ping".equals(m.type)) exchanged.run();
        switch (m.type) {
            case "ping":
                return ComputerLinkProtocol.encodePong(m.id, busy.getAsBoolean());
            case "lister":
                return listFiles(root, m.id);
            case "lire":
                return readBlock(root, m);
            case "listerTout":
                return listAll(root, m.id);
            case "ecrire":
                return writeBlock(root, m);
            case "valider":
                return commitWrite(m);
            case "deplacer":
                return moveToTrash(root, m);
            case "listerCorbeille":
                return listTrash(root, m.id);
            default:
                throw new FrameException(ComputerLinkProtocol.UNKNOWN_MESSAGE, "Message inattendu une fois relié : " + m.type);
        }
    }

    // ---------- lectures ----------

    /**
     * Fichiers de la racine et des `LISTED_DIRS`, sans dossier ni provisoire. Chaque dossier est d'abord remis en
     * ordre comme l'application le fait en le lisant (`MemoryWriter.settle`) : un remplacement interrompu est terminé
     * et son fichier listé sous son nom, une création interrompue effacée.
     */
    private static List<RemoteFile> settledListing(MemoryTree memory, MemoryWriter writer, Uri tree, String rootId) {
        List<RemoteFile> files = new ArrayList<>();
        Map<String, String> dirs = new LinkedHashMap<>();
        for (MemoryWriter.Shown shown : writer.settle(tree, memory.children(tree, rootId))) {
            if (shown.child.isDir) {
                if (ComputerLinkProtocol.LISTED_DIRS.contains(shown.name)) dirs.put(shown.name, shown.child.id);
            } else if (shown.child.sizeKnown) {
                files.add(new RemoteFile(shown.name, shown.child.size, shown.child.mtimeMs));
            }
        }
        for (Map.Entry<String, String> dir : dirs.entrySet()) {
            for (MemoryWriter.Shown shown : writer.settle(tree, memory.children(tree, dir.getValue()))) {
                if (!shown.child.isDir && shown.child.sizeKnown) files.add(new RemoteFile(dir.getKey() + "/" + shown.name, shown.child.size, shown.child.mtimeMs));
            }
        }
        return files;
    }

    /** Réponse à `lister` : `settledListing`, filtré et trié par `encodeList`. */
    private byte[] listFiles(MemoryRoot root, long id) throws FrameException {
        if (root == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        try {
            Uri tree = Uri.parse(root.folder);
            MemoryTree memory = new MemoryTree(resolver);
            String rootId = memory.baseDir(tree, root.base);
            if (rootId == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Dossier mémoire introuvable sur le téléphone : " + root.base);
            return ComputerLinkProtocol.encodeList(id, settledListing(memory, new MemoryWriter(resolver), tree, rootId));
        } catch (FrameException e) {
            return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_UNKNOWN, "Liste trop longue pour une trame.");
        } catch (Exception e) {
            Log.w(TAG, "lister", e);
            return ComputerLinkProtocol.encodeError(id, MemoryTree.errorCode(e), "Lecture du dossier impossible : " + e.getMessage());
        }
    }

    /**
     * Réponse à `listerTout`, pour la copie de sécurité : tout le dossier mémoire, à toute profondeur, sous les noms
     * réels, provisoires et corbeille compris, en lecture seule. La racine et les `LISTED_DIRS` sont d'abord remis en
     * ordre comme pour `lister` (aucun échange interrompu n'y reste, sauf celui qu'une écriture tient en ce moment).
     * Un fichier dont le fournisseur ne donne pas la taille part avec `ordinaire` faux : le PC ne saurait pas le
     * relire. Un chemin plus long que ce que le PC admet fait échouer la réponse entière, plutôt qu'une copie
     * incomplète.
     */
    private byte[] listAll(MemoryRoot root, long id) throws FrameException {
        if (root == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        try {
            Uri tree = Uri.parse(root.folder);
            MemoryTree memory = new MemoryTree(resolver);
            String rootId = memory.baseDir(tree, root.base);
            if (rootId == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Dossier mémoire introuvable sur le téléphone : " + root.base);
            settledListing(memory, new MemoryWriter(resolver), tree, rootId);
            List<RawFile> files = new ArrayList<>();
            walk(memory, tree, rootId, "", files);
            return ComputerLinkProtocol.encodeListAll(id, files);
        } catch (FrameException e) {
            return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_UNKNOWN, "Liste trop longue pour une trame.");
        } catch (Exception e) {
            Log.w(TAG, "listerTout", e);
            return ComputerLinkProtocol.encodeError(id, MemoryTree.errorCode(e), "Listage complet du dossier impossible : " + e.getMessage());
        }
    }

    /** Ajoute à `files` tout ce que contient le dossier `dirId`, à toute profondeur, sous le préfixe `prefix`. */
    private static void walk(MemoryTree memory, Uri tree, String dirId, String prefix, List<RawFile> files) throws IOException {
        for (MemoryTree.Child child : memory.children(tree, dirId)) {
            String path = prefix + child.name;
            // Borne aussi la profondeur : un lien qui reboucle ne fait pas tourner la liste sans fin.
            if (path.length() > ComputerLinkProtocol.RAW_PATH_MAX) throw new IOException("Chemin trop long pour le PC : " + path.substring(0, 200) + "…");
            if (child.isDir) {
                walk(memory, tree, child.id, path + "/", files);
            } else {
                files.add(new RawFile(path, child.sizeKnown ? child.size : 0, Math.max(0, child.mtimeMs), child.sizeKnown));
            }
        }
    }

    /** Réponse à `lire` : les octets demandés, plus courts seulement à la fin du fichier. */
    private byte[] readBlock(MemoryRoot root, Incoming m) throws FrameException {
        if (root == null) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        try {
            Uri tree = Uri.parse(root.folder);
            MemoryTree memory = new MemoryTree(resolver);
            // Le chemin a passé `readAllowed` et le sous-dossier `baseAllowed` : il ne désigne qu'un fichier sous le
            // dossier mémoire, cherché nom par nom depuis la racine de l'arbre.
            String docId = memory.resolveExisting(tree, ComputerLinkProtocol.inBase(root.base, m.path));
            long size = docId == null ? -1 : memory.fileSize(tree, docId);
            if (size < 0) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Fichier absent : " + m.path);
            int wanted = (int) Math.max(0, Math.min(m.length, size - m.start));
            byte[] data = new byte[wanted];
            int read = 0;
            if (wanted > 0) {
                try (InputStream in = memory.open(tree, docId)) {
                    skipFully(in, m.start);
                    while (read < wanted) {
                        int n = in.read(data, read, wanted - read);
                        if (n < 0) break;
                        read += n;
                    }
                }
            }
            if (read > 0 && m.start + read >= size) fileSent.run();
            return ComputerLinkProtocol.encodeBlock(m.id, m.start, data, read);
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "lire", e);
            return ComputerLinkProtocol.encodeError(m.id, MemoryTree.errorCode(e), "Lecture impossible : " + e.getMessage());
        }
    }

    /**
     * Réponse à `listerCorbeille` : les noms des sous-dossiers de la corbeille du téléphone, pour que le PC en choisisse
     * un libre ; aucun si elle n'existe pas.
     */
    private byte[] listTrash(MemoryRoot root, long id) throws FrameException {
        if (root == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        try {
            Uri tree = Uri.parse(root.folder);
            MemoryTree memory = new MemoryTree(resolver);
            String rootId = memory.baseDir(tree, root.base);
            if (rootId == null) return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Dossier mémoire introuvable sur le téléphone : " + root.base);
            List<String> folders = new ArrayList<>();
            String trashId = memory.findChild(tree, rootId, ComputerLinkProtocol.TRASH_DIR);
            MemoryTree.Child trash = trashId == null ? null : memory.describe(tree, trashId);
            if (trash != null && trash.isDir) {
                for (MemoryTree.Child child : memory.children(tree, trashId)) if (child.isDir) folders.add(child.name);
            }
            return ComputerLinkProtocol.encodeTrashList(id, folders);
        } catch (FrameException e) {
            return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_UNKNOWN, "Liste trop longue pour une trame.");
        } catch (Exception e) {
            Log.w(TAG, "listerCorbeille", e);
            return ComputerLinkProtocol.encodeError(id, MemoryTree.errorCode(e), "Lecture de la corbeille impossible : " + e.getMessage());
        }
    }

    // ---------- écritures du PC ----------

    /** Le dossier où écrire un chemin admis par `writeAllowed`, et le nom du fichier dedans. */
    private static final class Target {
        final Uri tree;
        final String parentId;
        final String name;

        Target(Uri tree, String parentId, String name) {
            this.tree = tree;
            this.parentId = parentId;
            this.name = name;
        }
    }

    /**
     * Le dossier d'un chemin admis par `writeAllowed`, sous le sous-dossier de la mémoire (`baseAllowed`) : la racine
     * de la mémoire, l'un des `WRITABLE_DIRS`, ou le sous-dossier d'un dépôt dans la corbeille, créés avec `create`
     * s'ils manquent. `null` si la mémoire est introuvable, ou, sans `create`, si le dossier manque.
     */
    private static Target targetOf(MemoryWriter writer, MemoryTree memory, MemoryRoot root, String path, boolean create) throws Exception {
        Uri tree = Uri.parse(root.folder);
        String rootId = memory.baseDir(tree, root.base);
        if (rootId == null) return null;
        int slash = path.lastIndexOf('/');
        String parentId = slash < 0 ? rootId : writer.resolveFrom(tree, rootId, path.substring(0, slash), create);
        return parentId == null ? null : new Target(tree, parentId, path.substring(slash + 1));
    }

    /** Refus d'une note de dépôt qui remplacerait un fichier : elle n'est jamais écrite par-dessus. */
    private static byte[] depositTaken(long id, String path) throws FrameException {
        return ComputerLinkProtocol.encodeError(id, ComputerLinkProtocol.ERROR_UNKNOWN, "« " + path + " » existe déjà sur le téléphone : la note d'un dépôt n'est jamais remplacée.");
    }

    /**
     * Réponse à `ecrire`. Le premier bloc (debut 0) abandonne l'écriture non validée d'avant et ouvre le provisoire :
     * `.tracker-tmp` si le fichier existe, `.tracker-new` sinon. Chaque bloc suivant doit continuer l'écriture
     * (`WriteSession.continues`) ; sinon, ou sur toute erreur, l'écriture est abandonnée, l'original intact. La note
     * d'un dépôt (`depositAllowed`) n'est écrite que là où rien n'existe.
     */
    private byte[] writeBlock(MemoryRoot root, Incoming m) throws FrameException {
        if (busy.getAsBoolean()) {
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_PERMISSION, RECORDING_REFUSAL);
        }
        if (root == null) {
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        }
        try {
            if (WriteSession.opens(m.start)) {
                abandon();
                MemoryWriter writer = new MemoryWriter(resolver);
                MemoryTree memory = new MemoryTree(resolver);
                Target t = targetOf(writer, memory, root, m.path, true);
                if (t == null) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Dossier mémoire introuvable sur le téléphone : " + root.base);
                String existing = memory.findChild(t.tree, t.parentId, t.name);
                MemoryTree.Child current = existing == null ? null : memory.describe(t.tree, existing);
                if (current != null && ComputerLinkProtocol.depositAllowed(m.path)) return depositTaken(m.id, m.path);
                if (current != null && current.isDir) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_UNKNOWN, m.path + " est un dossier sur le téléphone.");
                boolean replacing = current != null;
                provisional = writer.open(t.tree, t.parentId, t.name, ComputerLinkProtocol.provisionalName(t.name, replacing), m.path);
                this.writer = writer;
                writing = new WriteSession(m.path, m.size, replacing);
            } else if (writing == null || !writing.continues(m.path, m.start, m.size, m.length)) {
                abandon();
                return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_UNKNOWN, "Bloc hors d'ordre pour " + m.path + " : écriture abandonnée.");
            }
            provisional.out.write(m.body);
            writing.wrote(m.length);
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "ecrire", e);
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, MemoryTree.errorCode(e), "Écriture impossible : " + e.getMessage());
        }
        return ComputerLinkProtocol.encodeDone(m.id);
    }

    /**
     * Réponse à `valider` : l'écriture en cours doit viser ce chemin, de cette taille, tous ses octets reçus ; le
     * provisoire, sa taille relue, prend alors la place du fichier (`MemoryWriter.commit`). Rend le fichier tel qu'il
     * est désormais, avec la taille et la date que `lister` montrera. La note d'un dépôt n'est mise en place que si
     * sa place est toujours libre.
     */
    private byte[] commitWrite(Incoming m) throws FrameException {
        if (busy.getAsBoolean()) {
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_PERMISSION, RECORDING_REFUSAL);
        }
        if (writing == null || provisional == null || !writing.completes(m.path, m.size)) {
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_UNKNOWN, "Validation refusée pour " + m.path + " : aucune écriture complète de " + m.size + " octets en cours.");
        }
        MemoryTree.Child done;
        try {
            if (ComputerLinkProtocol.depositAllowed(m.path) && new MemoryTree(resolver).findChild(provisional.tree, provisional.parentId, provisional.name) != null) {
                abandon();
                return depositTaken(m.id, m.path);
            }
            done = writer.commit(provisional, m.size, m.path);
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "valider", e);
            abandon();
            return ComputerLinkProtocol.encodeError(m.id, MemoryTree.errorCode(e), "Mise en place impossible : " + e.getMessage());
        }
        provisional = null;
        writer = null;
        writing = null;
        return ComputerLinkProtocol.encodeWritten(m.id, m.path, done.sizeKnown ? done.size : m.size, done.mtimeMs);
    }

    /**
     * Réponse à `deplacer` : le fichier `chemin` de `sessions/` ou `itineraires/` part dans la corbeille du téléphone,
     * à la place `vers` (`corbeille/<sous-dossier>/<même nom>`, admise par `trashDestinationAllowed`). Sans effet sur un
     * fichier qui n'est plus là. Refusé, original intact : pendant un travail de premier plan, si sa taille ou sa date
     * ne sont plus celles du listage, ou si la place visée est prise (y compris par la note du dépôt, pour un fichier
     * qui s'appellerait `depose.json`). Le provisoire d'un remplacement interrompu laissé à côté est effacé d'abord ;
     * l'écriture en cours du même chemin est abandonnée.
     */
    private byte[] moveToTrash(MemoryRoot root, Incoming m) throws FrameException {
        if (busy.getAsBoolean()) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_PERMISSION, RECORDING_REFUSAL);
        if (root == null) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, NO_MEMORY_FOLDER);
        if (writing != null && writing.path.equals(m.path)) abandon();
        try {
            Uri tree = Uri.parse(root.folder);
            MemoryTree memory = new MemoryTree(resolver);
            MemoryWriter writer = new MemoryWriter(resolver);
            String rootId = memory.baseDir(tree, root.base);
            if (rootId == null) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_NOT_FOUND, "Dossier mémoire introuvable sur le téléphone : " + root.base);
            int slash = m.path.indexOf('/');
            String name = m.path.substring(slash + 1);
            String parentId = memory.findChild(tree, rootId, m.path.substring(0, slash));
            String sourceId = parentId == null ? null : memory.findChild(tree, parentId, name);
            MemoryTree.Child source = sourceId == null ? null : memory.describe(tree, sourceId);
            if (source == null) return ComputerLinkProtocol.encodeDone(m.id);
            if (source.isDir) return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_PERMISSION, "« " + m.path + " » n'est pas un fichier sur le téléphone.");
            if (!source.sizeKnown || source.size != m.size || source.mtimeMs != m.dateMs) {
                return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_UNKNOWN, "« " + m.path + " » a changé sur le téléphone depuis le listage : listez-le de nouveau.");
            }
            String[] to = m.to.split("/", -1);
            String trashId = writer.directory(tree, rootId, to[0], to[0]);
            String depositId = writer.directory(tree, trashId, to[1], to[0] + "/" + to[1]);
            if (memory.findChild(tree, depositId, name) != null) {
                return ComputerLinkProtocol.encodeError(m.id, ComputerLinkProtocol.ERROR_UNKNOWN, "« " + m.to + " » est déjà pris dans la corbeille du téléphone.");
            }
            writer.eraseLeftover(tree, parentId, name + ComputerLinkProtocol.TEMP_SUFFIX, m.path + ComputerLinkProtocol.TEMP_SUFFIX);
            writer.moveInto(tree, parentId, sourceId, name, depositId, source.size, m.path);
        } catch (Exception e) {
            Log.w(TAG, "deplacer", e);
            return ComputerLinkProtocol.encodeError(m.id, MemoryTree.errorCode(e), "Mise à la corbeille impossible : " + e.getMessage());
        }
        return ComputerLinkProtocol.encodeDone(m.id);
    }

    /** Abandonne l'écriture en cours, s'il y en a une : flux fermé, provisoire effacé. Ne lève jamais. */
    void abandon() {
        MemoryWriter.Provisional p = provisional;
        MemoryWriter w = writer;
        provisional = null;
        writer = null;
        writing = null;
        if (p != null && w != null) w.abandon(p);
    }

    private static void skipFully(InputStream in, long count) throws IOException {
        long left = count;
        byte[] scrap = null;
        while (left > 0) {
            long skipped = in.skip(left);
            if (skipped > 0) {
                left -= skipped;
                continue;
            }
            if (scrap == null) scrap = new byte[8192];
            int n = in.read(scrap, 0, (int) Math.min(scrap.length, left));
            if (n < 0) return;
            left -= n;
        }
    }
}
