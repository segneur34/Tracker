import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonStore } from '../platform/storage';
import { EMPTY_RUNNER_PROFILE, type RunnerProfile } from '../running/runnerProfile';
import { missingProfileFields, shouldPromptProfile } from '../library/profilePrompt';
import { readRunnerProfile } from './useRunnerProfile';

describe('profil lu au premier rendu du pop-up', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const full = { ...EMPTY_RUNNER_PROFILE, name: 'Tom', birthYear: 1985, sex: 'm' as const, weightKg: 72, heightCm: 178 };
  const open = (profile: RunnerProfile) =>
    shouldPromptProfile({ native: true, missing: missingProfileFields(profile), askedThisLaunch: false, otherCardShown: false });

  it("ne s'ouvre pas quand le profil rempli est déjà rangé (régression : il revenait à chaque ouverture)", () => {
    jsonStore.write('tracker.runnerProfile', { me: full });
    expect(readRunnerProfile()).toMatchObject({ name: 'Tom', weightKg: 72 });
    expect(open(readRunnerProfile())).toBe(false);
  });

  it("s'ouvre quand rien n'est rangé", () => {
    expect(open(readRunnerProfile())).toBe(true);
  });
});
