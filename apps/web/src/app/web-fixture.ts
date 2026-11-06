import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";

const FIXTURE_PARAMETER = "fixture";

export function developmentFixtureProfile(search: string): RunProfile | undefined {
  if (!import.meta.env.DEV) return undefined;
  const named = new URLSearchParams(search).get(FIXTURE_PARAMETER);
  return Object.values(RUN_PROFILE).find((profile) => profile === named);
}
