package io.github.segneur.tracker;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * Menu de partage d'Android pour un fichier produit par l'application
 * (l'image de partage d'une session).
 *
 * Le fichier est posé dans `partage/` du cache de l'application, que le
 * FileProvider déclaré dans le manifeste expose (`res/xml/file_paths.xml`) :
 * l'application choisie le lit par une adresse `content://`, avec une
 * permission de lecture temporaire, sans aucune permission de stockage.
 * Les fichiers des partages précédents sont effacés au partage suivant :
 * l'application choisie peut lire le sien après la fermeture du menu.
 * L'appel se résout dès le menu ouvert : Android ne dit pas si le partage
 * a abouti.
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

    private static final String SHARE_DIR = "partage";

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "image/png");
        String title = call.getString("title", "Partager");
        if (name == null || name.isEmpty() || name.contains("/") || data == null) {
            call.reject("Nom ou contenu manquant.");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), SHARE_DIR);
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("Dossier de partage impossible à créer.");
            File[] previous = dir.listFiles();
            if (previous != null) {
                for (File old : previous) {
                    // Échec sans conséquence : le fichier sera remplacé ou effacé plus tard.
                    //noinspection ResultOfMethodCallIgnored
                    old.delete();
                }
            }
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeType);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            // La permission suit le ClipData jusqu'à l'application choisie dans le menu.
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Partage impossible.");
        }
    }
}
