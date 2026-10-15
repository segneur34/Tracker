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
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
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
 * Chaque mesure (caractéristique 0x2A37) part vers la page par l'événement
 * `heartRate` ; l'enregistreur la joint à la position suivante. Écran éteint,
 * le service au premier plan du GPS garde le processus en vie, et la pile
 * Bluetooth livre les mesures comme les positions. Une connexion perdue (hors
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

    private final Handler main = new Handler(Looper.getMainLooper());

    // État de la connexion, lu et écrit sur le fil principal (les rappels Bluetooth y sont renvoyés).
    private BluetoothGatt gatt;
    private String address;
    private String name;
    /** Vrai entre `connect` et `disconnect` : une coupure est alors relancée. */
    private boolean wanted = false;

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

    /** Bluetooth présent et allumé, permission accordée. */
    @PluginMethod
    public void availability(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject ret = new JSObject();
        ret.put("bluetooth", adapter != null);
        ret.put("enabled", adapter != null && adapter.isEnabled());
        ret.put("permitted", permitted());
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
        main.post(() -> {
            closeGatt();
            address = target;
            name = targetName;
            wanted = true;
            open(adapter.getRemoteDevice(target), false);
            call.resolve();
        });
    }

    /** Coupe la connexion et n'essaie plus de la relancer. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        main.post(() -> {
            wanted = false;
            closeGatt();
            sendStatus("off");
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            wanted = false;
            closeGatt();
        });
        super.handleOnDestroy();
    }

    // --- Connexion ---

    /**
     * Ouvre la connexion. `autoConnect` faux la première fois, pour qu'elle
     * soit rapide ; vrai pour une relance, qui attend sans limite le retour de
     * la ceinture.
     */
    @SuppressLint("MissingPermission")
    private void open(BluetoothDevice device, boolean autoConnect) {
        sendStatus(autoConnect ? "lost" : "connecting");
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
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    try {
                        g.discoverServices();
                    } catch (SecurityException ignored) {
                        // Traité à la coupure qui suit.
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    closeGatt();
                    BluetoothAdapter adapter = adapter();
                    if (wanted && address != null && adapter != null && adapter.isEnabled()) {
                        open(adapter.getRemoteDevice(address), true);
                    } else {
                        sendStatus(wanted ? "lost" : "off");
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
        notifyListeners("status", data);
    }
}
