import type { ComponentProps } from 'react';
import HeartRatePanel from './HeartRatePanel';
import ResizablePanel from './ResizablePanel';
import { ANALYSIS_PANEL_STYLE } from './styles';

type PanelProps = ComponentProps<typeof HeartRatePanel>;

/**
 * Onglet « cardio » d'une analyse, le même dans les quatre modules : le
 * `ResizablePanel` d'`id` donné et `HeartRatePanel`, dont la FC max du
 * pratiquant se lit dans `runner`. `zone` est la zone montrée sur la carte et
 * son choix (`useHeartRateZoneHighlight`), absent sans carte (muscu).
 */
export default function CardioTab({ id, runner, zone, ...panel }: Omit<PanelProps, 'profileHrMax' | 'selectedZone' | 'onSelectZone'> & {
  id: string;
  zone?: { selectedZone: number | null; select: (zone: number | null) => void };
}) {
  return (
    <ResizablePanel id={id} style={ANALYSIS_PANEL_STYLE}>
      <HeartRatePanel {...panel} runner={runner} profileHrMax={runner.hrMax}
        selectedZone={zone?.selectedZone ?? null} onSelectZone={zone?.select ?? NO_SELECTION} />
    </ResizablePanel>
  );
}

/** Choix de zone d'une session sans carte : rien à montrer. */
const NO_SELECTION = (): void => undefined;
