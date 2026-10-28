import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpText, HelpToggle } from '../components/Help';
import RestingHrChart from '../components/RestingHrChart';
import { BluetoothSettingsButton } from '../components/BeltStatus';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconPlay } from '../components/icons';
import { FAMILY_ACCENT } from '../core/activities';
import { formatMinSec } from '../core/units';
import { useRestingHrResults } from '../hooks/useRestingHrResults';
import { useRestingHrTest } from '../hooks/useRestingHrTest';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { BELT_STATE_LABEL } from '../platform/heartRate';
import { RESTING_HR_TEST, restingRemainingS } from '../recording/restingHrTest';
import { restingHrSeries, toStoredRestingResult, type StoredRestingResult } from '../running/restingHrResults';
import { WORKOUT_LISTS } from './workoutLists';
import './TrainingPages.css';

const PROTOCOL = RESTING_HR_TEST;
/** Plage de la FC repos de Pratiquant (`useRunnerProfile`), pour proposer de la retenir. */
const RETAINABLE_BPM = [25, 120] as const;

/** Vitesse de l'exemple du navigateur : `?vitesse=10` (banc), 1 par défaut. */
const exampleSpeed = (search: string): number => {
  const v = Number(new URLSearchParams(search).get('vitesse'));
  return isFinite(v) && v >= 1 && v <= 60 ? v : 1;
};

const dateText = (ms: number): string => new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Courbe d'un test gardé, à la demande : le graphe n'est monté que déplié. */
function StoredResultRow({ result, onRemove }: { result: StoredRestingResult; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const incomplete = result.coverage < PROTOCOL.minCoverage;
  return (
    <li className="train-item rest-history__item">
      <span className="train-item__text">
        <span className="train-item__name">{result.lowestBpm} bpm</span>
        <span className="train-item__detail">
          {dateText(result.startedAtMs)}
          {result.meanBpm !== null && ` · moyenne ${result.meanBpm} bpm`}
          {incomplete && ` · mesures sur ${Math.round(result.coverage * 100)} % du temps`}
        </span>
      </span>
      <span className="train-item__actions">
        <Button size="s" onClick={() => setOpen((o) => !o)}>{open ? 'Masquer' : 'Courbe'}</Button>
        <Button size="s" variant="ghost" onClick={onRemove} aria-label={`Retirer le test du ${dateText(result.startedAtMs)}`}>Retirer</Button>
      </span>
      {open && (
        <div className="rest-history__chart">
          <RestingHrChart series={result.series} durationS={PROTOCOL.durationS} lowest={{ fromS: result.fromS, toS: result.toS, bpm: result.lowestBpm }} height={180} />
        </div>
      )}
    </li>
  );
}

/**
 * Test de FC repos (24/10), depuis Tests : 3 minutes immobile, la FC lue sur
 * la ceinture, sans GPS ni enregistreur (`useRestingHrTest`). Le résultat est
 * la moyenne de 30 s la plus basse après la première minute, avec la courbe des 3 minutes ; on peut la
 * retenir comme FC repos de Pratiquant. Les tests faits restent sur l'appareil.
 */
function RestingHrTestPage() {
  const { search } = useLocation();
  const { results, add, remove } = useRestingHrResults();
  const { profile, retainHr } = useRunnerProfile();
  const { run, belt, beltChosen, native, error, start, cancel } = useRestingHrTest(
    (result, startedAtMs) => {
      const stored = toStoredRestingResult(result, startedAtMs, PROTOCOL);
      if (stored) add(stored);
    },
    { speed: exampleSpeed(search) }
  );

  const phase = run?.state.phase ?? null;
  const live = useMemo(
    () => (run && run.state.phase === 'mesure' ? restingHrSeries(run.state.samples, run.state.startMs, PROTOCOL) : []),
    // La courbe se refait à chaque mesure reçue, pas à chaque pas de la minuterie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run?.state.samples, run?.state.phase]
  );
  const result = run?.result ?? null;
  const retained = result?.lowestBpm != null && profile.hrRest === result.lowestBpm;
  const canRetain = result?.lowestBpm != null && result.lowestBpm >= RETAINABLE_BPM[0] && result.lowestBpm <= RETAINABLE_BPM[1];
  const beltReady = belt.state === 'connected' && belt.bpm !== null;
  const remainingS = run ? Math.ceil(restingRemainingS(run.state, run.nowMs)) : 0;

  return (
    <div className="ui-page train-page" style={{ '--help-accent': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
      <PageHeader title="FC repos" back={{ to: WORKOUT_LISTS.fractionne.listPath, label: WORKOUT_LISTS.fractionne.title }}
        subtitle={`Trois minutes immobile, la FC lue sur la ceinture, sans GPS : la moyenne de ${PROTOCOL.windowS} s la plus basse, après la première minute, est votre FC de repos.`} />

      {native && !beltChosen && (
        <div className="ui-alert ui-alert--warning">
          Aucune ceinture cardio choisie : choisissez-la dans <Link to="/parametres">Réglages</Link>, bloc « Capteurs ».
        </div>
      )}
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}

      {phase === null && (
        <>
          <Card heading={<>Déroulé<HelpToggle helpKey="repos:deroule" label="Déroulé" size="s" /></>}>
            <HelpText helpKey="repos:deroule" note>
              Le téléphone reste allumé pendant le test ; aucun GPS ni enregistrement, rien ne peut le couper.
              Si la ceinture lâche, le test va quand même à son terme, et dit la part du temps mesurée.
            </HelpText>
            <ol className="fit-steps">
              <li><strong>Installez-vous</strong>, allongé ou assis, au calme, depuis quelques minutes (le matin au réveil est idéal),
                la ceinture posée et connectée.</li>
              <li><strong>« Démarrer »</strong> : {PROTOCOL.leadInS} s pour vous poser, puis un bip court.</li>
              <li><strong>{PROTOCOL.durationS / 60} min</strong> sans bouger ni parler, en respirant calmement. Un bip long à la fin.</li>
              <li><strong>Résultat</strong> : la moyenne de {PROTOCOL.windowS} s la plus basse après les {PROTOCOL.settleS} premières secondes (le temps que le cœur se pose), avec la courbe.</li>
            </ol>
          </Card>
          <Card heading="Mesure">
            {native ? (
              <p className="rest-belt">
                Ceinture : {beltChosen ? <>{beltChosen.name}, {BELT_STATE_LABEL[belt.state]}</> : 'aucune'}
                {beltReady && <strong className="rest-belt__bpm"> · {belt.bpm} bpm</strong>}
                {belt.state === 'connected' && belt.bpm === null && ' · pas de contact avec la peau'}
                {belt.state === 'searching' && <> <BluetoothSettingsButton /></>}
              </p>
            ) : (
              <p className="train-hint">Pas de ceinture dans le navigateur : l'exemple joue une FC d'exemple, pour voir le déroulé et le résultat.</p>
            )}
            <div className="train-actions">
              {native ? (
                <Button variant="primary" disabled={!beltReady} onClick={() => start(false)}>
                  <IconPlay size={18} />
                  Démarrer
                </Button>
              ) : (
                <Button variant="primary" onClick={() => start(true)}>
                  <IconPlay size={18} />
                  Essayer avec une FC d'exemple
                </Button>
              )}
              {native && !beltReady && <span className="train-hint">« Démarrer » attend la FC de la ceinture.</span>}
            </div>
          </Card>
        </>
      )}

      {phase === 'preparation' && run && (
        <Card heading="Installez-vous">
          <p className="rest-count" role="timer" aria-live="off">{remainingS} s</p>
          <p className="train-hint">Le bip court lance les {PROTOCOL.durationS / 60} minutes.{run.simulated && ' Exemple : FC simulée.'}</p>
          <div className="train-actions rest-actions"><Button onClick={cancel}>Annuler</Button></div>
        </Card>
      )}

      {phase === 'mesure' && run && (
        <Card heading="Ne bougez pas">
          <div className="rest-live">
            <p className="rest-count" role="timer" aria-live="off">{formatMinSec(remainingS)}</p>
            <p className="rest-live__bpm">{run.bpm !== null ? <><strong>{run.bpm}</strong> bpm</> : 'pas de mesure'}</p>
          </div>
          <RestingHrChart series={live} durationS={PROTOCOL.durationS} />
          <p className="train-hint">Un bip long annoncera la fin.{run.simulated && ' Exemple : FC simulée.'}</p>
          <div className="train-actions rest-actions"><Button onClick={cancel}>Annuler</Button></div>
        </Card>
      )}

      {phase === 'fini' && run && result && (
        <Card heading={<>Résultat{result.fromS !== null && result.toS !== null && <HelpToggle helpKey="repos:resultat" label="Résultat" size="s" />}</>}>
          {result.fromS !== null && result.toS !== null && (
            <HelpText helpKey="repos:resultat" note>
              Moyenne de {PROTOCOL.windowS} s la plus basse, de {formatMinSec(result.fromS)} à {formatMinSec(result.toS)}.
            </HelpText>
          )}
          {result.lowestBpm !== null && result.fromS !== null && result.toS !== null ? (
            <>
              <p className="rest-result"><strong className="rest-result__bpm">{result.lowestBpm}</strong> bpm</p>
              <RestingHrChart series={result.series} durationS={PROTOCOL.durationS}
                lowest={{ fromS: result.fromS, toS: result.toS, bpm: result.lowestBpm }} />
              <p className="train-hint">
                Sur les {PROTOCOL.durationS / 60} minutes : moyenne {result.meanBpm} bpm, maximum {result.maxBpm} bpm.
                {' '}Mesures sur {Math.round(result.coverage * 100)} % du temps.
              </p>
              {!result.complete && (
                <div className="ui-alert ui-alert--warning">
                  Il manque des mesures (ceinture mal posée ou perdue) : ce résultat est moins sûr. À refaire.
                </div>
              )}
            </>
          ) : (
            <div className="ui-alert ui-alert--warning">Aucune mesure exploitable : vérifiez la ceinture (peau humide, bien serrée) et refaites le test.</div>
          )}
          <div className="train-actions rest-actions">
            {canRetain && (
              <Button variant="primary" disabled={retained} onClick={() => retainHr('hrRest', result.lowestBpm!, { kind: 'test', atMs: run.state.startMs })}>
                {retained ? 'Retenue comme FC repos' : 'La retenir comme FC repos'}
              </Button>
            )}
            <Button onClick={cancel}>Refaire</Button>
          </div>
          {canRetain && !retained && profile.hrRest !== null && <p className="train-hint">Votre FC repos actuelle : {profile.hrRest} bpm (Pratiquant, dans <Link to="/parametres">Réglages</Link>).</p>}
        </Card>
      )}

      {results.length > 0 && phase === null && (
        <Card heading={<>Vos tests<HelpToggle helpKey="repos:historique" label="Vos tests" size="s" /></>}>
          <HelpText helpKey="repos:historique" note>Gardés sur cet appareil (les 60 derniers).</HelpText>
          <ul className="train-list rest-history">
            {results.map((r) => <StoredResultRow key={r.startedAtMs} result={r} onRemove={() => remove(r.startedAtMs)} />)}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default RestingHrTestPage;
