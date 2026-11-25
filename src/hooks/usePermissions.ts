import { useCallback, useEffect, useState } from 'react';
import { onAppResume, readDeviceBrand, readPermissions, type DeviceBrand } from '../platform/permissions';
import { showsAutostart, type PermissionsStatus } from '../recording/permissionsPrompt';

/**
 * État des autorisations du téléphone, relu au retour au premier plan (après un écran système), et présence de la
 * ligne du démarrage automatique (`autostart`, vrai sur un Xiaomi seulement) ; `status` vaut `null` tant qu'il n'est
 * pas lu.
 */
export function usePermissions(): {
  status: PermissionsStatus | null;
  autostart: boolean;
  refresh: () => Promise<PermissionsStatus>;
} {
  const [status, setStatus] = useState<PermissionsStatus | null>(null);
  const [autostart, setAutostart] = useState(false);
  const apply = useCallback((next: PermissionsStatus, device: DeviceBrand | null) => {
    setStatus(next);
    setAutostart(showsAutostart(device));
    return next;
  }, []);
  const refresh = useCallback(async () => {
    const [next, device] = await Promise.all([readPermissions(), readDeviceBrand()]);
    return apply(next, device);
  }, [apply]);
  useEffect(() => {
    void Promise.all([readPermissions(), readDeviceBrand()]).then(([next, device]) => apply(next, device));
    return onAppResume(() => void refresh());
  }, [apply, refresh]);
  return { status, autostart, refresh };
}
