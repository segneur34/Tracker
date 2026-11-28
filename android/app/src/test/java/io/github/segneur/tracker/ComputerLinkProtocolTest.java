package io.github.segneur.tracker;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import io.github.segneur.tracker.ComputerLinkProtocol.Endpoint;
import io.github.segneur.tracker.ComputerLinkProtocol.Frame;
import io.github.segneur.tracker.ComputerLinkProtocol.FrameDecoder;
import io.github.segneur.tracker.ComputerLinkProtocol.FrameException;
import io.github.segneur.tracker.ComputerLinkProtocol.Incoming;
import io.github.segneur.tracker.ComputerLinkProtocol.Json;
import io.github.segneur.tracker.ComputerLinkProtocol.ProbeAnswer;
import io.github.segneur.tracker.ComputerLinkProtocol.RemoteFile;
import io.github.segneur.tracker.ComputerLinkProtocol.WriteSession;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.BeforeClass;
import org.junit.Test;

/**
 * La liaison sans fil côté téléphone, éprouvée sur les jeux d'essai que les tests du PC relisent aussi
 * (bureau/sansFil.vecteurs.json, lu dans le dépôt sans copie) : trames valides et invalides, messages de l'échange
 * SPAKE2 (parts et confirmations transportées, calculées par la page), hachage du jeton, paquets de la découverte
 * (versions 1 et 2) ; puis ce que le téléphone ajoute de son côté (messages reçus, chemins demandés, adresses, ordre
 * des PC trouvés, JSON strict).
 */
public class ComputerLinkProtocolTest {

    private static Map<String, Object> vectors;

    /** Le fichier des jeux d'essai, cherché en remontant depuis le dossier où Gradle lance les tests (android/app). */
    @BeforeClass
    public static void readVectors() throws Exception {
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        File found = null;
        for (File d = dir; d != null && found == null; d = d.getParentFile()) {
            File candidate = new File(d, "bureau/sansFil.vecteurs.json");
            if (candidate.isFile()) found = candidate;
        }
        assertNotNull("bureau/sansFil.vecteurs.json introuvable au-dessus de " + dir, found);
        vectors = map(Json.parse(new String(Files.readAllBytes(found.toPath()), StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object v) {
        return (Map<String, Object>) v;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object v) {
        return (List<Object>) v;
    }

    private static byte[] hex(Object text) {
        String s = (String) text;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        return out;
    }

    private static List<Frame> decodeAll(byte[] bytes, ComputerLinkProtocol.Limits limits) throws FrameException {
        FrameDecoder decoder = new FrameDecoder(limits);
        List<Frame> frames = decoder.push(bytes, 0, bytes.length);
        decoder.end();
        return frames;
    }

    private static Frame frameOf(String json, byte[] body) throws Exception {
        return new Frame(map(Json.parse(json)), body);
    }

    private static String reasonOf(Runnable action) {
        try {
            action.run();
        } catch (Failure f) {
            return f.reason;
        }
        return null;
    }

    /** Une `FrameException` passée dans une exception non vérifiée, pour les tableaux de cas. */
    private static final class Failure extends RuntimeException {
        final String reason;

        Failure(FrameException e) {
            super(e);
            reason = e.reason;
        }
    }

    private static String readReason(String json, byte[] body) {
        return reasonOf(() -> {
            try {
                ComputerLinkProtocol.readMessage(frameOf(json, body));
            } catch (FrameException e) {
                throw new Failure(e);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
    }

    // ---------- jeux d'essai communs ----------

    @Test
    public void tramesDuPcDecodeesEtReencodeesOctetPourOctet() throws Exception {
        for (Object o : list(vectors.get("trames"))) {
            Map<String, Object> v = map(o);
            byte[] bytes = hex(v.get("octetsHex"));
            List<Frame> frames = decodeAll(bytes, ComputerLinkProtocol.LIMITS);
            assertEquals((String) v.get("nom"), 1, frames.size());
            assertEquals((String) v.get("nom"), v.get("enTete"), frames.get(0).header);
            assertArrayEquals((String) v.get("nom"), hex(v.get("corpsHex")), frames.get(0).body);
            assertArrayEquals((String) v.get("nom"), bytes, ComputerLinkProtocol.encodeFrame(map(v.get("enTete")), hex(v.get("corpsHex")), ComputerLinkProtocol.LIMITS));
        }
    }

    @Test
    public void tramesRecuesOctetParOctetEtToutesEnUnSeulMorceau() throws Exception {
        List<Object> all = list(vectors.get("trames"));
        java.io.ByteArrayOutputStream stream = new java.io.ByteArrayOutputStream();
        for (Object o : all) stream.write(hex(map(o).get("octetsHex")));
        byte[] bytes = stream.toByteArray();

        FrameDecoder byByte = new FrameDecoder(ComputerLinkProtocol.LIMITS);
        List<Frame> frames = new ArrayList<>();
        for (byte b : bytes) frames.addAll(byByte.push(new byte[] { b }, 0, 1));
        byByte.end();
        assertEquals(all.size(), frames.size());

        List<Frame> together = decodeAll(bytes, ComputerLinkProtocol.LIMITS);
        assertEquals(all.size(), together.size());
        for (int i = 0; i < all.size(); i++) {
            assertEquals(map(all.get(i)).get("enTete"), frames.get(i).header);
            assertEquals(map(all.get(i)).get("enTete"), together.get(i).header);
        }
    }

    @Test
    public void tramesInvalidesRefuseesAvecLaRaisonDuPc() {
        for (Object o : list(vectors.get("tramesInvalides"))) {
            Map<String, Object> v = map(o);
            byte[] bytes = hex(v.get("octetsHex"));
            FrameDecoder decoder = new FrameDecoder(ComputerLinkProtocol.LIMITS);
            String reason = null;
            boolean atPush = false;
            try {
                decoder.push(bytes, 0, bytes.length);
                decoder.end();
            } catch (FrameException e) {
                reason = e.reason;
            }
            try {
                decoder.push(new byte[0], 0, 0);
            } catch (FrameException e) {
                atPush = true;
            }
            assertEquals((String) v.get("nom"), v.get("erreur"), reason);
            assertTrue((String) v.get("nom") + " : décodeur hors d'usage après l'erreur", atPush);
        }
    }

    @Test
    public void tronqueeSeulementQuandLeFluxSArrete() throws Exception {
        byte[] ping = hex("00000016000000007b2274797065223a2270696e67222c226964223a31");
        FrameDecoder decoder = new FrameDecoder(ComputerLinkProtocol.LIMITS);
        assertEquals(0, decoder.push(ping, 0, ping.length).size());
        assertEquals(1, decoder.push(new byte[] { 0x7d }, 0, 1).size());
        decoder.end();
    }

    /** Le premier cas de l'échange SPAKE2 des jeux d'essai, celui que portent ses trames. */
    private static Map<String, Object> firstSpake2Case() {
        return map(list(map(vectors.get("spake2")).get("cas")).get(0));
    }

    private static Incoming readVectorFrame(String name) throws Exception {
        return ComputerLinkProtocol.readMessage(decodeAll(vectorFrame(name), ComputerLinkProtocol.WELCOME_LIMITS).get(0));
    }

    @Test
    public void echangeSpake2TransporteOctetPourOctet() throws Exception {
        Map<String, Object> cas = firstSpake2Case();
        // Le téléphone envoie sa part dans `appairer`, capacités en dernier, puis sa confirmation dans `preuve`.
        assertArrayEquals(vectorFrame("appairer, échange SPAKE2"), ComputerLinkProtocol.encodePair(
            "Pixel 8", hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"), hex(cas.get("partAHex"))));
        assertArrayEquals(vectorFrame("preuve, confirmation du téléphone"), ComputerLinkProtocol.encodeProof(hex(cas.get("confirmationAHex"))));
        // Il lit la part du PC dans `defi`, puis sa confirmation, le jeton, l'identifiant et le nom dans `appaire`.
        Incoming defi = readVectorFrame("defi, échange SPAKE2");
        assertEquals("defi", defi.type);
        assertArrayEquals(hex(cas.get("partBHex")), defi.partB);
        assertArrayEquals(hex("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"), defi.noncePc);
        Incoming appaire = readVectorFrame("appaire, confirmation du PC");
        assertEquals("appaire", appaire.type);
        assertArrayEquals(hex(cas.get("confirmationBHex")), appaire.proof);
        assertArrayEquals(hex("c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf"), appaire.token);
        assertArrayEquals(hex("101112131415161718191a1b1c1d1e1f"), appaire.computerId);
        assertEquals("BUREAU", appaire.computerName);
        assertEquals(ComputerLinkProtocol.PART_SIZE, defi.partB.length);
        assertEquals(ComputerLinkProtocol.CONFIRMATION_SIZE, appaire.proof.length);
    }

    @Test
    public void defiDUnPcAncienSansPartEtPartMalFormeeRefusee() throws Exception {
        String nonce = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
        // PC resté à l'ancien échange : `defi` sans part, lu sans erreur ; la page s'arrête alors sur « version ».
        Incoming old = ComputerLinkProtocol.readMessage(frameOf("{\"type\":\"defi\",\"noncePc\":\"" + nonce + "\"}", new byte[0]));
        assertNull(old.partB);
        String part = (String) firstSpake2Case().get("partBHex");
        String[] wrong = { part.substring(2), part + "00", part.toUpperCase(java.util.Locale.ROOT), "null" };
        for (String w : wrong) {
            String value = "null".equals(w) ? "null" : "\"" + w + "\"";
            assertEquals(w, ComputerLinkProtocol.INVALID_MESSAGE, readReason("{\"type\":\"defi\",\"noncePc\":\"" + nonce + "\",\"partB\":" + value + "}", new byte[0]));
        }
    }

    @Test
    public void hachageDuJeton() {
        for (Object o : list(vectors.get("jetons"))) {
            Map<String, Object> v = map(o);
            assertEquals(v.get("hachageHex"), ComputerLinkProtocol.tokenHash(hex(v.get("jetonHex"))));
        }
    }

    @Test
    public void questionsEtReponsesDeLaDecouverteIdentifiantSousTrace() {
        Map<String, Object> sondes = map(vectors.get("sondes"));
        int questions = 0;
        for (Object o : list(sondes.get("questions"))) {
            Map<String, Object> v = map(o);
            byte[] bytes = hex(v.get("octetsHex"));
            assertArrayEquals(bytes, ComputerLinkProtocol.encodeQuestion(hex(v.get("nonceHex"))));
            assertEquals(ComputerLinkProtocol.PROBE_VERSION_2, bytes[4]);
            assertNull(ComputerLinkProtocol.decodeAnswer(bytes));
            questions++;
        }
        assertTrue(questions >= 1);
        int seen = 0;
        for (Object o : list(sondes.get("reponses"))) {
            Map<String, Object> v = map(o);
            byte[] bytes = hex(v.get("octetsHex"));
            byte[] nonce = hex(v.get("nonceHex"));
            byte[] computerId = hex(v.get("identifiantPcHex"));
            byte[] trace = hex(v.get("identifiantSondeHex"));
            int port = ((Double) v.get("port")).intValue();
            assertArrayEquals(trace, ComputerLinkProtocol.probeId(computerId, nonce));
            assertArrayEquals(bytes, ComputerLinkProtocol.encodeAnswer(new ProbeAnswer(nonce, port, trace)));
            ProbeAnswer read = ComputerLinkProtocol.decodeAnswer(bytes);
            assertNotNull(read);
            assertArrayEquals(nonce, read.nonce);
            assertEquals(port, read.port);
            assertArrayEquals(trace, read.trace);
            // Seul le téléphone qui connaît l'identifiant reconnaît son PC ; la trace ne resert pas pour une autre question.
            assertTrue(ComputerLinkProtocol.answerFrom(read, computerId, nonce));
            byte[] otherId = computerId.clone();
            otherId[0] ^= 1;
            assertFalse(ComputerLinkProtocol.answerFrom(read, otherId, nonce));
            byte[] otherNonce = nonce.clone();
            otherNonce[15] ^= 1;
            assertFalse(ComputerLinkProtocol.answerFrom(read, computerId, otherNonce));
            // L'identifiant en clair à la place de sa trace ne passe pas.
            assertFalse(ComputerLinkProtocol.answerFrom(new ProbeAnswer(nonce, port, computerId), computerId, nonce));
            seen++;
        }
        assertTrue(seen >= 2);
        for (Object o : list(sondes.get("etrangers"))) {
            Map<String, Object> v = map(o);
            assertNull((String) v.get("nom"), ComputerLinkProtocol.decodeAnswer(hex(v.get("octetsHex"))));
        }
    }

    @Test
    public void reponseDeVersion1IgnoreeMemeAvecLIdentifiantDuPcEnClair() {
        // La réponse d'un programme Windows qui servirait encore l'identifiant en clair, à la question de ce nonce et
        // de ce PC : écartée comme un paquet étranger, jamais retenue.
        Map<String, Object> sondes = map(vectors.get("sondes"));
        Map<String, Object> neuve = map(list(sondes.get("reponses")).get(0));
        byte[] nonce = hex(neuve.get("nonceHex"));
        byte[] computerId = hex(neuve.get("identifiantPcHex"));
        int found = 0;
        for (Object o : list(sondes.get("etrangers"))) {
            Map<String, Object> v = map(o);
            if (!((String) v.get("nom")).startsWith("réponse de version 1")) continue;
            byte[] bytes = hex(v.get("octetsHex"));
            assertEquals(1, bytes[4]);
            assertNull((String) v.get("nom"), ComputerLinkProtocol.decodeAnswer(bytes));
            found++;
        }
        assertTrue(found >= 2);
        // Fabriquée ici, du nonce et de l'identifiant de la réponse neuve : même disposition, octet de version 1.
        byte[] plain = ComputerLinkProtocol.encodeAnswer(new ProbeAnswer(nonce, 48247, computerId));
        plain[4] = 1;
        assertNull(ComputerLinkProtocol.decodeAnswer(plain));
        // La question du téléphone ne part qu'à l'octet 2.
        assertEquals(ComputerLinkProtocol.PROBE_VERSION_2, ComputerLinkProtocol.encodeQuestion(nonce)[4]);
        assertEquals(2, ComputerLinkProtocol.PROBE_VERSION_2);
    }

    @Test
    public void portsEtSignatureDeTrackerJamaisCeuxDeGtracker() {
        assertArrayEquals("TRKR".getBytes(StandardCharsets.US_ASCII), ComputerLinkProtocol.PROBE_SIGNATURE);
        assertEquals(48247, ComputerLinkProtocol.PORT);
        assertEquals(48248, ComputerLinkProtocol.PROBE_PORT);
        assertEquals("tracker-sonde", ComputerLinkProtocol.PROBE_LABEL);
        // La réponse d'un PC Gtracker, même bien formée pour ce nonce, est un paquet étranger.
        Map<String, Object> neuve = map(list(map(vectors.get("sondes")).get("reponses")).get(0));
        byte[] gtrk = hex(neuve.get("octetsHex"));
        System.arraycopy("GTRK".getBytes(StandardCharsets.US_ASCII), 0, gtrk, 0, 4);
        assertNull(ComputerLinkProtocol.decodeAnswer(gtrk));
    }

    @Test
    public void pcTrouvesEssayesDansLOrdreDArriveeUneFoisChacunQuatreAuPlus() {
        ComputerLinkProtocol.Candidates<String> found = new ComputerLinkProtocol.Candidates<>(ComputerLinkProtocol.CANDIDATES_MAX);
        assertTrue(found.isEmpty());
        assertTrue(found.add("192.168.1.30", "premier"));
        assertTrue(found.add("192.168.1.20", "deuxième"));
        // La même adresse : pas doublée, la première réponse reste.
        assertFalse(found.add("192.168.1.20", "deuxième, encore"));
        assertTrue(found.add("192.168.1.40", "troisième"));
        assertEquals(Arrays.asList("premier", "deuxième", "troisième"), found.ordered());
        assertFalse(found.full());
        assertTrue(found.add("192.168.1.50", "quatrième"));
        assertTrue(found.full());
        assertFalse(found.add("192.168.1.60", "cinquième"));
        assertEquals(Arrays.asList("premier", "deuxième", "troisième", "quatrième"), found.ordered());
        assertEquals(4, ComputerLinkProtocol.CANDIDATES_MAX);
    }

    @Test
    public void unAppareilQuiRepondSurQuatrePortsNePrendQuUnePlace() {
        ComputerLinkProtocol.Candidates<String> found = new ComputerLinkProtocol.Candidates<>(ComputerLinkProtocol.CANDIDATES_MAX);
        // Quatre réponses d'une même adresse, sur quatre ports (la clé est l'adresse seule, comme dans `discover`).
        ComputerLinkProtocol.Endpoint[] bruit = {
            new ComputerLinkProtocol.Endpoint("192.168.1.66", 40001),
            new ComputerLinkProtocol.Endpoint("192.168.1.66", 40002),
            new ComputerLinkProtocol.Endpoint("192.168.1.66", 40003),
            new ComputerLinkProtocol.Endpoint("192.168.1.66", 40004),
        };
        assertTrue(found.add(bruit[0].host, bruit[0].toString()));
        for (int i = 1; i < bruit.length; i++) assertFalse(found.add(bruit[i].host, bruit[i].toString()));
        assertFalse(found.full());
        // Le vrai PC, d'une autre adresse, entre encore.
        ComputerLinkProtocol.Endpoint pc = new ComputerLinkProtocol.Endpoint("192.168.1.20", 48247);
        assertTrue(found.add(pc.host, pc.toString()));
        assertEquals(Arrays.asList("192.168.1.66:40001", "192.168.1.20:48247"), found.ordered());
    }

    @Test
    public void aucuneSuiteTlsAnonymeSansChiffrementOuDExportation() {
        String[] offered = {
            "TLS_AES_128_GCM_SHA256",
            "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
            "TLS_ECDH_anon_WITH_AES_128_CBC_SHA",
            "TLS_DH_anon_WITH_AES_256_GCM_SHA384",
            "TLS_RSA_WITH_NULL_SHA256",
            "TLS_ECDHE_RSA_WITH_NULL_SHA",
            "SSL_RSA_EXPORT_WITH_RC4_40_MD5",
            "TLS_EMPTY_RENEGOTIATION_INFO_SCSV",
        };
        assertEquals(
            Arrays.asList("TLS_AES_128_GCM_SHA256", "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256", "TLS_EMPTY_RENEGOTIATION_INFO_SCSV"),
            Arrays.asList(ComputerLinkProtocol.authenticatedSuites(offered))
        );
    }

    /** La trame d'un jeu d'essai, par son nom. */
    private static byte[] vectorFrame(String name) {
        for (Object o : list(vectors.get("trames"))) if (name.equals(map(o).get("nom"))) return hex(map(o).get("octetsHex"));
        throw new AssertionError("jeu d'essai absent : " + name);
    }

    @Test
    public void messagesDuTelephoneEcritsCommeLeFaitLePc() throws Exception {
        assertArrayEquals(vectorFrame("appairer, échange SPAKE2"), ComputerLinkProtocol.encodePair("Pixel 8", hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"), hex(firstSpake2Case().get("partAHex"))));
        assertArrayEquals(vectorFrame("bloc de 5 octets"), ComputerLinkProtocol.encodeBlock(7, 0, "hello-et-plus".getBytes(StandardCharsets.UTF_8), 5));
        List<RemoteFile> files = Arrays.asList(new RemoteFile("sessions/été.gpx", 1234, 1790000000000L));
        assertArrayEquals(vectorFrame("liste, chemin accentué"), ComputerLinkProtocol.encodeList(2, files));
        List<RemoteFile> five = Arrays.asList(
            new RemoteFile("sessions/2026-11-21 wing.gpx", 11, 1795000003000L),
            new RemoteFile("reglages/pixel-8.json", 512, 1795000002000L),
            new RemoteFile("autre/x.json", 1, 1),
            new RemoteFile("corbeille/1795647914477-1795000000000/2026-11-21 wing.gpx", 11, 1),
            new RemoteFile("journaux/2026-11-21 09-30.txt", 300, 1795000005000L),
            new RemoteFile("tracker.json", 120, 1795000000000L),
            new RemoteFile("itineraires/tour du lac.json.tracker-new", 3, 1),
            new RemoteFile("itineraires/tour du lac.json", 2048, 1795000001000L)
        );
        assertArrayEquals(vectorFrame("liste des cinq dossiers"), ComputerLinkProtocol.encodeList(3, five));
        // Le listage complet garde tout, provisoires, corbeille et sous-dossiers compris, trié par chemin.
        List<ComputerLinkProtocol.RawFile> all = Arrays.asList(
            new ComputerLinkProtocol.RawFile("tracker.json", 120, 1795000000000L, true),
            new ComputerLinkProtocol.RawFile("sessions/vieux/a.gpx", 5, 1790000000000L, true),
            new ComputerLinkProtocol.RawFile("photos/lien", 0, 1795000000000L, false),
            new ComputerLinkProtocol.RawFile("sessions/2026-11-22.gpx.tracker-new", 7, 1795000006000L, true),
            new ComputerLinkProtocol.RawFile("corbeille/corbeille.json", 90, 1795647914000L, true),
            new ComputerLinkProtocol.RawFile("corbeille/1795647914477-1795000000000/2026-11-21 wing.gpx", 11, 1795000003000L, true)
        );
        assertArrayEquals(vectorFrame("listeTout, dossier entier"), ComputerLinkProtocol.encodeListAll(22, all));
        assertArrayEquals(vectorFrame("listeCorbeille"), ComputerLinkProtocol.encodeTrashList(18, Arrays.asList("1795647914477-tour du lac", "1795647914477-1795000000000", "1795647914477-tour du lac", "")));
        assertArrayEquals(vectorFrame("pong, téléphone qui enregistre"), ComputerLinkProtocol.encodePong(5, true));
        assertArrayEquals(vectorFrame("pong, téléphone libre"), ComputerLinkProtocol.encodePong(6, false));
        assertArrayEquals(vectorFrame("fait"), ComputerLinkProtocol.encodeDone(10));
        assertArrayEquals(vectorFrame("ecrit"), ComputerLinkProtocol.encodeWritten(13, "sessions/2026-11-21 wing.gpx", 11, 1795000004000L));
        assertArrayEquals(vectorFrame("erreur, téléphone qui enregistre"), ComputerLinkProtocol.encodeError(14, ComputerLinkProtocol.ERROR_PERMISSION, ComputerLinkCommands.RECORDING_REFUSAL));
    }

    @Test
    public void listageCompletRefuseUnElementQueLePcTiendraitPourMalForme() throws Exception {
        String longPath = new String(new char[ComputerLinkProtocol.RAW_PATH_MAX + 1]).replace('\0', 'a');
        ComputerLinkProtocol.RawFile[] wrong = {
            new ComputerLinkProtocol.RawFile("", 1, 1, true),
            new ComputerLinkProtocol.RawFile(longPath, 1, 1, true),
            new ComputerLinkProtocol.RawFile("a", -1, 1, true),
            new ComputerLinkProtocol.RawFile("a", 1, -1, true),
            new ComputerLinkProtocol.RawFile("a", ComputerLinkProtocol.MAX_SAFE_INTEGER + 1, 1, true),
        };
        for (ComputerLinkProtocol.RawFile f : wrong) {
            try {
                ComputerLinkProtocol.encodeListAll(1, Arrays.asList(new ComputerLinkProtocol.RawFile("tracker.json", 1, 1, true), f));
                fail(f.path.length() + " " + f.size + " " + f.dateMs);
            } catch (IllegalArgumentException e) {
                // attendu : rien ne part plutôt qu'une réponse que le PC rejetterait entière
            }
        }
        String max = longPath.substring(1);
        assertTrue(ComputerLinkProtocol.rawFileAllowed(new ComputerLinkProtocol.RawFile(max, 0, 0, false)));
    }

    @Test
    public void bonjourAnnonceLaCapaciteDEcritureEnDernierChamp() throws Exception {
        String token = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
        Map<String, Object> expected = new LinkedHashMap<>(map(Json.parse(new String(Arrays.copyOfRange(vectorFrame("bonjour sans capacité"), 8, vectorFrame("bonjour sans capacité").length), StandardCharsets.UTF_8))));
        expected.put("capacites", Arrays.asList((Object) "ecriture"));
        assertArrayEquals(ComputerLinkProtocol.encodeFrame(expected, new byte[0], ComputerLinkProtocol.LIMITS), ComputerLinkProtocol.encodeHello("Pixel 8", hex(token)));
        assertEquals(Arrays.asList("ecriture"), ComputerLinkProtocol.CAPABILITIES);
        // `appairer` annonce en plus l'échange SPAKE2, comme dans le jeu d'essai que le PC relit.
        assertEquals(Arrays.asList("ecriture", "spake2"), ComputerLinkProtocol.PAIR_CAPABILITIES);
        Map<String, Object> pair = null;
        for (Object o : list(vectors.get("trames"))) if ("appairer, échange SPAKE2".equals(map(o).get("nom"))) pair = map(map(o).get("enTete"));
        assertNotNull(pair);
        assertEquals(new ArrayList<Object>(ComputerLinkProtocol.PAIR_CAPABILITIES), pair.get("capacites"));
    }

    // ---------- commandes d'écriture ----------

    @Test
    public void chaqueCommandeDuPcDesJeuxDEssaiEstLueSansErreur() throws Exception {
        int seen = 0;
        for (Object o : list(vectors.get("trames"))) {
            Map<String, Object> v = map(o);
            if (!"pc".equals(v.get("emetteur"))) continue;
            Incoming m = ComputerLinkProtocol.readMessage(decodeAll(hex(v.get("octetsHex")), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
            assertEquals((String) v.get("nom"), map(v.get("enTete")).get("type"), m.type);
            seen++;
        }
        assertTrue(seen >= 8);
    }

    @Test
    public void messagesInvalidesDuPcRefusesAvecLaRaisonDuPc() throws Exception {
        int seen = 0;
        for (Object o : list(vectors.get("messagesInvalides"))) {
            Map<String, Object> v = map(o);
            if (!"pc".equals(v.get("emetteur"))) continue;
            List<Frame> frames = decodeAll(hex(v.get("octetsHex")), ComputerLinkProtocol.LIMITS);
            assertEquals((String) v.get("nom"), 1, frames.size());
            String reason = null;
            try {
                ComputerLinkProtocol.readMessage(frames.get(0));
            } catch (FrameException e) {
                reason = e.reason;
            }
            assertEquals((String) v.get("nom"), v.get("erreur"), reason);
            seen++;
        }
        assertTrue(seen >= 15);
    }

    @Test
    public void ecrireValiderEtDeplacerLus() throws Exception {
        Incoming last = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("ecrire, dernier bloc"), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
        assertEquals("ecrire", last.type);
        assertEquals(11, last.id);
        assertEquals("sessions/2026-11-21 wing.gpx", last.path);
        assertEquals(5, last.start);
        assertEquals(11, last.size);
        assertEquals(6, last.length);
        assertArrayEquals("</gpx>".getBytes(StandardCharsets.UTF_8), last.body);
        Incoming empty = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("ecrire, fichier vide"), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
        assertEquals(0, empty.size);
        assertEquals(0, empty.body.length);
        Incoming valider = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("valider"), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
        assertEquals(13, valider.id);
        assertEquals(11, valider.size);
        Incoming deplacer = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("deplacer, itinéraire vers la corbeille"), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
        assertEquals("deplacer", deplacer.type);
        assertEquals(17, deplacer.id);
        assertEquals("itineraires/tour du lac.json", deplacer.path);
        assertEquals(2048, deplacer.size);
        assertEquals(1795000001000L, deplacer.dateMs);
        assertEquals("corbeille/1795647914477-tour du lac/tour du lac.json", deplacer.to);
        assertEquals(22, ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("listerTout"), ComputerLinkProtocol.COMMAND_LIMITS).get(0)).id);
        assertEquals(18, ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("listerCorbeille"), ComputerLinkProtocol.COMMAND_LIMITS).get(0)).id);
        Incoming raw = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("lire, provisoire du listage complet"), ComputerLinkProtocol.COMMAND_LIMITS).get(0));
        assertEquals("sessions/2026-11-22.gpx.tracker-new", raw.path);
    }

    @Test
    public void effacerNExistePasDansCeProtocole() {
        // Même bien formé, même avec un chemin écrivable : un message inconnu, qui ferme la liaison.
        assertEquals(ComputerLinkProtocol.UNKNOWN_MESSAGE, readReason("{\"type\":\"effacer\",\"id\":1,\"chemin\":\"sessions/a.gpx\"}", new byte[0]));
        assertEquals(ComputerLinkProtocol.UNKNOWN_MESSAGE, readReason("{\"type\":\"effacer\",\"id\":1,\"chemin\":\"sessions/a.gpx\"}", new byte[] { 1 }));
    }

    @Test
    public void unBlocDEcritureDUnMioPasseUneFoisReliePasALAccueil() throws Exception {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("type", "ecrire");
        h.put("id", 1L);
        h.put("chemin", "sessions/a.gpx");
        h.put("debut", 0L);
        h.put("taille", (long) ComputerLinkProtocol.BLOCK_SIZE);
        byte[] frame = ComputerLinkProtocol.encodeFrame(h, new byte[ComputerLinkProtocol.BLOCK_SIZE], ComputerLinkProtocol.LIMITS);
        assertEquals(ComputerLinkProtocol.BLOCK_SIZE, ComputerLinkProtocol.readMessage(decodeAll(frame, ComputerLinkProtocol.COMMAND_LIMITS).get(0)).length);
        try {
            decodeAll(frame, ComputerLinkProtocol.WELCOME_LIMITS);
            fail();
        } catch (FrameException e) {
            assertEquals(ComputerLinkProtocol.BODY_TOO_LONG, e.reason);
        }
    }

    @Test
    public void cheminsDeLectureEtDEcritureCommeLePc() {
        Map<String, Object> liste = map(vectors.get("cheminsListe"));
        for (Object p : list(liste.get("admis"))) assertTrue((String) p, ComputerLinkProtocol.pathAllowed((String) p));
        for (Object p : list(liste.get("refuses"))) assertFalse((String) p, ComputerLinkProtocol.pathAllowed((String) p));
        Map<String, Object> lecture = map(vectors.get("cheminsLecture"));
        for (Object p : list(lecture.get("admis"))) assertTrue((String) p, ComputerLinkProtocol.readAllowed((String) p));
        for (Object p : list(lecture.get("refuses"))) assertFalse((String) p, ComputerLinkProtocol.readAllowed((String) p));
        Map<String, Object> ecriture = map(vectors.get("cheminsEcriture"));
        for (Object p : list(ecriture.get("admis"))) assertTrue((String) p, ComputerLinkProtocol.writeAllowed((String) p));
        for (Object p : list(ecriture.get("refuses"))) assertFalse((String) p, ComputerLinkProtocol.writeAllowed((String) p));
        assertFalse(ComputerLinkProtocol.writeAllowed(null));
        Map<String, Object> retrait = map(vectors.get("cheminsRetrait"));
        for (Object p : list(retrait.get("admis"))) assertTrue((String) p, ComputerLinkProtocol.removeAllowed((String) p));
        for (Object p : list(retrait.get("refuses"))) assertFalse((String) p, ComputerLinkProtocol.removeAllowed((String) p));
        assertFalse(ComputerLinkProtocol.removeAllowed(null));
    }

    @Test
    public void destinationsDansLaCorbeilleCommeLePc() {
        Map<String, Object> corbeille = map(vectors.get("destinationsCorbeille"));
        assertEquals(ComputerLinkProtocol.TRASH_DIR, corbeille.get("depot"));
        int seen = 0;
        for (Object o : list(corbeille.get("admises"))) {
            Map<String, Object> v = map(o);
            assertTrue(v.toString(), ComputerLinkProtocol.trashDestinationAllowed((String) v.get("chemin"), (String) v.get("vers")));
            seen++;
        }
        for (Object o : list(corbeille.get("refusees"))) {
            Map<String, Object> v = map(o);
            assertFalse(v.toString(), ComputerLinkProtocol.trashDestinationAllowed((String) v.get("chemin"), (String) v.get("vers")));
            seen++;
        }
        assertTrue(seen >= 10);
        assertFalse(ComputerLinkProtocol.trashDestinationAllowed("sessions/a.gpx", null));
    }

    @Test
    public void sousDossiersDeLaCorbeilleNommesCommeParLePc() {
        String[] ok = {
            "1795647914477-a", "1795647914477-1795000000000-2", "1795647914477-Tour_ du lac_", "1795647914477-été 2026",
            "1795647914477-" + new String(new char[80]).replace('\0', 'a'), "1795647914477-a.b", "1795647914477-a-b",
        };
        for (String name : ok) assertTrue(name, ComputerLinkProtocol.depositFolderAllowed(name));
        String[] no = {
            null, "", "1795647914477", "1795647914477-", "179564791447-a", "17956479144770-a", "x795647914477-a",
            "1795647914477-a  b", "1795647914477- a", "1795647914477-a ", "1795647914477-a.", "1795647914477-a b",
            "1795647914477-a　b", "1795647914477-﻿a", "1795647914477-a\nb", "1795647914477-a b",
            "1795647914477-a:b", "1795647914477-a.tracker-tmp", "1795647914477-" + new String(new char[81]).replace('\0', 'a'),
            "corbeille", "2024-vacances",
        };
        for (String name : no) assertFalse(String.valueOf(name), ComputerLinkProtocol.depositFolderAllowed(name));
        // Les noms de JavaScript : U+0085 n'est pas un blanc pour lui, il reste dans l'identité comme un caractère.
        assertTrue(ComputerLinkProtocol.depositFolderAllowed("1795647914477-a\u0085b"));
    }

    @Test
    public void laNoteDUnDepotEstLeSeulFichierEcrivableDansLaCorbeille() {
        assertTrue(ComputerLinkProtocol.writeAllowed("corbeille/1795647914477-1795000000000/depose.json"));
        assertTrue(ComputerLinkProtocol.depositAllowed("corbeille/1795647914477-tour du lac-3/depose.json"));
        String[] no = {
            "corbeille/1795647914477-1795000000000/a.gpx", "corbeille/1795647914477-1795000000000/corbeille.json",
            "corbeille/depose.json", "corbeille/2024-vacances/depose.json", "Corbeille/1795647914477-a/depose.json",
            "corbeille/1795647914477-a/Depose.json", "corbeille/1795647914477-a/depose.json.tracker-new",
            "corbeille/1795647914477-a/sous/depose.json", "sessions/x/depose.json", "corbeille/1795647914477-a/",
        };
        for (String path : no) assertFalse(path, ComputerLinkProtocol.writeAllowed(path));
        // Rien d'autre sous la corbeille ne se lit comme un chemin listable ou retirable.
        assertFalse(ComputerLinkProtocol.pathAllowed("corbeille/1795647914477-a/depose.json"));
        assertFalse(ComputerLinkProtocol.removeAllowed("corbeille/1795647914477-a/depose.json"));
        assertTrue(ComputerLinkProtocol.readAllowed("corbeille/1795647914477-a/depose.json"));
    }

    @Test
    public void ecritureDansLOrdreDesBlocs() {
        WriteSession w = new WriteSession("sessions/a.gpx", 11, false);
        assertTrue(WriteSession.opens(0));
        assertFalse(WriteSession.opens(5));
        assertEquals(ComputerLinkProtocol.NEW_SUFFIX, w.suffix());
        w.wrote(5);
        assertFalse("pas encore complète", w.completes("sessions/a.gpx", 11));
        assertTrue(w.continues("sessions/a.gpx", 5, 11, 6));
        assertFalse("bloc en avance", w.continues("sessions/a.gpx", 6, 11, 5));
        assertFalse("bloc rejoué", w.continues("sessions/a.gpx", 0, 11, 5));
        assertFalse("autre chemin", w.continues("sessions/b.gpx", 5, 11, 6));
        assertFalse("taille changée en route", w.continues("sessions/a.gpx", 5, 12, 6));
        assertFalse("déborde la taille", w.continues("sessions/a.gpx", 5, 11, 7));
        w.wrote(6);
        assertEquals(11, w.written());
        assertTrue(w.completes("sessions/a.gpx", 11));
        assertFalse("taille fausse à la validation", w.completes("sessions/a.gpx", 12));
        assertFalse("autre chemin à la validation", w.completes("sessions/b.gpx", 11));
        try {
            w.wrote(1);
            fail();
        } catch (IllegalArgumentException e) {
            // attendu : rien au-delà de la taille annoncée
        }
        WriteSession empty = new WriteSession("reglages/pixel-8.json", 0, true);
        assertEquals(ComputerLinkProtocol.TEMP_SUFFIX, empty.suffix());
        empty.wrote(0);
        assertTrue(empty.completes("reglages/pixel-8.json", 0));
        assertEquals("a.gpx.tracker-tmp", ComputerLinkProtocol.provisionalName("a.gpx", true));
        assertEquals("a.gpx.tracker-new", ComputerLinkProtocol.provisionalName("a.gpx", false));
    }

    // ---------- messages reçus du PC ----------

    @Test
    public void commandesDuPcLues() throws Exception {
        Incoming lire = ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("lire, deuxième bloc"), ComputerLinkProtocol.WELCOME_LIMITS).get(0));
        assertEquals("lire", lire.type);
        assertEquals(7, lire.id);
        assertEquals("sessions/2026-11-20.gpx", lire.path);
        assertEquals(1048576, lire.start);
        assertEquals(1048576, lire.length);
        assertEquals(1, ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("ping"), ComputerLinkProtocol.WELCOME_LIMITS).get(0)).id);
        assertEquals("code", ComputerLinkProtocol.readMessage(decodeAll(vectorFrame("refus"), ComputerLinkProtocol.WELCOME_LIMITS).get(0)).reason);
        // Un entier écrit 1.0 est un entier pour JSON.parse comme ici.
        assertEquals(3, ComputerLinkProtocol.readMessage(frameOf("{\"type\":\"lister\",\"id\":3.0}", new byte[0])).id);

        String id16 = "101112131415161718191a1b1c1d1e1f";
        String h32 = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        Incoming appaire = ComputerLinkProtocol.readMessage(frameOf(
            "{\"type\":\"appaire\",\"preuve\":\"" + h32 + "\",\"jeton\":\"" + h32 + "\",\"identifiantPc\":\"" + id16 + "\",\"nomPc\":\"Bureau\",\"inconnu\":true}", new byte[0]));
        assertEquals("Bureau", appaire.computerName);
        assertArrayEquals(hex(id16), appaire.computerId);
        assertArrayEquals(hex(h32), appaire.token);
    }

    @Test
    public void messagesDuPcMalFormesRefuses() {
        String inv = ComputerLinkProtocol.INVALID_MESSAGE;
        String unk = ComputerLinkProtocol.UNKNOWN_MESSAGE;
        assertEquals(unk, readReason("{\"type\":\"liste\",\"id\":1,\"fichiers\":[]}", new byte[0]));
        assertEquals(unk, readReason("{\"type\":\"bloc\",\"id\":1,\"debut\":0,\"longueur\":0}", new byte[0]));
        assertEquals(unk, readReason("{\"type\":\"renommer\",\"id\":1}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ecrire\",\"id\":1}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"listerCorbeille\",\"id\":1}", new byte[] { 1 }));
        assertEquals(inv, readReason("{\"type\":\"listerTout\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"deplacer\",\"id\":1,\"chemin\":\"sessions/a.gpx\",\"taille\":1,\"dateMs\":1.5,\"vers\":\"corbeille/1795647914477-x/a.gpx\"}", new byte[0]));
        assertNull(readReason("{\"type\":\"deplacer\",\"id\":1,\"chemin\":\"sessions/a.gpx\",\"taille\":1,\"dateMs\":1,\"vers\":\"corbeille/1795647914477-x/a.gpx\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ping\",\"id\":1}", new byte[] { 1 }));
        assertEquals(inv, readReason("{\"type\":\"ping\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ping\",\"id\":\"1\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ping\",\"id\":-1}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ping\",\"id\":1.5}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"ping\",\"id\":2147483648}", new byte[0]));
        assertNull(readReason("{\"type\":\"ping\",\"id\":2147483647}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":\"a.gpx\",\"debut\":0,\"longueur\":0}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":\"a.gpx\",\"debut\":0,\"longueur\":1048577}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":\"a.gpx\",\"debut\":9007199254740992,\"longueur\":1}", new byte[0]));
        assertNull(readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":\"a.gpx\",\"debut\":9007199254740991,\"longueur\":1048576}", new byte[0]));
        for (String path : new String[] { "../a.gpx", "sessions/../../a", "/a.gpx", "CON.txt", "a.", "c:x", "sessions\\a.gpx", "", "sessions/", "a/./b", "sessions/con.gpx" }) {
            assertEquals(path, inv, readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":" + Json.write(path) + ",\"debut\":0,\"longueur\":1}", new byte[0]));
        }
        // Les noms réels du listage complet se relisent : sous-dossier, autre dossier, provisoire.
        for (String path : new String[] { "sessions/a/b.gpx", "autre/a.gpx", "sessions/a.gpx.tracker-tmp", "A.TRACKER-NEW", "corbeille/1795647914477-x/a.gpx" }) {
            assertNull(path, readReason("{\"type\":\"lire\",\"id\":1,\"chemin\":" + Json.write(path) + ",\"debut\":0,\"longueur\":1}", new byte[0]));
        }
        assertEquals(inv, readReason("{\"type\":\"defi\",\"noncePc\":\"00\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"defi\",\"noncePc\":\"000102030405060708090A0B0C0D0E0F101112131415161718191a1b1c1d1e1f\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"refus\",\"raison\":\"autre\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"bienvenue\",\"identifiantPc\":\"101112131415161718191a1b1c1d1e1f\",\"nomPc\":\"\"}", new byte[0]));
        assertEquals(inv, readReason("{\"type\":\"bienvenue\",\"identifiantPc\":\"101112131415161718191a1b1c1d1e1f\",\"nomPc\":\"a\\u0085b\"}", new byte[0]));
    }

    @Test
    public void limitesDeLAccueilSansCorpsEtEnTeteCourt() {
        byte[] withBody = hex("0000000f00000001");
        String reason = null;
        try {
            new FrameDecoder(ComputerLinkProtocol.WELCOME_LIMITS).push(withBody, 0, withBody.length);
        } catch (FrameException e) {
            reason = e.reason;
        }
        assertEquals(ComputerLinkProtocol.BODY_TOO_LONG, reason);
        byte[] longHeader = hex("0000400100000000");
        try {
            new FrameDecoder(ComputerLinkProtocol.WELCOME_LIMITS).push(longHeader, 0, longHeader.length);
            fail();
        } catch (FrameException e) {
            assertEquals(ComputerLinkProtocol.HEADER_TOO_LONG, e.reason);
        }
    }

    // ---------- chemins et fichiers ----------

    @Test
    public void cheminsAdmis() {
        for (String ok : new String[] { "a.gpx", "sessions/2026-11-20.gpx", "sessions/été.json", "index.json", "sessions/x.imu", "itineraires/a.json", "reglages/b.json" }) {
            assertTrue(ok, ComputerLinkProtocol.pathAllowed(ok));
        }
        for (String no : new String[] { "sessions/a/b", "x/a.gpx", "..", ".", "a/", "/a", "a//b", "nul", "Com1.json", "lpt¹.txt", "a ", "a?b", "a\u0001b", "a\u007fb", "x.tracker-tmp", "sessions/x.Tracker-New" }) {
            assertFalse(no, ComputerLinkProtocol.pathAllowed(no));
        }
        // « sessions » seul est un nom admis, comme côté PC : c'est la lecture qui refuse un dossier (NOT_FOUND).
        assertTrue(ComputerLinkProtocol.pathAllowed("sessions"));
    }

    @Test
    public void sousDossierDeLaMemoire() {
        // Absent ou vide : le dossier désigné est la mémoire elle-même, comme avant le sous-dossier.
        assertTrue(ComputerLinkProtocol.baseAllowed(null));
        assertTrue(ComputerLinkProtocol.baseAllowed(""));
        for (String ok : new String[] { "Tracker", "Mes documents/Tracker", "été", "a/b/c/d/e/f/g/h" }) {
            assertTrue(ok, ComputerLinkProtocol.baseAllowed(ok));
        }
        for (String no : new String[] {
            "..", ".", "../Tracker", "Tracker/..", "Tracker/../..", "a/./b", "/Tracker", "Tracker/", "a//b", "/",
            "C:\\Tracker", "C:/Tracker", "\\\\serveur\\partage", "content://autre/arbre", "Tracker\\..", "a\u0000b",
            "Tracker.tracker-tmp", "nul", "a/b/c/d/e/f/g/h/i",
        }) {
            assertFalse(no, ComputerLinkProtocol.baseAllowed(no));
        }
    }

    @Test
    public void cheminSousLeSousDossier() {
        assertEquals("sessions/a.json", ComputerLinkProtocol.inBase(null, "sessions/a.json"));
        assertEquals("index.json", ComputerLinkProtocol.inBase("", "index.json"));
        assertEquals("Tracker/sessions/a.json", ComputerLinkProtocol.inBase("Tracker", "sessions/a.json"));
        assertEquals("Mes documents/Tracker/index.json", ComputerLinkProtocol.inBase("Mes documents/Tracker", "index.json"));
    }

    @Test
    public void fichiersListesTriesSansDoublonNiTemporaire() {
        List<RemoteFile> files = Arrays.asList(
            new RemoteFile("sessions/b.gpx", 10, 1),
            new RemoteFile("index.json", 5, 2),
            new RemoteFile("sessions/a.gpx", 7, 3),
            new RemoteFile("sessions/a.gpx.tracker-tmp", 7, 3),
            new RemoteFile("sessions/d.gpx", 1, 4),
            new RemoteFile("sessions/d.gpx", 2, 4),
            new RemoteFile("sessions/n.gpx", -1, 4)
        );
        List<RemoteFile> kept = ComputerLinkProtocol.allowedFiles(files);
        List<String> paths = new ArrayList<>();
        for (RemoteFile f : kept) paths.add(f.path);
        assertEquals(Arrays.asList("index.json", "sessions/a.gpx", "sessions/b.gpx"), paths);
    }

    @Test
    public void erreurCoupeeEtCodeInconnuRendu() throws Exception {
        StringBuilder longText = new StringBuilder();
        for (int i = 0; i < 600; i++) longText.append('x');
        Frame frame = decodeAll(ComputerLinkProtocol.encodeError(4, "TOO_LARGE", longText.toString()), ComputerLinkProtocol.LIMITS).get(0);
        assertEquals("erreur", frame.type());
        assertEquals("UNKNOWN", frame.header.get("code"));
        assertEquals(500, ((String) frame.header.get("message")).length());
        assertEquals(4.0, frame.header.get("id"));
        assertEquals("NOT_FOUND", decodeAll(ComputerLinkProtocol.encodeError(1, "NOT_FOUND", "absent"), ComputerLinkProtocol.LIMITS).get(0).header.get("code"));
        Frame pong = decodeAll(ComputerLinkProtocol.encodePong(9, false), ComputerLinkProtocol.LIMITS).get(0);
        assertEquals("pong", pong.type());
        assertEquals(9.0, pong.header.get("id"));
        assertEquals(Boolean.FALSE, pong.header.get("enregistre"));
    }

    // ---------- appairage ----------

    @Test
    public void seulUnRefusDuJetonSurLiaisonEpingleeOublieLAppairage() {
        assertTrue(ComputerLinkProtocol.refusalForgetsPairing(ComputerLinkProtocol.REFUSED_TOKEN, true));
        // Pendant un appairage, un faux PC qui répond « jeton » n'efface rien.
        assertFalse(ComputerLinkProtocol.refusalForgetsPairing(ComputerLinkProtocol.REFUSED_TOKEN, false));
        String[] others = { ComputerLinkProtocol.REFUSED_CODE, ComputerLinkProtocol.REFUSED_WINDOW, ComputerLinkProtocol.REFUSED_NONCE,
            ComputerLinkProtocol.REFUSED_VERSION, "autre", null };
        for (String reason : others) {
            assertFalse(String.valueOf(reason), ComputerLinkProtocol.refusalForgetsPairing(reason, true));
            assertFalse(String.valueOf(reason), ComputerLinkProtocol.refusalForgetsPairing(reason, false));
        }
    }

    @Test
    public void codeDeSixChiffresSeulement() {
        assertTrue(ComputerLinkProtocol.codeAllowed("042917"));
        for (String no : new String[] { "42917", "0429170", "04291a", "０４２９１７", " 42917", null }) assertFalse(String.valueOf(no), ComputerLinkProtocol.codeAllowed(no));
        // Une part ou une confirmation de la mauvaise taille ne part jamais.
        try {
            ComputerLinkProtocol.encodeProof(new byte[31]);
            fail();
        } catch (IllegalArgumentException | FrameException e) {
            assertTrue(e instanceof IllegalArgumentException);
        }
        try {
            ComputerLinkProtocol.encodePair("Pixel 8", new byte[32], new byte[64]);
            fail();
        } catch (IllegalArgumentException | FrameException e) {
            assertTrue(e instanceof IllegalArgumentException);
        }
        assertTrue(ComputerLinkProtocol.sameBytes(new byte[] { 1, 2 }, new byte[] { 1, 2 }));
        assertFalse(ComputerLinkProtocol.sameBytes(new byte[] { 1, 2 }, new byte[] { 1, 3 }));
        assertFalse(ComputerLinkProtocol.sameBytes(new byte[] { 1 }, new byte[] { 1, 2 }));
    }

    @Test
    public void hexadecimalMinusculeDeLaTailleDite() {
        assertArrayEquals(new byte[] { 0x0a, (byte) 0xff }, ComputerLinkProtocol.fromHex("0aff", 2));
        assertNull(ComputerLinkProtocol.fromHex("0AFF", 2));
        assertNull(ComputerLinkProtocol.fromHex("0aff", 3));
        assertNull(ComputerLinkProtocol.fromHex("0g", 1));
        assertEquals("0aff", ComputerLinkProtocol.toHex(new byte[] { 0x0a, (byte) 0xff }));
    }

    // ---------- adresses ----------

    @Test
    public void adressesPriveesSeulement() {
        Endpoint e = ComputerLinkProtocol.parseEndpoint(" 192.168.1.20 ");
        assertEquals("192.168.1.20:48247", e.toString());
        assertEquals("10.0.0.5:48218", ComputerLinkProtocol.parseEndpoint("10.0.0.5:48218").toString());
        assertEquals("172.16.0.1:48247", ComputerLinkProtocol.parseEndpoint("172.16.0.1").toString());
        assertEquals("172.31.255.255:48247", ComputerLinkProtocol.parseEndpoint("172.31.255.255").toString());
        for (String no : new String[] { "8.8.8.8", "172.15.0.1", "172.32.0.1", "169.254.1.1", "127.0.0.1", "100.64.0.1", "192.168.1.300", "192.168.1", "pc.local", "192.168.1.2:0", "192.168.1.2:70000", "192.168.1.2:", "192.168.01.2x", "" }) {
            assertNull(no, ComputerLinkProtocol.parseEndpoint(no));
        }
    }

    @Test
    public void adresseDeDiffusion() {
        long a = ComputerLinkProtocol.parseIpv4("192.168.1.20");
        assertEquals("192.168.1.255", ComputerLinkProtocol.broadcastAddress(a, 24));
        assertEquals("192.168.255.255", ComputerLinkProtocol.broadcastAddress(a, 16));
        assertEquals("192.168.1.23", ComputerLinkProtocol.broadcastAddress(a, 30));
        assertEquals("192.168.1.20", ComputerLinkProtocol.broadcastAddress(a, 32));
        assertEquals("255.255.255.255", ComputerLinkProtocol.broadcastAddress(a, 0));
    }

    @Test
    public void memeReseauEtInterfacesMobilesEcartees() {
        long pc = ComputerLinkProtocol.parseIpv4("192.168.137.1");
        long phone = ComputerLinkProtocol.parseIpv4("192.168.137.54");
        assertTrue(ComputerLinkProtocol.sameSubnet(pc, phone, 24));
        assertFalse(ComputerLinkProtocol.sameSubnet(pc, ComputerLinkProtocol.parseIpv4("192.168.43.1"), 24));
        assertTrue(ComputerLinkProtocol.sameSubnet(pc, ComputerLinkProtocol.parseIpv4("192.168.43.1"), 16));
        assertFalse(ComputerLinkProtocol.sameSubnet(pc, -1, 24));
        for (String mobile : new String[] { "rmnet_data0", "rev_rmnet0", "ccmni1", "pdp_ip0", "v4-rmnet_data0", "clat4", "tun0", "ppp0", "ipsec0", "dummy0", "lo", "seth_lte0", "wwan0", null }) {
            assertTrue(String.valueOf(mobile), ComputerLinkProtocol.mobileInterfaceName(mobile));
        }
        for (String local : new String[] { "wlan0", "wlan1", "ap0", "swlan0", "eth0", "rndis0", "bt-pan" }) {
            assertFalse(local, ComputerLinkProtocol.mobileInterfaceName(local));
        }
    }

    @Test
    public void nomDuTelephone() {
        assertEquals("Pixel 8", ComputerLinkProtocol.deviceName("  Pixel 8\n"));
        assertEquals("Android", ComputerLinkProtocol.deviceName("\u0001\u0002"));
        assertEquals("Android", ComputerLinkProtocol.deviceName(null));
        StringBuilder longName = new StringBuilder();
        for (int i = 0; i < 99; i++) longName.append('a');
        longName.append("\uD83D\uDE00");
        String name = ComputerLinkProtocol.deviceName(longName.toString());
        assertEquals(99, name.length());
        assertTrue(ComputerLinkProtocol.nameAllowed(name));
    }

    // ---------- JSON ----------

    @Test
    public void jsonStrictCommeJsonParse() throws Exception {
        for (String no : new String[] { "{'a':1}", "{a:1}", "[1,]", "{\"a\":1,}", "01", "1.", ".5", "+1", "\"\t\"", "\"\\x\"", "\"\\u12\"", "tru", "1 2", "\uFEFF{}", "{\"a\" 1}" }) {
            try {
                Json.parse(no);
                fail(no);
            } catch (Json.JsonException e) {
                // attendu
            }
        }
        StringBuilder deep = new StringBuilder();
        for (int i = 0; i < 100; i++) deep.append('[');
        for (int i = 0; i < 100; i++) deep.append(']');
        try {
            Json.parse(deep.toString());
            fail("imbrication");
        } catch (Json.JsonException e) {
            // attendu
        }
        Map<String, Object> m = map(Json.parse(" {\"a\":1,\"b\":[true,false,null],\"a\":\"\\u00e9\\/\"} "));
        assertEquals("é/", m.get("a"));
        assertEquals(Arrays.asList(Boolean.TRUE, Boolean.FALSE, Json.NULL), m.get("b"));
        assertEquals(-12.5e3, (Double) Json.parse("-12.5e3"), 0);
    }

    @Test
    public void jsonEcritCommeJsonStringify() {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("type", "x");
        h.put("t", "a\"\\\n\u0001\u007f\uD800é\uD83D\uDE00");
        h.put("n", 1790000000000.0);
        h.put("l", 7L);
        assertEquals("{\"type\":\"x\",\"t\":\"a\\\"\\\\\\n\\u0001\u007f\\ud800é\uD83D\uDE00\",\"n\":1790000000000,\"l\":7}", Json.write(h));
    }
}
