/**
 * Onglet « réglages » de la voile : vitesse lue, activité de la session (d'une famille à l'autre comprise), seuil
 * d'activité, foil et pumping, allure et bornes des couleurs de la trace, tous propres à la session et gardés
 * en brouillon jusqu'à « Enregistrer la session », sauf l'activité qui se change aussitôt.
 */
import type { Activity } from '../../core/activities';
import type { effectiveSpeedRange } from '../../core/trackColor';
import type { SpeedUnit } from '../../core/units';
import type { useAnalysisSession } from '../../hooks/useAnalysisSession';
import type { useSessionDraft } from '../../hooks/useSessionDraft';
import { carriedSettings } from '../../library/record';
import { carriedThresholdNote } from '../../library/summaryOptions';
import FoilPumpingFields from '../FoilPumpingFields';
import ResizablePanel from '../ResizablePanel';
import SessionActivityField from '../SessionActivityField';
import SessionSettingsHeader from '../SessionSettingsHeader';
import SessionThresholdField from '../SessionThresholdField';
import { SessionColorRangeField } from '../SpeedRangeEditor';
import { PANEL_BLOCK_STYLE } from '../styles';

interface SailingSettingsPanelProps {
  open: boolean;
  onToggle: () => void;
  /** Brouillon de la session : seuil, foil, pumping, allure et couleurs y restent jusqu'à l'enregistrement. */
  draft: ReturnType<typeof useSessionDraft>;
  /** Fiche de la session, pour le seuil avec lequel elle a été calculée. */
  draftRecord: ReturnType<typeof useAnalysisSession>['record'];
  /** Vitesse Doppler de l'appareil, sinon dérivée des positions. */
  hasDeviceSpeed: boolean;
  /** Activités proposées, toutes pour une session de la mémoire. */
  activities: Activity[];
  activity: Activity;
  /** Fichier de la session dans la mémoire, `null` hors de la mémoire (activités de la voile seules). */
  sessionFile: string | null;
  onChangeActivity: (next: Activity) => void;
  /** Le support a un seuil d'activité (pas le bateau). */
  hasActiveThreshold: boolean;
  /** Seuils d'activité en nœuds : effectif, défaut, et celui réglé sur l'appareil. */
  activeThresholdKn: number;
  defaultActiveThresholdKn: number;
  deviceThresholdKn: number | null;
  /** Foil effectif de la session, et pumping de l'activité et de la session. */
  foil: boolean;
  activityPumping: boolean;
  pumping: boolean;
  /** La case Pumping se montre (sur foil, calcul qui mesure le pumping). */
  showPumping: boolean;
  /** La trace a des points : allure et couleurs se règlent. */
  hasTrack: boolean;
  /** Allure de la session, en m/s. */
  referenceSpeedMs: number;
  speedUnit: SpeedUnit;
  colorRange: ReturnType<typeof effectiveSpeedRange>;
  /** Seuil en nœuds, tel qu'il s'écrit (`showThreshold` du module). */
  showThreshold: (kn: number) => string;
  speedSymbol: string;
}

export default function SailingSettingsPanel({
  open, onToggle, draft, draftRecord, hasDeviceSpeed, activities, activity, sessionFile, onChangeActivity, hasActiveThreshold,
  activeThresholdKn, defaultActiveThresholdKn, deviceThresholdKn, foil, activityPumping, pumping, showPumping, hasTrack, referenceSpeedMs,
  speedUnit, colorRange, showThreshold, speedSymbol,
}: SailingSettingsPanelProps) {
  const { edits } = draft;
  return (
    <ResizablePanel id="sailing.reglages" style={PANEL_BLOCK_STYLE}>
      <SessionSettingsHeader helpKey="voile:reglages" open={open} onToggle={onToggle}>
        Vitesse : {hasDeviceSpeed ? "Doppler de l'appareil" : 'dérivée des positions, filtrée'}.
      </SessionSettingsHeader>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <SessionActivityField activities={activities} activity={activity} withPositions families={sessionFile ? undefined : ['voile']}
          onChange={onChangeActivity} />

        {hasActiveThreshold && (
          <div style={{ fontSize: 'var(--text-s)' }}>
            <SessionThresholdField
              label="Seuil d'activité"
              title="Seuil propre à cette session, enregistré avec elle. Sans lui, elle garde celui avec lequel elle a été calculée ; le changer dans Réglages recalcule les sessions de l'activité."
              value={activeThresholdKn}
              defaultValue={defaultActiveThresholdKn}
              isOverridden={edits.activeThreshold !== null}
              note={draftRecord && carriedThresholdNote(carriedSettings(draftRecord).threshold, deviceThresholdKn, (kn) => `${showThreshold(kn)} ${speedSymbol}`)}
              unit={speedUnit}
              thresholdUnit="kn"
              onChange={(next) => draft.update({ activeThreshold: next })} />
          </div>
        )}

        <FoilPumpingFields
          foilTitle="Support sur foil pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages."
          foil={foil} foilIsDefault={edits.foil === null} onFoilChange={(next) => draft.update({ foil: next })}
          showPumping={showPumping} pumping={pumping} pumpingIsDefault={edits.pumping === null}
          onPumpingChange={(next) => draft.update({ pumping: next === activityPumping ? null : next })} />

        {hasTrack && (
          <div style={{ fontSize: 'var(--text-s)' }}>
            <SessionThresholdField
              label="Allure de la session"
              title="Vitesse de croisière de la session, dont dépendent les seuils de filtrage. Déduite de la trace ; imposée si elle la décrit mal, et alors enregistrée avec la session."
              value={referenceSpeedMs}
              isOverridden={edits.referenceSpeedMs !== null}
              unit={speedUnit}
              thresholdUnit="ms"
              hint="déduite de la trace"
              commit="blur"
              onChange={(next) => draft.update({ referenceSpeedMs: next })} />
          </div>
        )}
      </div>
      {hasTrack && (
        <div style={{ marginTop: '12px', fontSize: 'var(--text-s)' }}>
          <SessionColorRangeField unit={speedUnit} range={colorRange} isOverridden={edits.speedRange !== null}
            onChange={(next) => draft.update({ speedRange: next })} />
        </div>
      )}
    </ResizablePanel>
  );
}
