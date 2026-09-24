package io.github.segneur.tracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propres à l'application, déclarés avant le démarrage du pont.
        registerPlugin(MemoryFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
