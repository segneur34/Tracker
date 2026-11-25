package io.github.segneur.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Le journal des positions du service, tel que la page le relit (src/recording/nativeLog.ts, format en tête de ce
 * fichier) : mise en forme de chaque ligne, fichier complété ou remplacé à l'ouverture, écritures forcées sur le
 * disque, et choix de la fin de fichier rendue à la page.
 */
public class FixLogTest {

    private static final long SESSION = 1794819600000L;
    private static final String HEADER = "{\"format\":\"tracker-positions\",\"version\":1,\"session\":1794819600000}\n";
    private static final double NONE = Double.NaN;

    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    // ---------- lignes ----------

    @Test
    public void enTeteTelQueLaPageLAttend() {
        assertEquals(HEADER, FixLog.headerLine(SESSION));
    }

    @Test
    public void positionCompleteSansArrondi() {
        FixLog.Fix fix = new FixLog.Fix(1794819601000L, 48.123456789, -4.5, FixLog.exact(3.9f), 12.25, FixLog.exact(5.14f), FixLog.exact(271.5f));
        assertEquals("[1794819601000,48.123456789,-4.5,3.9,12.25,5.14,271.5]\n", FixLog.fixLine(fix));
    }

    @Test
    public void valeurAbsenteOuNonFinieEcriteNull() {
        FixLog.Fix absent = new FixLog.Fix(1000L, 48.0, -4.0, NONE, NONE, NONE, NONE);
        assertEquals("[1000,48.0,-4.0,null,null,null,null]\n", FixLog.fixLine(absent));
        FixLog.Fix infinite = new FixLog.Fix(1000L, 48.0, -4.0, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 2.5, FixLog.exact(Float.NaN));
        assertEquals("[1000,48.0,-4.0,null,null,2.5,null]\n", FixLog.fixLine(infinite));
        assertTrue(Double.isNaN(FixLog.exact(Float.POSITIVE_INFINITY)));
    }

    @Test
    public void positionSansLatitudeOuLongitudeNonEcrite() {
        assertNull(FixLog.fixLine(new FixLog.Fix(1000L, NONE, -4.0, 3, 0, 0, 0)));
        assertNull(FixLog.fixLine(new FixLog.Fix(1000L, 48.0, Double.POSITIVE_INFINITY, 3, 0, 0, 0)));
    }

    @Test
    public void nombresTresPetitsOuTresGrandsRestentDuJson() {
        // L'écriture à exposant de Java (« 1.0E-5 ») est du JSON valide ; ni NaN ni Infinity n'y passent jamais.
        String line = FixLog.fixLine(new FixLog.Fix(1L, 1.0E-5, 0.0, 1.0E10, -0.0, FixLog.exact(1.0E-4f), 0));
        assertEquals("[1,1.0E-5,0.0,1.0E10,-0.0,1.0E-4,0.0]\n", line);
        assertFalse(line.contains("NaN"));
        assertFalse(line.contains("Infinity"));
    }

    @Test
    public void ordresDePauseRelanceEtArret() {
        assertEquals("[\"pause\",1794819700000]\n", FixLog.pauseLine(1794819700000L));
        assertEquals("[\"resume\",1794819760000]\n", FixLog.resumeLine(1794819760000L));
        assertEquals("\n[\"start\",1794819800000]\n", FixLog.startLine(1794819800000L));
        assertEquals("[\"stop\",1794819900000,\"still\"]\n", FixLog.stopLine(1794819900000L, FixLog.STOP_STILL));
        assertEquals("[\"stop\",1794819900000,\"timeout\"]\n", FixLog.stopLine(1794819900000L, FixLog.STOP_TIMEOUT));
    }

    // ---------- fichier ----------

    @Test
    public void fichierNeufEnTetePuisLignesEcritesAussitot() throws IOException {
        File file = new File(folder.getRoot(), FixLog.FILE_NAME);
        FixLog log = FixLog.open(file, SESSION, 5000L, 0L);
        assertFalse(log.resumed);
        assertEquals(HEADER, text(file));
        log.append(fix(1000), 100L);
        // Lisible sans attendre la fermeture : chaque ligne part en une écriture, sans tampon.
        assertEquals(HEADER + fix(1000), text(file));
        log.append(FixLog.pauseLine(1500L), 200L);
        log.close();
        assertEquals(HEADER + fix(1000) + "[\"pause\",1500]\n", FixLog.read(file, null));
    }

    @Test
    public void memeSessionCompleteeApresUneLigneVideEtStart() throws IOException {
        File file = folder.newFile("meme.jsonl");
        // Processus tué en pleine écriture : la dernière ligne est coupée, sans saut de ligne.
        write(file, HEADER + fix(1000) + "[2000,48.0");
        FixLog log = FixLog.open(file, SESSION, 9000L, 0L);
        assertTrue(log.resumed);
        log.append(fix(10000), 10L);
        log.close();
        assertEquals(HEADER + fix(1000) + "[2000,48.0\n[\"start\",9000]\n" + fix(10000), text(file));
    }

    @Test
    public void autreSessionRemplacee() throws IOException {
        File file = folder.newFile("autre.jsonl");
        write(file, FixLog.headerLine(SESSION - 1) + fix(1000) + fix(2000));
        FixLog log = FixLog.open(file, SESSION, 9000L, 0L);
        assertFalse(log.resumed);
        log.close();
        assertEquals(HEADER, text(file));
    }

    @Test
    public void enTeteIllisibleOuCoupeRemplace() throws IOException {
        for (String damaged : new String[] { "", "pas du json\n" + fix(1000), HEADER.substring(0, 30), HEADER.replace("\"version\":1", "\"version\":2") + fix(1000) }) {
            File file = new File(folder.getRoot(), "abime.jsonl");
            write(file, damaged);
            FixLog log = FixLog.open(file, SESSION, 9000L, 0L);
            assertFalse(damaged, log.resumed);
            log.close();
            assertEquals(damaged, HEADER, text(file));
        }
    }

    @Test
    public void ecritureForceeToutesLesDixSecondesEtALaFermeture() throws IOException {
        File file = new File(folder.getRoot(), "rythme.jsonl");
        FixLog log = FixLog.open(file, SESSION, 0L, 0L);
        assertEquals("L'en-tête est forcé sur le disque.", 1, log.syncCount);
        // À 1 Hz comme à 5 Hz, c'est le temps qui compte, pas le nombre de lignes.
        for (long t = 200; t < FixLog.SYNC_INTERVAL_MS; t += 200) log.append(fix(t), t);
        assertEquals(1, log.syncCount);
        log.append(fix(10000), FixLog.SYNC_INTERVAL_MS);
        assertEquals(2, log.syncCount);
        for (long t = 11000; t <= 19000; t += 1000) log.append(fix(t), t);
        assertEquals(2, log.syncCount);
        log.append(fix(20000), 20000L);
        assertEquals(3, log.syncCount);
        log.sync(20500L);
        assertEquals("À l'extinction du téléphone, sans attendre.", 4, log.syncCount);
        log.close();
        assertEquals(5, log.syncCount);
        log.close();
        assertEquals("Fermé deux fois sans effet.", 5, log.syncCount);
        try {
            log.append(fix(21000), 21000L);
            fail("Écriture acceptée sur un journal fermé.");
        } catch (IOException expected) {
            assertFalse(text(file).contains("[21000,"));
        }
    }

    @Test
    public void lectureSansFichierEtEffacement() throws IOException {
        File file = new File(folder.getRoot(), "absent.jsonl");
        assertNull(FixLog.read(file, null));
        assertNull(FixLog.read(file, 1000L));
        assertTrue("Rien à effacer.", FixLog.delete(file));
        write(file, HEADER + fix(1000));
        assertTrue(FixLog.delete(file));
        assertFalse(file.exists());
    }

    // ---------- fin de fichier rendue à la page ----------

    @Test
    public void finAPartirDeLaDernierePositionDejaConnue() {
        String text = HEADER + fix(1000) + fix(2000) + fix(3000) + fix(4000);
        // La position de 2000, déjà connue de la page, est gardée : elle prouve que le service n'a pas été interrompu.
        assertEquals(HEADER + fix(2000) + fix(3000) + fix(4000), FixLog.tail(text, 2000L));
        assertEquals(HEADER + fix(2000) + fix(3000) + fix(4000), FixLog.tail(text, 2999L));
    }

    @Test
    public void finAPartirDeLaDernierePositionQuandRienNEstNeuf() {
        String text = HEADER + fix(1000) + fix(2000) + "[\"pause\",2500]\n";
        assertEquals(HEADER + fix(2000) + "[\"pause\",2500]\n", FixLog.tail(text, 2000L));
        assertEquals(HEADER + fix(2000) + "[\"pause\",2500]\n", FixLog.tail(text, 9000L));
    }

    @Test
    public void fichierEntierQuandAucunePositionNePrecede() {
        String text = HEADER + "[\"pause\",500]\n" + fix(1000) + fix(2000);
        assertEquals(text, FixLog.tail(text, 999L));
        // La première position est déjà connue : l'ordre qui la précède l'est aussi.
        assertEquals(HEADER + fix(1000) + fix(2000), FixLog.tail(text, 1000L));
        String fromFirstLine = HEADER + fix(1000) + fix(2000);
        assertEquals("Rien à couper avant la première ligne.", fromFirstLine, FixLog.tail(fromFirstLine, 1000L));
        assertEquals(HEADER, FixLog.tail(HEADER, 1000L));
        assertEquals("sans saut de ligne", FixLog.tail("sans saut de ligne", 1000L));
    }

    @Test
    public void ordresEtRelanceGardesApresLaPositionConnue() {
        String text = HEADER + fix(1000) + "[\"pause\",1100]\n" + fix(2000) + "[\"resume\",2500]\n" + FixLog.startLine(2800L) + fix(3000)
            + FixLog.stopLine(3500L, FixLog.STOP_STILL);
        assertEquals(
            HEADER + fix(2000) + "[\"resume\",2500]\n" + FixLog.startLine(2800L) + fix(3000) + FixLog.stopLine(3500L, FixLog.STOP_STILL),
            FixLog.tail(text, 2000L)
        );
    }

    @Test
    public void positionAncienneRedonneeTardNeFaitPasSauterLesNeuves() {
        // Le téléphone redonne tard la position de 1500 : partir d'elle perdrait celles de 3000 et 4000.
        String text = HEADER + fix(1000) + fix(2000) + fix(3000) + fix(4000) + fix(1500) + fix(5000);
        assertEquals(HEADER + fix(2000) + fix(3000) + fix(4000) + fix(1500) + fix(5000), FixLog.tail(text, 2000L));
    }

    @Test
    public void ligneCoupeeOuIllisibleJamaisPriseCommePosition() {
        // Coupée par la mort du processus : elle commence comme une position, mais ne finit pas par son crochet.
        String text = HEADER + fix(1000) + "[2000,48.0,-4.0" + FixLog.startLine(2500L) + "illisible\n[\"x\",1]\n[]\n" + fix(3000);
        assertEquals(HEADER + fix(1000) + "[2000,48.0,-4.0" + FixLog.startLine(2500L) + "illisible\n[\"x\",1]\n[]\n" + fix(3000), FixLog.tail(text, 2000L));
        String cutAtEnd = HEADER + fix(1000) + fix(2000) + "[3000,48.0,-4.";
        assertEquals(HEADER + fix(2000) + "[3000,48.0,-4.", FixLog.tail(cutAtEnd, 3000L));
    }

    @Test
    public void lectureAvecHeureRendLaFinSeulement() throws IOException {
        File file = new File(folder.getRoot(), "long.jsonl");
        FixLog log = FixLog.open(file, SESSION, 0L, 0L);
        // Huit heures à 1 Hz, puis la minute que la page n'a pas reçue.
        for (int s = 1; s <= 8 * 3600 + 60; s++) log.append(fix(s * 1000L), s * 1000L);
        log.close();
        String tail = FixLog.read(file, 8 * 3600 * 1000L);
        assertTrue(tail.startsWith(HEADER + fix(8 * 3600 * 1000L) + fix(8 * 3600 * 1000L + 1000)));
        assertEquals(1 + 61, tail.split("\n").length);
        assertTrue("Le fichier entier pèse plus d'un mégaoctet.", file.length() > 1024 * 1024);
    }

    /** Ligne d'une position à l'heure `timeMs`, sans cap. */
    private static String fix(long timeMs) {
        return FixLog.fixLine(new FixLog.Fix(timeMs, 48.0 + timeMs * 1e-7, -4.0, 3.5, NONE, 4.25, NONE));
    }

    private static String text(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }

    private static void write(File file, String text) throws IOException {
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }
}
