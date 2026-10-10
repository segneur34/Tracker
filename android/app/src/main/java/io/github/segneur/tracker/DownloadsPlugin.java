package io.github.segneur.tracker;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Fichier déposé dans le dossier Téléchargements du téléphone (le GPX d'une
 * session, depuis son analyse).
 *
 * Écrit par MediaStore, sans aucune permission : Android 10 et plus
 * seulement. Avant, il faudrait demander l'accès au stockage, ce que
 * l'application ne fait pas ; l'appel est alors refusé avec un message clair.
 * Un nom déjà pris reçoit « (1) » d'Android.
 */
@CapacitorPlugin(name = "Downloads")
public class DownloadsPlugin extends Plugin {

    /** Type du fichier créé : Android n'ajoute alors aucune extension au nom demandé (comme MemoryFolderPlugin). */
    private static final String FILE_MIME = "application/octet-stream";

    @PluginMethod
    public void saveText(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        if (name == null || name.isEmpty() || text == null) {
            call.reject("Nom ou contenu manquant.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Le téléchargement demande Android 10 ou plus récent.");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, FILE_MIME);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        // Caché aux autres applications le temps de l'écriture.
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("Android a refusé de créer le fichier.");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("Fichier impossible à ouvrir.");
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception e) {
            // Rien de laissé à moitié écrit.
            if (uri != null) {
                try {
                    resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // Déjà absent.
                }
            }
            call.reject(e.getMessage() != null ? e.getMessage() : "Écriture impossible.");
        }
    }
}
