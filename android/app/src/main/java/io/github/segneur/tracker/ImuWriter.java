package io.github.segneur.tracker;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.zip.Deflater;

/**
 * Écrit un fichier des capteurs (`.imu`) au format décrit en tête de
 * src/core/imuFile.ts, seule description qui fasse foi : marque, en-tête
 * JSON, puis des paquets indépendants compressés en deflate brut, un par
 * appel à `flushChunk` (environ une seconde de mesures).
 *
 * Java pur, sans Android : il se compile et s'éprouve sur le PC contre le
 * lecteur TypeScript. Pas sûr entre fils : `MotionPlugin` l'appelle toujours
 * depuis le fil de ses capteurs.
 */
final class ImuWriter implements Closeable {

    static final byte[] MAGIC = "TRKIMU1\n".getBytes(StandardCharsets.US_ASCII);
    /** Pas des instants dans un bloc, en microsecondes. */
    static final long TIME_STEP_US = 100;

    /** Description d'un flux : numéro, nombre d'axes, valeur d'une unité entière et de l'entier 0. */
    static final class Stream {
        final int id;
        final int axes;
        final double unit;
        final double offset;
        long[] times = new long[256];
        short[][] values;
        int count = 0;

        Stream(int id, int axes, double unit, double offset) {
            this.id = id;
            this.axes = axes;
            this.unit = unit;
            this.offset = offset;
            values = new short[axes][256];
        }

        void add(long timeUs, float[] sample) {
            if (count == times.length) {
                int capacity = times.length * 2;
                long[] t = new long[capacity];
                System.arraycopy(times, 0, t, 0, count);
                times = t;
                for (int a = 0; a < axes; a++) {
                    short[] v = new short[capacity];
                    System.arraycopy(values[a], 0, v, 0, count);
                    values[a] = v;
                }
            }
            times[count] = timeUs;
            for (int a = 0; a < axes; a++) {
                double q = Math.rint(((a < sample.length ? sample[a] : 0f) - offset) / unit);
                values[a][count] = (short) Math.max(-32768, Math.min(32767, q));
            }
            count += 1;
        }
    }

    private final FileOutputStream out;
    private final Stream[] streams;
    private long bytes = 0;

    ImuWriter(File file, String headerJson, Stream[] streams) throws IOException {
        this.streams = streams;
        out = new FileOutputStream(file);
        byte[] header = headerJson.getBytes(StandardCharsets.UTF_8);
        write(MAGIC);
        write(uint32(header.length));
        write(header);
        out.flush();
    }

    /** Ajoute une mesure au flux `id`, à l'instant donné en µs depuis le départ ; un numéro inconnu est ignoré. */
    void add(int id, long timeUs, float[] sample) {
        for (Stream s : streams) {
            if (s.id == id) {
                s.add(timeUs, sample);
                return;
            }
        }
    }

    /** Écrit les mesures en attente en un paquet ; sans effet s'il n'y en a pas. */
    void flushChunk() throws IOException {
        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        for (Stream s : streams) {
            if (s.count == 0) continue;
            writeBlocks(payload, s);
            s.count = 0;
        }
        if (payload.size() == 0) return;
        Deflater deflater = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        try {
            deflater.setInput(payload.toByteArray());
            deflater.finish();
            ByteArrayOutputStream compressed = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            while (!deflater.finished()) {
                int n = deflater.deflate(buffer);
                compressed.write(buffer, 0, n);
            }
            write(uint32(compressed.size()));
            write(compressed.toByteArray());
            out.flush();
        } finally {
            deflater.end();
        }
    }

    /** Octets écrits jusqu'ici. */
    long bytes() {
        return bytes;
    }

    @Override
    public void close() throws IOException {
        try {
            flushChunk();
        } finally {
            out.close();
        }
    }

    /** Blocs d'un flux : un nouveau bloc quand un écart d'instant sort de [0, 32 767] dixièmes de ms. */
    private static void writeBlocks(ByteArrayOutputStream payload, Stream s) {
        int start = 0;
        while (start < s.count) {
            long first = s.times[start];
            int end = start + 1;
            long previous = 0;
            while (end < s.count && end - start < 65535) {
                long r = Math.round((s.times[end] - first) / (double) TIME_STEP_US);
                long d = r - previous;
                if (d < 0 || d > 32767) break;
                previous = r;
                end += 1;
            }
            int n = end - start;
            ByteBuffer block = ByteBuffer.allocate(11 + (n - 1) * 2 + s.axes * n * 2).order(ByteOrder.LITTLE_ENDIAN);
            block.put((byte) s.id);
            block.putShort((short) n);
            block.putDouble((double) first);
            previous = 0;
            for (int i = start + 1; i < end; i++) {
                long r = Math.round((s.times[i] - first) / (double) TIME_STEP_US);
                block.putShort((short) (r - previous));
                previous = r;
            }
            for (int a = 0; a < s.axes; a++) {
                short previousQ = 0;
                for (int i = start; i < end; i++) {
                    short q = s.values[a][i];
                    block.putShort(i == start ? q : (short) (q - previousQ));
                    previousQ = q;
                }
            }
            payload.write(block.array(), 0, block.position());
            start = end;
        }
    }

    private void write(byte[] data) throws IOException {
        out.write(data);
        bytes += data.length;
    }

    private static byte[] uint32(int value) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array();
    }
}
