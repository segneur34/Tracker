package io.github.segneur.tracker;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Garde l'accord entre les deux auteurs du format `.imu` : ce que `ImuWriter`
 * écrit aujourd'hui doit se relire comme la référence versionnée, que
 * `src/core/imuFile.reference.test.ts` relit de son côté par le lecteur de la
 * page, sans Gradle.
 *
 * Paquet par paquet, décompressé : deux `Deflater` peuvent produire des octets
 * différents pour le même contenu selon la JVM, ce qui ne change rien au format.
 * Ce test n'écrit jamais la référence (`ImuReference`, pour la refaire).
 *
 * Il garde aussi la reprise d'un fichier après une coupure (`ImuWriter.readExisting`
 * et le second constructeur, lot 232) : la suite s'ajoute sans abîmer ce qui précède.
 */
public class ImuFormatTest {

    private static final String REFERENCE = "src/core/imuFile.reference.imu";
    private static final String IF_WANTED = " Si le changement de format est voulu : le décrire en tête de src/core/imuFile.ts,"
        + " faire suivre le lecteur, node outils/imu-reference.mjs, puis reporter les valeurs dans imuFile.reference.test.ts.";

    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    @Test
    public void marqueEtEnTeteSontCeuxDeLaReference() throws IOException {
        ImuContent written = ImuContent.read(writeFile());
        ImuContent reference = ImuContent.read(referenceFile());
        // Tout ce qui précède les paquets ne dépend pas de la compression : octet pour octet.
        assertArrayEquals("Marque, longueur ou texte de l'en-tête." + IF_WANTED, reference.head, written.head);
    }

    @Test
    public void paquetsDecompressesSontCeuxDeLaReference() throws IOException {
        ImuContent written = ImuContent.read(writeFile());
        ImuContent reference = ImuContent.read(referenceFile());
        assertEquals("Nombre de paquets." + IF_WANTED, reference.packets.size(), written.packets.size());
        for (int i = 0; i < reference.packets.size(); i++) {
            assertArrayEquals("Paquet " + (i + 1) + " décompressé." + IF_WANTED, reference.packets.get(i), written.packets.get(i));
        }
    }

    /**
     * Capture reprise après une coupure : le paquet tronqué par l'arrêt brutal est coupé, la suite s'ajoute sans
     * nouvel en-tête, et le fichier se relit comme s'il avait été écrit d'un trait, trou compris.
     */
    @Test
    public void repriseApresUnPaquetTronqueSeRelitCommeUnFichierEcritDUnTrait() throws IOException {
        File whole = folder.newFile("entier.imu");
        try (ImuWriter writer = new ImuWriter(whole, ImuReference.HEADER_JSON, streams())) {
            packet(writer, 0);
            writer.flushChunk();
            packet(writer, 1);
            writer.flushChunk();
            packet(writer, 2);
        }

        File cut = folder.newFile("repris.imu");
        try (ImuWriter writer = new ImuWriter(cut, ImuReference.HEADER_JSON, streams())) {
            packet(writer, 0);
            writer.flushChunk();
            packet(writer, 1);
        }
        long kept = cut.length();
        // Un troisième paquet coupé net : sa longueur annonce 50 octets, trois seulement ont été écrits.
        Files.write(cut.toPath(), new byte[] { 50, 0, 0, 0, 1, 2, 3 }, StandardOpenOption.APPEND);
        ImuWriter.Existing existing = ImuWriter.readExisting(cut);
        assertEquals("Fin du dernier paquet entier.", kept, existing.end);
        assertEquals(ImuReference.HEADER_JSON, existing.headerJson);
        assertTrue("Des mesures gardées d'avant la coupure.", existing.hasPackets);
        try (ImuWriter writer = new ImuWriter(cut, existing, streams())) {
            assertEquals(kept, writer.bytes());
            packet(writer, 2);
        }

        ImuContent expected = ImuContent.read(Files.readAllBytes(whole.toPath()));
        ImuContent resumed = ImuContent.read(Files.readAllBytes(cut.toPath()));
        assertArrayEquals("Marque et en-tête gardés tels quels.", expected.head, resumed.head);
        assertEquals(3, resumed.packets.size());
        for (int i = 0; i < 3; i++) {
            assertArrayEquals("Paquet " + (i + 1) + " décompressé.", expected.packets.get(i), resumed.packets.get(i));
        }
    }

    @Test
    public void repriseApresUneLongueurDePaquetElleMemeCoupee() throws IOException {
        File cut = folder.newFile("longueur-coupee.imu");
        try (ImuWriter writer = new ImuWriter(cut, ImuReference.HEADER_JSON, streams())) {
            packet(writer, 0);
        }
        long kept = cut.length();
        Files.write(cut.toPath(), new byte[] { 9, 0 }, StandardOpenOption.APPEND);
        assertEquals(kept, ImuWriter.readExisting(cut).end);
        try (ImuWriter writer = new ImuWriter(cut, ImuWriter.readExisting(cut), streams())) {
            packet(writer, 1);
        }
        assertEquals(2, ImuContent.read(Files.readAllBytes(cut.toPath())).packets.size());
    }

    @Test
    public void repriseDUnFichierSansPaquet() throws IOException {
        File empty = folder.newFile("sans-paquet.imu");
        new ImuWriter(empty, ImuReference.HEADER_JSON, streams()).close();
        long kept = empty.length();
        ImuWriter.Existing existing = ImuWriter.readExisting(empty);
        assertEquals(kept, existing.end);
        assertFalse("Aucune mesure d'avant.", existing.hasPackets);
        try (ImuWriter writer = new ImuWriter(empty, existing, streams())) {
            packet(writer, 0);
        }
        ImuContent content = ImuContent.read(Files.readAllBytes(empty.toPath()));
        assertEquals(kept, content.head.length);
        assertEquals(1, content.packets.size());
    }

    @Test
    public void marqueInconnueRefuseeSansToucherAuFichier() throws IOException {
        File other = folder.newFile("autre.imu");
        byte[] bytes = "PASIMU1\n\u0002\u0000\u0000\u0000{}".getBytes(StandardCharsets.US_ASCII);
        Files.write(other.toPath(), bytes);
        try {
            ImuWriter.readExisting(other);
            fail("Marque inconnue acceptée.");
        } catch (IOException expected) {
            assertArrayEquals(bytes, Files.readAllBytes(other.toPath()));
        }
        File shortHeader = folder.newFile("en-tete-coupe.imu");
        byte[] cutHeader = Arrays.copyOf(writeFile(), ImuWriter.MAGIC.length + 10);
        Files.write(shortHeader.toPath(), cutHeader);
        try {
            ImuWriter.readExisting(shortHeader);
            fail("En-tête coupé accepté.");
        } catch (IOException expected) {
            assertArrayEquals(cutHeader, Files.readAllBytes(shortHeader.toPath()));
        }
    }

    private static ImuWriter.Stream[] streams() {
        return new ImuWriter.Stream[] {
            new ImuWriter.Stream(0, 3, 0.01, 0),
            new ImuWriter.Stream(1, 3, 0.002, 0),
        };
    }

    /** Un paquet d'une seconde à 100 Hz, accéléromètre et gyroscope ; le n° 2 vient après un trou de 10 min. */
    private static void packet(ImuWriter writer, int number) {
        long startUs = number * 1_000_000L + (number >= 2 ? 600_000_000L : 0);
        for (int i = 0; i < 100; i++) {
            long t = startUs + i * 10_000L;
            writer.add(0, t, new float[] { 0.1f * i, -9.81f, number });
            writer.add(1, t + 500, new float[] { 0.002f * i, 0f, -0.5f * number });
        }
    }

    private byte[] writeFile() throws IOException {
        File file = folder.newFile("ecrit.imu");
        ImuReference.write(file);
        return Files.readAllBytes(file.toPath());
    }

    /** La référence, cherchée en remontant depuis le dossier de lancement (`android/app` sous Gradle). */
    private static byte[] referenceFile() throws IOException {
        for (File dir = new File("").getAbsoluteFile(); dir != null; dir = dir.getParentFile()) {
            File file = new File(dir, REFERENCE);
            if (file.isFile()) return Files.readAllBytes(file.toPath());
        }
        throw new AssertionError("Introuvable en remontant depuis " + new File("").getAbsolutePath() + " : " + REFERENCE);
    }

    /** Un fichier découpé selon le format : ce qui précède les paquets, puis chaque paquet décompressé. */
    private static final class ImuContent {
        final byte[] head;
        final List<byte[]> packets = new ArrayList<>();

        private ImuContent(byte[] head) {
            this.head = head;
        }

        static ImuContent read(byte[] file) {
            ByteBuffer in = ByteBuffer.wrap(file).order(ByteOrder.LITTLE_ENDIAN);
            int magic = ImuWriter.MAGIC.length;
            int headerStart = magic + 4;
            int headerEnd = headerStart + checkedLength(in, magic, "de l'en-tête");
            ImuContent content = new ImuContent(Arrays.copyOf(file, headerEnd));
            int at = headerEnd;
            while (at < file.length) {
                int number = content.packets.size() + 1;
                int start = at + 4;
                int length = checkedLength(in, at, "du paquet " + number);
                content.packets.add(inflate(Arrays.copyOfRange(file, start, start + length), number));
                at = start + length;
            }
            return content;
        }

        /** Longueur lue à `at`, qui doit tenir dans le fichier : un autre ordre des octets la ferait déborder. */
        private static int checkedLength(ByteBuffer in, int at, String what) {
            assertTrue("Longueur " + what + " coupée." + IF_WANTED, at + 4 <= in.limit());
            int length = in.getInt(at);
            assertTrue("Longueur " + what + " hors du fichier : " + length + "." + IF_WANTED, length >= 0 && length <= in.limit() - at - 4);
            return length;
        }

        private static byte[] inflate(byte[] packet, int number) {
            // Deflate brut : `nowrap`, qui veut un octet de plus en entrée (documentation d'Inflater). Une enveloppe zlib échoue ici.
            Inflater inflater = new Inflater(true);
            try {
                inflater.setInput(Arrays.copyOf(packet, packet.length + 1));
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];
                while (!inflater.finished()) {
                    int n = inflater.inflate(buffer);
                    if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) {
                        fail("Paquet " + number + " incomplet." + IF_WANTED);
                    }
                    out.write(buffer, 0, n);
                }
                // Rien après le flux, que le décompresseur de la page refuserait : il ne reste que l'octet ajouté.
                assertEquals("Octets après le flux du paquet " + number + "." + IF_WANTED, 1, inflater.getRemaining());
                return out.toByteArray();
            } catch (DataFormatException e) {
                throw new AssertionError("Paquet " + number + " : pas du deflate brut." + IF_WANTED, e);
            } finally {
                inflater.end();
            }
        }
    }
}
