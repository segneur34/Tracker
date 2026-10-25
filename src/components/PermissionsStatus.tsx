import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { savedBelt } from '../platform/heartRate';
import {
  markPermissionsSeen, openAppSettings, openAutostart, permissionsSeenVersion, readPermissions, requestPermission,
} from '../platform/permissions';
import { isNativeApp } from '../platform/runtime';
import {
  PERMISSION_LABEL, missingPermissions, requiredPermissions, shouldPromptPermissions,
  type PermissionKey, type PermissionState, type PermissionsStatus as Status,
} from '../recording/permissionsPrompt';
import { HelpToggle } from './Help';
import { useHelp } from './helpContext';
import Button from './ui/Button';
import Card from './ui/Card';
import './PermissionsStatus.css';
import './StatusLine.css';

/**
 * Autorisations du téléphone dont l'enregistrement a besoin : une ligne par
 * autorisation (pourquoi, état, bouton), plus le démarrage automatique de
 * Xiaomi, sans état lisible. En tête de l'accueil (`PermissionsPrompt`) au
 * premier lancement et après une mise à jour s'il en manque une ; dans
 * Réglages, bloc « Autorisations » (`PermissionsSettings`). Rien dans le
 * navigateur. Les états sont relus au retour d'un écran système.
 */

const WHY: Record<PermissionKey, string> = {
  location: "Pour enregistrer la trace. « Pendant l'utilisation de l'application » suffit, écran éteint compris.",
  notifications: "Pour la notification de l'enregistrement, lisible écran verrouillé, et celle du compteur du fractionné.",
  battery: "Pour qu'Android ne coupe pas l'enregistrement écran éteint : « Autoriser », ou « Aucune restriction ».",
  bluetooth: 'Pour la ceinture cardio seulement.',
};

const STATE_TEXT: Record<PermissionState, string> = {
  granted: 'accordée',
  prompt: 'à accorder',
  denied: 'refusée',
  unavailable: 'sans objet',
};

const STATE_COLOR: Record<PermissionState, string> = {
  granted: 'var(--success)',
  prompt: 'var(--warning-line)',
  denied: 'var(--danger)',
  unavailable: 'var(--muted)',
};

/** Demande `key`, ou, refusée pour de bon, ouvre les réglages de l'application ; puis relit les états. */
const ask = async (key: PermissionKey, state: PermissionState, refresh: () => Promise<Status>): Promise<void> => {
  try {
    if (state === 'denied' && key !== 'battery') await openAppSettings();
    else await requestPermission(key);
  } catch {
    // Un écran système absent ou un refus : l'état relu le dira.
  }
  await refresh();
};

/**
 * Une ligne : le nom, le pourquoi, l'état et le bouton. Dans Réglages, le pourquoi
 * passe sous un « ? » ; sur la carte de l'accueil, il reste à découvert.
 */
function PermissionRow({ helpKey, label, why, children }: { helpKey: string; label: string; why: string; children: ReactNode }) {
  const help = useHelp(helpKey);
  return (
    <div className="permissions__row">
      <div className="permissions__text">
        <span className="permissions__label">{label}<HelpToggle helpKey={helpKey} label={label} /></span>
        {(help === null || help.open) && <span className="permissions__why">{why}</span>}
      </div>
      <div className="permissions__action">{children}</div>
    </div>
  );
}

function PermissionRows({ keys, status, refresh }: { keys: PermissionKey[]; status: Status; refresh: () => Promise<Status> }) {
  return (
    <div className="permissions">
      {keys.map((key) => {
        const state = status[key];
        return (
          <PermissionRow key={key} helpKey={`autorisations:${key}`} label={PERMISSION_LABEL[key]} why={WHY[key]}>
            <span className="status-line">
              <span className="status-line__dot" style={{ backgroundColor: STATE_COLOR[state] }} />
              <span>{key === 'battery' && state === 'denied' ? 'restreinte' : STATE_TEXT[state]}</span>
            </span>
            {state !== 'granted' && state !== 'unavailable' && (
              <Button size="s" onClick={() => void ask(key, state, refresh)}>
                {state === 'denied' && key !== 'battery' ? 'Ouvrir les réglages' : 'Autoriser'}
              </Button>
            )}
          </PermissionRow>
        );
      })}
      <PermissionRow helpKey="autorisations:demarrage" label="Démarrage automatique"
        why="Sur Xiaomi, pour que l'enregistrement tienne en arrière-plan. Android ne dit pas s'il est activé : à vérifier soi-même.">
        <Button size="s" onClick={() => void openAutostart().catch(() => undefined)}>Ouvrir</Button>
      </PermissionRow>
    </div>
  );
}

/**
 * Demande toutes celles qui manquent, dans l'ordre : les demandes système
 * d'abord, puis l'écran de la batterie, qui quitte l'application.
 */
const askAll = async (keys: PermissionKey[], refresh: () => Promise<Status>): Promise<void> => {
  let status = await refresh();
  for (const key of keys) {
    if (key === 'battery' || status[key] !== 'prompt') continue;
    try {
      await requestPermission(key);
    } catch {
      // Refus ou échec : on passe à la suivante.
    }
    status = await refresh();
  }
  if (keys.includes('battery') && status.battery !== 'granted') await ask('battery', status.battery, refresh);
};

/**
 * Carte de l'accueil : seulement s'il faut (`shouldPromptPermissions`) ; « Plus tard » la renvoie à la version suivante.
 * `onDecided` apprend une fois, après la lecture des autorisations, si la carte paraît (le pop-up du profil attend alors).
 */
export function PermissionsPrompt({ onDecided }: { onDecided?: (shown: boolean) => void }) {
  const { status, refresh } = usePermissions();
  const [dismissed, setDismissed] = useState(false);
  const beltSaved = savedBelt() !== null;
  const [shown, setShown] = useState<boolean | null>(null);
  const onDecidedRef = useRef(onDecided);
  useEffect(() => {
    onDecidedRef.current = onDecided;
  });

  // Décidé une fois, sur l'état lu à l'ouverture : la carte reste ensuite tant qu'on ne la ferme pas.
  useEffect(() => {
    let alive = true;
    void readPermissions().then((first) => {
      if (!alive) return;
      const decided = shouldPromptPermissions({ seenVersion: permissionsSeenVersion(), appVersion: __APP_VERSION__, status: first, beltSaved: savedBelt() !== null });
      setShown(decided);
      onDecidedRef.current?.(isNativeApp() && decided);
    });
    return () => {
      alive = false;
    };
  }, []);

  const missing = status ? missingPermissions(status, beltSaved) : [];
  // Tout accordé : la version est retenue, la carte ne reviendra qu'avec une autorisation manquante après une mise à jour.
  useEffect(() => {
    if (shown && status && missing.length === 0) markPermissionsSeen(__APP_VERSION__);
  }, [shown, status, missing.length]);

  if (!isNativeApp() || !shown || dismissed || status === null) return null;
  const close = () => {
    markPermissionsSeen(__APP_VERSION__);
    setDismissed(true);
  };
  const keys = requiredPermissions(beltSaved);

  return (
    <Card heading="Autorisations">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p className="permissions__intro">
          {missing.length === 0
            ? 'Tout est accordé : Tracker peut enregistrer écran éteint.'
            : "Pour enregistrer écran éteint, sans coupure, Tracker a besoin de ce qui suit. Chacune se règle aussi plus tard, dans Réglages › Autorisations."}
        </p>
        <PermissionRows keys={keys} status={status} refresh={refresh} />
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {missing.length > 0 && <Button variant="primary" onClick={() => void askAll(keys, refresh)}>Tout autoriser</Button>}
          <Button variant="ghost" onClick={close}>{missing.length === 0 ? 'Fermer' : 'Plus tard'}</Button>
        </div>
      </div>
    </Card>
  );
}

/** Bloc « Autorisations » de Réglages : toutes les lignes, Bluetooth compris. */
export function PermissionsSettings() {
  const { status, refresh } = usePermissions();
  if (!isNativeApp()) {
    return <p className="permissions__intro">Sur l'application Android seulement.</p>;
  }
  if (status === null) return <p className="permissions__intro">Lecture des autorisations…</p>;
  const keys = requiredPermissions(true);
  const missing = missingPermissions(status, true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <PermissionRows keys={keys} status={status} refresh={refresh} />
      {missing.length > 0 && (
        <div>
          <Button variant="primary" onClick={() => void askAll(keys, refresh)}>Tout autoriser</Button>
        </div>
      )}
    </div>
  );
}
