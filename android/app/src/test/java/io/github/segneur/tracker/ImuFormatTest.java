package io.github.segneur.tracker;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
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
