package io.github.segneur.tracker;

import java.io.File;
import java.io.IOException;

/**
 * Le fichier des capteurs de référence, écrit par `ImuWriter` : toujours le
 * même contenu, à l'horloge et à l'appareil fixés ici, sans rien d'Android.
 *
 * `ImuFormatTest` l'écrit et le compare à `src/core/imuFile.reference.imu`,
 * que `src/core/imuFile.reference.test.ts` relit par le lecteur de la page et
 * vérifie à la main : un changement de ces mesures se reporte dans ce test.
 *
 * Refaire la référence (changement de format voulu, décrit d'abord en tête de
 * `src/core/imuFile.ts`) : `node outils/imu-reference.mjs`, depuis la racine ;
 * rien d'autre ne l'écrit, aucun test en particulier.
 */
final class ImuReference {

    private ImuReference() {
    }

    /**
     * Texte figé, dans l'ordre des clés de `MotionPlugin.header` (dont le
     * `JSONObject` n'existe pas hors d'Android). Les accents et l'euro font
     * différer les octets des caractères : la longueur écrite est en octets.
     */
    static final String HEADER_JSON = "{\"format\":\"tracker-capteurs\",\"version\":1,\"startedAtMs\":1790000000000,"
        + "\"clock\":{\"elapsedUs\":123456789000,\"wallMs\":1790000000150},"
        + "\"device\":{\"manufacturer\":\"Société d'essai\",\"model\":\"Téléphone €\",\"android\":36},"
        + "\"setup\":{\"placement\":\"poitrine\",\"foil\":true,\"jumps\":true,\"cadence\":false},"
        + "\"streams\":["
        + "{\"id\":0,\"kind\":\"accel\",\"axes\":3,\"unit\":0.01,\"offset\":0,"
        + "\"sensor\":{\"name\":\"Accéléromètre\",\"vendor\":\"Société d'essai\",\"maxRange\":78.5,\"resolution\":0.0025,\"minDelayUs\":2500}},"
        + "{\"id\":1,\"kind\":\"gyro\",\"axes\":3,\"unit\":0.002,\"offset\":0,"
        + "\"sensor\":{\"name\":\"Gyroscope\",\"vendor\":\"Société d'essai\",\"maxRange\":34.5,\"resolution\":0.001,\"minDelayUs\":2500}},"
        + "{\"id\":2,\"kind\":\"pressure\",\"axes\":1,\"unit\":0.01,\"offset\":1000,"
        + "\"sensor\":{\"name\":\"Baromètre\",\"vendor\":\"Société d'essai\",\"maxRange\":1260,\"resolution\":0.0099,\"minDelayUs\":40000}}"
        + "]}";

    private static final int ACCEL = 0;
    private static final int GYRO = 1;
    private static final int PRESSURE = 2;

    /** Premier instant du paquet 1 : plus de 2^32 µs, hors d'un entier de 32 bits comme d'un flottant de 32 bits. */
    private static final long T0 = 5_000_000_123L;
    private static final long T1 = 5_001_000_123L;
    private static final long T2 = 6_000_000_000L;
    /** Mesures du paquet 3 : une de plus que n'en tient un bloc. */
    private static final int LONG_BLOCK = 65_536;

    /** Écrit le fichier de référence ; `file` est remplacé. */
    static void write(File file) throws IOException {
        ImuWriter.Stream[] streams = {
            new ImuWriter.Stream(ACCEL, 3, 0.01, 0),
            new ImuWriter.Stream(GYRO, 3, 0.002, 0),
            new ImuWriter.Stream(PRESSURE, 1, 0.01, 1000),
        };
        try (ImuWriter writer = new ImuWriter(file, HEADER_JSON, streams)) {
            ordinaryPacket(writer);
            writer.flushChunk();
            // Rien en attente : pas de paquet vide.
            writer.flushChunk();
            gapsPacket(writer);
            writer.flushChunk();
            // Écrit par la fermeture, sans `flushChunk`.
            longBlockPacket(writer);
        }
    }

    /**
     * Paquet 1, les trois flux. Instants : un écart arrondi (20 047 µs), un
     * autre pile au milieu du pas (30 050 µs). Valeurs : 46,60 m/s² vaut
     * 0x1234 (ordre des octets), des entiers bornés aux deux extrêmes dont
     * l'écart sort de 16 bits (modulo 2^16), l'échelle de chaque flux, le
     * décalage de 1000 hPa des deux côtés.
     */
    private static void ordinaryPacket(ImuWriter writer) {
        long[] accelUs = { T0, T0 + 10_000, T0 + 20_047, T0 + 30_050, T0 + 40_000 };
        float[][] accel = {
            { 46.60f, 400f, 9.81f },
            { -1.5f, -400f, 9.81f },
            { 3.27f, 400f, 9.82f },
            { 0f, 327.67f, -9.81f },
            { 0.01f, -327.68f, 0f },
        };
        for (int i = 0; i < accel.length; i++) writer.add(ACCEL, accelUs[i], accel[i]);
        long[] gyroUs = { T0 + 1_000, T0 + 11_000, T0 + 21_000 };
        float[][] gyro = {
            { 0.5f, 0.002f, -65.536f },
            { -0.5f, 0.004f, 0f },
            { 65.534f, -0.002f, 0.1f },
        };
        for (int i = 0; i < gyro.length; i++) writer.add(GYRO, gyroUs[i], gyro[i]);
        writer.add(PRESSURE, T0 + 5_000, new float[] { 1013.25f });
        writer.add(PRESSURE, T0 + 205_000, new float[] { 999.5f });
        // Un flux absent de l'en-tête rendrait le paquet illisible : il est ignoré.
        writer.add(9, T0, new float[] { 1f });
    }

    /**
     * Paquet 2, les limites d'un bloc de l'accéléromètre. Dans un bloc, un
     * instant tombe sur le pas ; le premier d'un bloc reste exact : les µs de
     * trop disent à la lecture où commence chaque bloc. Écart de 32 767 pas
     * (même bloc), de 32 768 (nouveau bloc), instant qui recule (nouveau bloc).
     * Un gyroscope à une seule mesure ; pas de baromètre.
     */
    private static void gapsPacket(ImuWriter writer) {
        long[] accelUs = { T1, T1 + 3_276_730, T1 + 6_553_540, T1 + 6_552_547, T1 + 6_572_584 };
        float[][] accel = {
            { 1f, 0.25f, -1f },
            { 2f, 0.25f, -2f },
            { 3f, 0.5f, -3f },
            { 4f, 0.5f, -4f },
            { 5f, 0.75f, -5f },
        };
        for (int i = 0; i < accel.length; i++) writer.add(ACCEL, accelUs[i], accel[i]);
        writer.add(GYRO, T1 + 123, new float[] { 1f, -1f, 0.5f });
    }

    /**
     * Paquet 3 : 65 536 mesures à 100 Hz, dont le nombre ne tient pas dans le
     * uint16 d'un bloc : un bloc de 65 535 (qu'un int16 lirait négatif), puis
     * un d'une mesure, 37 µs hors du pas.
     */
    private static void longBlockPacket(ImuWriter writer) {
        float[] sample = { 1f, 2f, -1f };
        for (int i = 0; i < LONG_BLOCK; i++) {
            writer.add(ACCEL, T2 + i * 10_000L + (i == LONG_BLOCK - 1 ? 37 : 0), sample);
        }
    }

    /** Point d'entrée de `outils/imu-reference.mjs` : écrit le fichier désigné. */
    public static void main(String[] args) throws IOException {
        if (args.length != 1) throw new IllegalArgumentException("attendu : le fichier à écrire");
        write(new File(args[0]));
    }
}
