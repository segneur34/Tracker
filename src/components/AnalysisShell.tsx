import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import '../pages/analysisMobile.css';
import type { ShareStat } from '../core/shareImage';
import { shareableStats } from '../core/shareImage';
import type { SportFamily } from '../core/sportProfiles';
import { libraryPath } from '../hooks/useLibraryNavigation';
import type { useSessionDraft } from '../hooks/useSessionDraft';
import AnalysisMap, { ANALYSIS_MAP_ANCHOR, type AnalysisMapProps } from './AnalysisMap';
import CollapsibleSectionTabs from './CollapsibleSectionTabs';
import type { SectionDefinition } from './SectionTabs';
import SessionNameEditor from './SessionNameEditor';
import SessionSaveBar from './SessionSaveBar';
import type { TrackSegment } from './TrackSegmentsLayer';
import PageHeader from './ui/PageHeader';

/** Carte de la page : les props d'`AnalysisMap` (l'ancre est posée ici), et le plan de sa rangée (la voile garde `zIndex: 0`). */
type ShellMap = Omit<AnalysisMapProps, 'anchorId'> & { rowZIndex?: number };

/** Barre d'onglets et panneaux, construits par le module seulement quand la session a ses chiffres. */
interface ShellTabs<K extends string> {
  sections: ReadonlyArray<SectionDefinition<K> & { primary?: true }>;
  open: Record<K, boolean>;
  onToggle: (key: K) => void;
  advanced: { open: boolean; toggle: () => void };
  accent?: string;
  panels: ReactNode;
}

interface AnalysisShellProps<K extends string> {
  /** Titre de la page (« Analyse voile »…). */
  title: ReactNode;
  /** Famille : retour à sa bibliothèque, famille de l'image de partage. */
  family: SportFamily;
  /** Libellé du retour et du lien de la phrase « Aucune session ouverte ». */
  backLabel: string;
  /** Fichier de la session, nommé sous le titre ; `null` sans session. */
  file: string | null;
  /** Image de partage : trace colorée et chiffres de « général » ; sans chiffres, pas de partage. */
  share: { segments: ReadonlyArray<TrackSegment>; stats: readonly ShareStat[] };
  /** Erreur de la session (introuvable, illisible), sous le titre. */
  error: string | null;
  /** Brouillon de la session : sa barre ; `null` pour ne pas la poser. */
  draft: ReturnType<typeof useSessionDraft> | null;
  /** Erreur de lecture du GPX, sous la barre du brouillon. */
  loadError?: string | null;
  /** Alertes propres au module, sous l'erreur de lecture. */
  alerts?: ReactNode;
  /** Aucune session demandée : la phrase qui renvoie à la bibliothèque. */
  empty: boolean;
  /** Rangée de la carte ; absente pour une session sans trace. */
  map?: ShellMap;
  tabs: ShellTabs<K> | null;
}

/** Rangée de la carte : un appel de fonction, pas un composant, pour ne rien ajouter à l'arbre de la page. */
const mapRow = ({ rowZIndex, ...props }: ShellMap) => (
  <div className="an-map-row" style={{ marginTop: '10px', zIndex: rowZIndex }}>
    <AnalysisMap {...props} anchorId={ANALYSIS_MAP_ANCHOR} />
  </div>
);

/**
 * Mise en page commune des analyses (`docs/MISE_EN_PAGE.md`) : feuille de
 * l'en-tête, barre du brouillon, alertes, phrase « Aucune session ouverte »,
 * rangée de la carte, puis colonne des onglets et de leurs panneaux. Rendu
 * seul, sans état : les modules gardent leurs hooks. Chaque emplacement a sa
 * place fixe, pour que la carte ne soit jamais remontée ; les classes `an-*`
 * sont celles d'`analysisMobile.css`.
 */
function AnalysisShell<K extends string>({
  title, family, backLabel, file, share, error, draft, loadError, alerts, empty, map, tabs,
}: AnalysisShellProps<K>) {
  const back = libraryPath(family);
  return (
    <div className="an-page" style={{ padding: '20px' }}>
      <div className="an-sheet">
        <div className="an-sheet__head">
          <PageHeader title={title} subtitle={file ? (
            <SessionNameEditor file={file}
              share={share.stats.length > 0 ? { family, segments: share.segments, stats: shareableStats(share.stats) } : undefined} />
          ) : undefined} back={{ to: back, label: backLabel }} />
          {error && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{error}</div>}
        </div>
      </div>

      {draft && <SessionSaveBar draft={draft} />}

      {loadError && (
        <div className="ui-alert ui-alert--danger" style={{ marginBottom: '10px', maxWidth: '520px' }}>
          {loadError}
        </div>
      )}

      {alerts}

      {empty && (
        <p style={{ color: 'var(--muted)' }}>
          Aucune session ouverte : choisissez-en une dans <Link to={back}>{backLabel}</Link>.
        </p>
      )}

      {map && mapRow(map)}

      {tabs && (
        <div className="an-carte-col" style={map ? undefined : { marginTop: '10px' }}>
          <CollapsibleSectionTabs sections={tabs.sections} open={tabs.open} onToggle={tabs.onToggle}
            advancedOpen={tabs.advanced.open} onToggleAdvanced={tabs.advanced.toggle} accent={tabs.accent} />
          <div className="an-carte-panels">
            {tabs.panels}
          </div>
        </div>
      )}
    </div>
  );
}

export default AnalysisShell;
