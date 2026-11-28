package io.github.segneur.tracker;

/**
 * Garde des écritures de l'ordinateur par la liaison sans fil (ComputerLinkCommands) : vrai tant que l'un des trois
 * services de premier plan de l'application tourne, l'enregistrement (RecordingService), la séance à la ceinture
 * cardio sans GPS (HeartRateService) ou le compteur du fractionné (IntervalTimerService). Rien n'est alors écrit ni
 * déplacé sur le téléphone, et le `pong` le dit (`enregistre`).
 *
 * C'est la même liste que celle du câble, qui lit ces services dans `dumpsys` (`SERVICES_APPLICATION` de
 * bureau/telephone.ts, dans le même ordre, tenu égal par src/platform/nativeConstants.test.ts).
 */
final class ForegroundWork {

    private ForegroundWork() {}

    /** Vrai si un service de premier plan de l'application tourne. */
    static boolean busy() {
        return RecordingService.snapshot().running || HeartRateService.isRunning() || IntervalTimerService.isRunning();
    }
}
