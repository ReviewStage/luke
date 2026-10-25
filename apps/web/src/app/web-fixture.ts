/**
 * web-fixture.ts -- the development-only `?fixture=<profile>` switch that stands the tab's host on the desktop's synthetic data.
 *
 * The desktop's `--fixture` run draws the panel over invented data under a
 * profile (`RUN_PROFILE`), so every screen can be shot the same way. A tab
 * has no such argument, so a development server reads the profile from the
 * address instead, which lets the web profile and the phone layout be shot
 * as the desktop's are. Note that the gate is Vite's own `DEV`, which a
 * production build replaces with `false` and drops the branch it guards,
 * so no production bundle carries the switch, and a Preview, built for
 * production, ignores it as the deployment does.
 */

import { RUN_PROFILE, type RunProfile } from "@luke/host/app-state";

/** The query parameter that names the profile. */
const FIXTURE_PARAMETER = "fixture";

/**
 * The profile a development tab's address names, or none: a production
 * build, an address without the parameter, and a word that is no profile
 * all leave the tab's host live. The profiles are read here, at the moment of
 * asking, from the desktop's own list, so a profile added there is offered
 * with no change in this file.
 */
export function developmentFixtureProfile(search: string): RunProfile | undefined {
  if (!import.meta.env.DEV) return undefined;
  const named = new URLSearchParams(search).get(FIXTURE_PARAMETER);
  return Object.values(RUN_PROFILE).find((profile) => profile === named);
}
