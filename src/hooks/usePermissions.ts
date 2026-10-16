import { useCallback, useEffect, useState } from 'react';
import { savedBelt } from '../platform/heartRate';
import { onAppResume, readPermissions } from '../platform/permissions';
import { missingPermissions, type PermissionKey, type PermissionsStatus } from '../recording/permissionsPrompt';

/** État des autorisations du téléphone, relu au retour au premier plan (après un écran système) ; `null` tant qu'il n'est pas lu. */
export function usePermissions(): { status: PermissionsStatus | null; refresh: () => Promise<PermissionsStatus> } {
  const [status, setStatus] = useState<PermissionsStatus | null>(null);
  const refresh = useCallback(async () => {
    const next = await readPermissions();
    setStatus(next);
    return next;
  }, []);
  useEffect(() => {
    void readPermissions().then(setStatus);
    return onAppResume(() => void refresh());
  }, [refresh]);
  return { status, refresh };
}

/** Autorisations requises qui manquent (page Enregistrer) ; vide dans le navigateur ou tant qu'elles ne sont pas lues. */
export function useMissingPermissions(): PermissionKey[] {
  const { status } = usePermissions();
  return status ? missingPermissions(status, savedBelt() !== null) : [];
}
