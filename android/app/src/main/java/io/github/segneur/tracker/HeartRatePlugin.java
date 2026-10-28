package io.github.segneur.tracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Ceinture cardio Bluetooth (src/platform/heartRate.ts) : recherche, connexion
 * et fréquence cardiaque, par le service standard Heart Rate (0x180D) que
 * toute ceinture « Bluetooth Smart » expose. Aucun appairage : une ceinture
 * ne le demande pas, la connexion se fait directement.
 *
 * Avant d'ouvrir la connexion, une recherche courte filtrée sur l'adresse
 * retrouve la ceinture : l'appareil rendu porte le bon type d'adresse. Une
 * ceinture à adresse aléatoire (la Decathlon) ouverte par la seule adresse
 * passe pour publique, et la pile ne la joint que si elle en garde une fiche
 * (après un passage par les réglages Bluetooth d'Android, par exemple).
 *
 * Chaque mesure (caractéristique 0x2A37) part vers la page par l'événement
 * `heartRate` ; l'enregistreur la joint à la position suivante. Écran éteint,
 * le service au premier plan du GPS garde le processus en vie, et la pile
 * Bluetooth livre les mesures comme les positions ; sans GPS (muscu), c'est
 * HeartRateService, démarré par `keepAlive`. Une connexion perdue (hors
 * de portée, ceinture retirée) est relancée d'elle-même, en attente du retour
 * de la ceinture, jusqu'à `disconnect`.
 */
@CapacitorPlugin(
    name = "HeartRate",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
    }
)
public class HeartRatePlugin extends Plugin {

    private static final UUID HEART_RATE_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID HEART_RATE_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID CLIENT_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    /** Durée de recherche par défaut, en millisecondes. */
    private static final long DEFAULT_SCAN_MS = 6000;
    /** Recherche de la ceinture avant d'ouvrir la connexion, au plus, en millisecondes. */
    private static final long LOCATE_MS = 5000;
    /** Pause avant de la rechercher de nouveau quand elle n'a pas encore été jointe (Android refuse plus de 5 recherches par 30 s). */
    private static final long RELOCATE_PAUSE_MS = 10000;
    /** Étiquette du journal (`adb logcat -s TrackerHR`). */
    private static final String TAG = "TrackerHR";

    private final Handler main = new Handler(Looper.getMainLooper());

    // État de la connexion, lu et écrit sur le fil principal (les rappels Bluetooth y sont renvoyés).
    private BluetoothGatt gatt;
    private String address;
    private String name;
    /** L'appareil à ouvrir ; celui rendu par la recherche porte le bon type d'adresse. */
    private BluetoothDevice device;
    /** Vrai si `device` vient d'une recherche : son type d'adresse est alors sûr. */
    private boolean located = false;
    /** Vrai entre `connect` et `disconnect` : une coupure est alors relancée. */
    private boolean wanted = false;
    /** Vrai dès que la ceinture a donné sa fréquence depuis `connect` : une coupure est alors une perte. */
    private boolean joined = false;
    /** Recherche en cours avant l'ouverture, ou `null`. */
    private ScanCallback locating;
    private final Runnable locateTimeout = () -> locatedBy(locating, null);
    private final Runnable relocate = this::locate;

    // --- Permissions ---

    /** Android 12 et plus : recherche et connexion demandent une permission ; avant, celle de la position suffit. */
    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private boolean permitted() {
        return !needsRuntimePermission() || getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    /** Demande la permission si besoin, puis appelle `then` ; rejette l'appel si elle est refusée. */
    private void withPermission(PluginCall call, String callback) {
        if (permitted()) {
            if ("scanAfterPermission".equals(callback)) scanAfterPermission(call);
            else connectAfterPermission(call);
            return;
        }
        requestPermissionForAlias("bluetooth", call, callback);
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    // --- Méthodes ---

    /** État de la permission : granted, denied ou prompt ; avant Android 12, toujours accordée. */
    private String permissionText() {
        return needsRuntimePermission() ? getPermissionState("bluetooth").toString() : "granted";
    }

    /** Bluetooth présent et allumé, permission accordée (et son état en clair, pour la carte « Autorisations »). */
    @PluginMethod
    public void availability(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject ret = new JSObject();
        ret.put("bluetooth", adapter != null);
        ret.put("enabled", adapter != null && adapter.isEnabled());
        ret.put("permitted", permitted());
        ret.put("permission", permissionText());
        call.resolve(ret);
    }

    /** Demande la permission Bluetooth (carte « Autorisations ») ; rend son état. */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (permitted()) {
            permissionAnswered(call);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "permissionAnswered");
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("permission", permissionText());
        call.resolve(ret);
    }

    /** Cherche les ceintures pendant `durationMs` ; rend leur adresse, leur nom et la force du signal. */
    @PluginMethod
    public void scan(PluginCall call) {
        withPermission(call, "scanAfterPermission");
    }

    @PermissionCallback
    @SuppressLint("MissingPermission")
    private void scanAfterPermission(PluginCall call) {
        if (!permitted()) {
            call.reject("permission Bluetooth refusée");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth éteint");
            return;
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("recherche Bluetooth impossible");
            return;
        }
        // Un nombre JSON arrive en Integer ou en Long selon sa taille : lu comme Number.
        Object rawDuration = call.getData().opt("durationMs");
        long durationMs = Math.max(1000, rawDuration instanceof Number ? ((Number) rawDuration).longValue() : DEFAULT_SCAN_MS);
        Map<String, JSObject> found = new LinkedHashMap<>();
        // Sans filtre : certaines ceintures n'annoncent pas leur service, on les reconnaît alors à leur nom.
        ScanCallback callback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                ScanRecord record = result.getScanRecord();
                String deviceName = record != null && record.getDeviceName() != null ? record.getDeviceName() : device.getName();
                if (!isHeartRateDevice(record, deviceName)) return;
                JSObject belt = new JSObject();
                belt.put("address", device.getAddress());
                belt.put("name", deviceName != null ? deviceName : device.getAddress());
                belt.put("rssi", result.getRssi());
                Boolean random = randomAddress(device);
                if (random != null) belt.put("random", random);
                main.post(() -> found.put(device.getAddress(), belt));
            }
        };
        try {
            scanner.startScan(callback);
        } catch (Exception e) {
            call.reject("recherche impossible : " + e.getMessage());
            return;
        }
        main.postDelayed(() -> {
            try {
                scanner.stopScan(callback);
            } catch (Exception ignored) {
                // Bluetooth coupé pendant la recherche : les ceintures déjà vues sont rendues.
            }
            JSArray devices = new JSArray();
            for (JSObject belt : found.values()) devices.put(belt);
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        }, durationMs);
    }

    private static boolean isHeartRateDevice(ScanRecord record, String deviceName) {
        if (record != null) {
            List<ParcelUuid> uuids = record.getServiceUuids();
            if (uuids != null && uuids.contains(new ParcelUuid(HEART_RATE_SERVICE))) return true;
        }
        if (deviceName == null) return false;
        String lower = deviceName.toLowerCase(Locale.ROOT);
        return lower.contains("hrm") || lower.contains("heart") || lower.contains("cardio") || lower.startsWith("hr ");
    }

    /** Adresse aléatoire (vrai) ou publique (faux) d'un appareil rendu par une recherche ; `null` avant Android 15, qui ne le dit pas. */
    private static Boolean randomAddress(BluetoothDevice device) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return null;
        return device.getAddressType() == BluetoothDevice.ADDRESS_TYPE_RANDOM;
    }

    /** L'appareil d'adresse `target`, du type `random` s'il est connu (Android 13 et plus) ; sinon tel que la pile le connaît. */
    private static BluetoothDevice remoteDevice(BluetoothAdapter adapter, String target, Boolean random) {
        if (random != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return adapter.getRemoteLeDevice(target, random ? BluetoothDevice.ADDRESS_TYPE_RANDOM : BluetoothDevice.ADDRESS_TYPE_PUBLIC);
        }
        return adapter.getRemoteDevice(target);
    }

    private static String addressTypeText(BluetoothDevice device) {
        Boolean random = randomAddress(device);
        return random == null ? "type inconnu" : random ? "aléatoire" : "publique";
    }

    /** Se connecte à la ceinture `address` et s'abonne à sa fréquence ; une connexion en cours est d'abord close. */
    @PluginMethod
    public void connect(PluginCall call) {
        withPermission(call, "connectAfterPermission");
    }

    @PermissionCallback
    private void connectAfterPermission(PluginCall call) {
        if (!permitted()) {
            call.reject("permission Bluetooth refusée");
            return;
        }
        String target = call.getString("address");
        BluetoothAdapter adapter = adapter();
        if (target == null || !BluetoothAdapter.checkBluetoothAddress(target)) {
            call.reject("adresse de ceinture invalide");
            return;
        }
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth éteint");
            return;
        }
        String targetName = call.getString("name", target);
        // Type d'adresse retenu par l'application (vrai : aléatoire), absent s'il n'est pas connu.
        Object rawRandom = call.getData().opt("random");
        Boolean random = rawRandom instanceof Boolean ? (Boolean) rawRandom : null;
        main.post(() -> {
            stopLocating();
            closeGatt();
            address = target;
            name = targetName;
            device = remoteDevice(adapter, target, random);
            located = false;
            wanted = true;
            joined = false;
            sendStatus("connecting");
            locate();
            call.resolve();
        });
    }

    /** Coupe la connexion et n'essaie plus de la relancer. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        main.post(() -> {
            wanted = false;
            stopLocating();
            closeGatt();
            sendStatus("off");
            call.resolve();
        });
    }

    /**
     * Muscu (lot I du 25/10) : démarre le service au premier plan qui tient
     * l'application écran éteint pendant une session sans GPS, avec la
     * notification de l'enregistrement (`title`, `text`). Refusé sans la
     * permission Bluetooth, qu'Android 14 exige pour ce type de service.
     */
    @PluginMethod
    public void keepAlive(PluginCall call) {
        if (!permitted()) {
            call.reject("permission Bluetooth refusée");
            return;
        }
        Intent intent = new Intent(getContext(), HeartRateService.class)
            .putExtra(HeartRateService.EXTRA_TITLE, call.getString("title", "Tracker enregistre"))
            .putExtra(HeartRateService.EXTRA_TEXT, call.getString("text", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("service impossible à lancer : " + e.getMessage());
        }
    }

    /** Arrête le service de `keepAlive`, et sa notification. */
    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        getContext().stopService(new Intent(getContext(), HeartRateService.class));
        call.resolve();
    }

    /** Ouvre les réglages Bluetooth d'Android : le secours quand la ceinture reste introuvable. */
    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Réglages Bluetooth introuvables");
        }
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            wanted = false;
            stopLocating();
            closeGatt();
        });
        super.handleOnDestroy();
    }

    // --- Connexion ---

    /**
     * Cherche la ceinture (`LOCATE_MS` au plus), puis ouvre la connexion sur
     * l'appareil trouvé, ou sur celui déjà connu si la recherche ne la voit pas
     * : une ceinture déjà connectée au téléphone ne s'annonce plus.
     */
    @SuppressLint("MissingPermission")
    private void locate() {
        main.removeCallbacks(relocate);
        if (!wanted || device == null) return;
        BluetoothAdapter adapter = adapter();
        BluetoothLeScanner scanner = adapter != null && adapter.isEnabled() ? adapter.getBluetoothLeScanner() : null;
        if (scanner == null) {
            open(false);
            return;
        }
        ScanCallback cb = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice found = result.getDevice();
                if (found.getAddress().equalsIgnoreCase(address)) main.post(() -> locatedBy(this, found));
            }

            @Override
            public void onScanFailed(int errorCode) {
                Log.d(TAG, "recherche refusée, code " + errorCode);
                main.post(() -> locatedBy(this, null));
            }
        };
        // Des filtres, pour que la recherche tienne écran éteint ; ils s'ajoutent (l'un ou l'autre) :
        // l'adresse, et le service cardio au cas où le filtre d'adresse, posé en publique, manquerait
        // une adresse aléatoire. L'adresse est vérifiée à chaque résultat.
        List<ScanFilter> filters = new ArrayList<>();
        filters.add(new ScanFilter.Builder().setDeviceAddress(address).build());
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(HEART_RATE_SERVICE)).build());
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(filters, settings, cb);
        } catch (Exception e) {
            Log.d(TAG, "recherche impossible : " + e.getMessage());
            open(false);
            return;
        }
        locating = cb;
        main.postDelayed(locateTimeout, LOCATE_MS);
    }

    /** Fin de la recherche `cb` : `found` est la ceinture, ou `null` si elle n'a pas été vue. */
    private void locatedBy(ScanCallback cb, BluetoothDevice found) {
        if (cb == null || cb != locating) return;
        stopLocating();
        if (!wanted) return;
        if (found != null) {
            device = found;
            located = true;
        }
        Log.d(TAG, found != null ? "trouvée par la recherche, adresse " + addressTypeText(found) : "pas vue par la recherche");
        open(false);
    }

    @SuppressLint("MissingPermission")
    private void stopLocating() {
        main.removeCallbacks(locateTimeout);
        main.removeCallbacks(relocate);
        if (locating == null) return;
        ScanCallback cb = locating;
        locating = null;
        try {
            BluetoothAdapter adapter = adapter();
            BluetoothLeScanner scanner = adapter == null ? null : adapter.getBluetoothLeScanner();
            if (scanner != null) scanner.stopScan(cb);
        } catch (Exception ignored) {
            // Bluetooth coupé entre-temps : la recherche s'est arrêtée d'elle-même.
        }
    }

    /**
     * Ouvre la connexion sur `device`. `autoConnect` faux d'abord, pour
     * qu'elle soit rapide ; vrai pour la relance d'une ceinture perdue, qui
     * attend sans limite son retour.
     */
    @SuppressLint("MissingPermission")
    private void open(boolean autoConnect) {
        Log.d(TAG, "ouverture " + (autoConnect ? "en attente" : "directe") + ", adresse "
            + (located ? addressTypeText(device) : "non vérifiée"));
        try {
            gatt = device.connectGatt(getContext(), autoConnect, callback, BluetoothDevice.TRANSPORT_LE);
        } catch (SecurityException e) {
            wanted = false;
            sendStatus("off");
        }
    }

    @SuppressLint("MissingPermission")
    private void closeGatt() {
        if (gatt == null) return;
        try {
            gatt.disconnect();
            gatt.close();
        } catch (SecurityException ignored) {
            // Permission retirée entre-temps : la connexion tombe d'elle-même.
        }
        gatt = null;
    }

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            main.post(() -> {
                if (g != gatt) return;
                Log.d(TAG, "connexion : état " + newState + ", statut " + status + (joined ? ", déjà jointe" : ", pas encore jointe"));
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    try {
                        g.discoverServices();
                    } catch (SecurityException ignored) {
                        // Traité à la coupure qui suit.
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    closeGatt();
                    BluetoothAdapter adapter = adapter();
                    if (!wanted || device == null || adapter == null || !adapter.isEnabled()) {
                        sendStatus(wanted ? "lost" : "off");
                    } else if (joined) {
                        // Perdue (hors de portée, retirée) : relance en attente de son retour, écran éteint compris.
                        sendStatus("lost");
                        open(true);
                    } else {
                        // Jamais jointe depuis `connect` : on la recherche de nouveau, après une pause.
                        sendStatus("searching");
                        main.postDelayed(relocate, RELOCATE_PAUSE_MS);
                    }
                }
            });
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            main.post(() -> {
                if (g != gatt) return;
                BluetoothGattService service = g.getService(HEART_RATE_SERVICE);
                BluetoothGattCharacteristic measurement = service == null ? null : service.getCharacteristic(HEART_RATE_MEASUREMENT);
                if (measurement == null) {
                    // Pas une ceinture cardio : inutile d'insister.
                    wanted = false;
                    closeGatt();
                    sendStatus("unsupported");
                    return;
                }
                try {
                    g.setCharacteristicNotification(measurement, true);
                    BluetoothGattDescriptor config = measurement.getDescriptor(CLIENT_CONFIG);
                    if (config != null) writeConfig(g, config);
                    joined = true;
                    sendStatus("connected");
                } catch (SecurityException ignored) {
                    sendStatus("lost");
                }
            });
        }

        // Android 13 et plus.
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (HEART_RATE_MEASUREMENT.equals(characteristic.getUuid())) sendMeasurement(value);
        }

        // Avant Android 13.
        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            if (HEART_RATE_MEASUREMENT.equals(characteristic.getUuid())) sendMeasurement(characteristic.getValue());
        }
    };

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private static void writeConfig(BluetoothGatt g, BluetoothGattDescriptor config) {
        byte[] enable = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeDescriptor(config, enable);
        } else {
            config.setValue(enable);
            g.writeDescriptor(config);
        }
    }

    // --- Événements ---

    /**
     * Mesure 0x2A37 : drapeaux, puis la fréquence sur 8 ou 16 bits. Le contact
     * avec la peau n'est connu que si la ceinture sait le détecter.
     */
    private void sendMeasurement(byte[] value) {
        if (value == null || value.length < 2) return;
        int flags = value[0] & 0xff;
        boolean wide = (flags & 0x01) != 0;
        if (wide && value.length < 3) return;
        int bpm = wide ? (value[1] & 0xff) | ((value[2] & 0xff) << 8) : value[1] & 0xff;
        JSObject data = new JSObject();
        data.put("bpm", bpm);
        data.put("timeMs", System.currentTimeMillis());
        if ((flags & 0x04) != 0) data.put("contact", (flags & 0x02) != 0);
        notifyListeners("heartRate", data);
    }

    private void sendStatus(String state) {
        JSObject data = new JSObject();
        data.put("state", state);
        if (address != null) data.put("address", address);
        if (name != null) data.put("name", name);
        // Type d'adresse sûr seulement pour un appareil trouvé par la recherche : l'application le retient.
        Boolean random = located && device != null ? randomAddress(device) : null;
        if (random != null) data.put("random", random);
        notifyListeners("status", data);
    }
}
