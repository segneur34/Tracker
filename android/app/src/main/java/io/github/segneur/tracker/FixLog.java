package io.github.segneur.tracker;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Journal des positions du service d'enregistrement (RecordingService) : une ligne par position reçue du
 * téléphone, brute, plus les ordres de pause et l'arrêt par la garde. La page le relit à son retour pour refaire
 * les positions qu'elle n'a pas reçues (src/recording/nativeLog.ts, dont l'en-tête fixe le format, version 1).
 *
 * Texte UTF-8, une ligne JSON par événement, en ajout seul. Chaque ligne part en une seule écriture, sans tampon :
 * elle survit à la mort du processus. L'écriture forcée sur le disque, toutes les SYNC_INTERVAL_MS et à la
 * fermeture, ne couvre que l'extinction du téléphone.
 *
 * Java pur, sans API d'Android : la mise en forme des lignes et le choix de la fin de fichier rendue à la page
 * sont éprouvés en JUnit (FixLogTest). Écritures et lectures passent par un même verrou.
 */
final class FixLog implements Closeable {

    /** Nom du format, écrit dans l'en-tête : le même que celui que relit src/recording/nativeLog.ts (gardé par nativeConstants.test.ts). */
    static final String FORMAT = "tracker-positions";
    /** Version du format : `NATIVE_LOG_VERSION` de src/recording/nativeLog.ts. */
    static final int VERSION = 1;
    /** Nom du fichier, dans le dossier privé que ni la sauvegarde ni le transfert d'appareil n'emportent. */
    static final String FILE_NAME = "recording-fixes.jsonl";
    /** Écart entre deux écritures forcées sur le disque : ce qu'une extinction brutale du téléphone peut perdre. */
    static final long SYNC_INTERVAL_MS = 10_000L;
    /** Raisons d'un arrêt par la garde : resté sur place, durée maximale après la fermeture. */
    static final String STOP_STILL = "still";
    static final String STOP_TIMEOUT = "timeout";

    /** Un en-tête tient en une centaine d'octets : au-delà, ce n'en est pas un. */
    private static final int HEADER_MAX_BYTES = 256;
    private static final long NOT_A_FIX = Long.MIN_VALUE;
    private static final Object LOCK = new Object();

    /** Une position telle que le téléphone la donne, en unités SI ; `Double.NaN` pour ce qu'il ne donne pas. */
    static final class Fix {
        final long timeMs;
        final double lat;
        final double lon;
        final double accuracyM;
        final double altitudeM;
        final double speedMs;
        final double bearingDeg;

        Fix(long timeMs, double lat, double lon, double accuracyM, double altitudeM, double speedMs, double bearingDeg) {
            this.timeMs = timeMs;
            this.lat = lat;
            this.lon = lon;
            this.accuracyM = accuracyM;
            this.altitudeM = altitudeM;
            this.speedMs = speedMs;
            this.bearingDeg = bearingDeg;
        }
    }

    /** Vrai pour un nombre que le journal peut écrire : ni absent, ni infini. */
    static boolean known(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }

    /**
     * Un nombre simple précision du téléphone (précision, vitesse, cap) dans son écriture la plus courte : 3,9 reste
     * 3.9, pas 3.9000000953674316. Le journal et la page reçoivent ainsi le même nombre.
     */
    static double exact(float value) {
        if (Float.isNaN(value) || Float.isInfinite(value)) return Double.NaN;
        return Double.parseDouble(Float.toString(value));
    }

    // ---------- lignes ----------

    static String headerLine(long session) {
        return "{\"format\":\"" + FORMAT + "\",\"version\":" + VERSION + ",\"session\":" + session + "}\n";
    }

    /** Ligne d'une position ; `null` sans latitude ou longitude lisible : rien à garder. */
    static String fixLine(Fix fix) {
        if (!known(fix.lat) || !known(fix.lon)) return null;
        return "[" + fix.timeMs
            + "," + number(fix.lat)
            + "," + number(fix.lon)
            + "," + number(fix.accuracyM)
            + "," + number(fix.altitudeM)
            + "," + number(fix.speedMs)
            + "," + number(fix.bearingDeg)
            + "]\n";
    }

    static String pauseLine(long atMs) {
        return "[\"pause\"," + atMs + "]\n";
    }

    static String resumeLine(long atMs) {
        return "[\"resume\"," + atMs + "]\n";
    }

    /** Service relancé sur le fichier de la même session : la ligne vide isole une dernière ligne tronquée. */
    static String startLine(long atMs) {
        return "\n[\"start\"," + atMs + "]\n";
    }

    static String stopLine(long atMs, String reason) {
        return "[\"stop\"," + atMs + ",\"" + reason + "\"]\n";
    }

    /** Un nombre en JSON : jamais NaN ni Infinity, une valeur absente ou non finie s'écrit `null`. */
    private static String number(double value) {
        return known(value) ? Double.toString(value) : "null";
    }

    // ---------- écriture ----------

    private FileOutputStream out;
    private long lastSyncMs;
    /** Vrai si le fichier portait déjà cette session : la suite s'y ajoute, après une ligne `start`. */
    final boolean resumed;
    /** Nombre d'écritures forcées sur le disque, pour les essais. */
    int syncCount = 0;

    private FixLog(FileOutputStream out, boolean resumed, long elapsedMs) {
        this.out = out;
        this.resumed = resumed;
        this.lastSyncMs = elapsedMs;
    }

    /**
     * Ouvre le journal de `session`. Le fichier d'une autre session, ou dont l'en-tête ne se lit pas, est remplacé ;
     * celui de la même session est complété, après une ligne `start` à l'heure `clockMs`. `elapsedMs` : l'horloge
     * monotone du téléphone, qui rythme les écritures forcées.
     */
    static FixLog open(File file, long session, long clockMs, long elapsedMs) throws IOException {
        synchronized (LOCK) {
            String header = headerLine(session);
            boolean resumed = header.equals(firstLine(file));
            File parent = file.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Dossier du journal introuvable");
            FixLog log = new FixLog(new FileOutputStream(file, resumed), resumed, elapsedMs);
            try {
                log.out.write((resumed ? startLine(clockMs) : header).getBytes(StandardCharsets.UTF_8));
                log.forceToDisk(elapsedMs);
            } catch (IOException e) {
                log.close();
                throw e;
            }
            return log;
        }
    }

    /** Ajoute une ligne, en une seule écriture ; forcée sur le disque si la dernière a plus de SYNC_INTERVAL_MS. */
    void append(String line, long elapsedMs) throws IOException {
        synchronized (LOCK) {
            if (out == null) throw new IOException("Journal fermé");
            out.write(line.getBytes(StandardCharsets.UTF_8));
            if (elapsedMs - lastSyncMs >= SYNC_INTERVAL_MS) forceToDisk(elapsedMs);
        }
    }

    /** Force sur le disque ce qui est écrit : à l'extinction du téléphone. Sans effet sur un journal fermé. */
    void sync(long elapsedMs) throws IOException {
        synchronized (LOCK) {
            if (out != null) forceToDisk(elapsedMs);
        }
    }

    private void forceToDisk(long elapsedMs) throws IOException {
        out.getFD().sync();
        lastSyncMs = elapsedMs;
        syncCount++;
    }

    /** Force l'écriture sur le disque, puis ferme. Sans effet sur un journal déjà fermé. */
    @Override
    public void close() throws IOException {
        synchronized (LOCK) {
            if (out == null) return;
            FileOutputStream closing = out;
            out = null;
            try {
                closing.getFD().sync();
                syncCount++;
            } finally {
                closing.close();
            }
        }
    }

    // ---------- lecture ----------

    /**
     * Texte du journal pour la page ; `null` sans fichier. Sans `afterMs`, le fichier entier ; sinon l'en-tête suivi
     * de la fin utile (`tail`), pour ne pas passer des mégaoctets à la page après des heures de sortie.
     */
    static String read(File file, Long afterMs) throws IOException {
        synchronized (LOCK) {
            if (!file.isFile()) return null;
            String text = new String(readAll(file), StandardCharsets.UTF_8);
            return afterMs == null ? text : tail(text, afterMs);
        }
    }

    /** Efface le journal ; vrai s'il n'en reste rien. */
    static boolean delete(File file) {
        synchronized (LOCK) {
            return !file.exists() || file.delete();
        }
    }

    /**
     * L'en-tête suivi de la fin du journal, à partir de la dernière position qui précède la première position
     * postérieure à `afterMs` (l'heure de la dernière position que la page a déjà). Cette position déjà connue est
     * gardée : elle prouve à la page que le service a tourné sans interruption jusqu'aux suivantes. On ne part pas de
     * la dernière position du fichier qui ne dépasse pas `afterMs` : une position ancienne redonnée tard par le
     * téléphone ferait sauter celles, neuves, qui la précèdent.
     *
     * Aucune position postérieure : la fin part de la dernière position du fichier. Aucune position qui précède, ou
     * pas d'en-tête : le texte entier. Une ligne tronquée ou illisible n'est jamais prise pour une position.
     */
    static String tail(String text, long afterMs) {
        int headerEnd = text.indexOf('\n');
        if (headerEnd < 0) return text;
        int bodyStart = headerEnd + 1;
        int from = -1;
        int at = bodyStart;
        while (at < text.length()) {
            int end = text.indexOf('\n', at);
            if (end < 0) end = text.length();
            long timeMs = fixTime(text, at, end);
            if (timeMs != NOT_A_FIX) {
                if (timeMs > afterMs) break;
                from = at;
            }
            at = end + 1;
        }
        if (from <= bodyStart) return text;
        return text.substring(0, bodyStart) + text.substring(from);
    }

    /**
     * Heure de la position écrite entre `from` et `end`, ou NOT_A_FIX : la ligne doit être entière (elle finit par
     * son crochet, ce qu'une ligne coupée par la mort du processus ne fait pas) et commencer par un nombre entier.
     */
    private static long fixTime(String text, int from, int end) {
        if (end - from < 3 || text.charAt(from) != '[' || text.charAt(end - 1) != ']') return NOT_A_FIX;
        int comma = text.indexOf(',', from);
        if (comma < 0 || comma >= end) return NOT_A_FIX;
        int start = from + 1;
        if (comma == start || comma - start > 19) return NOT_A_FIX;
        for (int i = start; i < comma; i++) {
            char c = text.charAt(i);
            if ((c < '0' || c > '9') && !(c == '-' && i == start && comma - start > 1)) return NOT_A_FIX;
        }
        try {
            return Long.parseLong(text.substring(start, comma));
        } catch (NumberFormatException e) {
            return NOT_A_FIX;
        }
    }

    /** Première ligne du fichier, saut de ligne compris ; `null` sans fichier ou sans ligne entière en tête. */
    private static String firstLine(File file) {
        if (!file.isFile()) return null;
        byte[] head = new byte[HEADER_MAX_BYTES];
        int length = 0;
        try (FileInputStream in = new FileInputStream(file)) {
            while (length < head.length) {
                int n = in.read(head, length, head.length - length);
                if (n <= 0) break;
                length += n;
            }
        } catch (IOException e) {
            return null;
        }
        for (int i = 0; i < length; i++) {
            if (head[i] == '\n') return new String(head, 0, i + 1, StandardCharsets.UTF_8);
        }
        return null;
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream((int) Math.max(256, Math.min(file.length(), 64L * 1024 * 1024)));
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) > 0) bytes.write(buffer, 0, n);
            return bytes.toByteArray();
        }
    }
}
