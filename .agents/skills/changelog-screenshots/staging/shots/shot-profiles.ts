/**
 * shot-profiles.ts -- the registry: which shot each `--profile shot-*` launch stages, built once on first use.
 *
 * Throwaway (`README.md`). Only a fixture run stages a shot. Each shot's
 * builder lives in a file of its own and is called lazily, the first time
 * the shot is asked for, so no shot module reads another module's values at
 * load and nothing here can be caught in an import cycle; the spec built is
 * kept, so every reader is handed the same objects render after render.
 */

import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateNow } from "../use-app-state";
import { callShot } from "./call";
import { changesShot } from "./changes";
import { documentShot } from "./document";
import { historyShot } from "./history";
import { inboxShot } from "./inbox";
import { integrationsShot } from "./integrations";
import { pagesShot } from "./pages";
import { paletteShot } from "./palette";
import { tasksShot } from "./tasks";
import type { ShotSpec } from "./shot-spec";
import { skillsShot } from "./skills";

/** Each shot's builder, by its profile. */
const BUILDERS: ReadonlyMap<string, () => ShotSpec> = new Map([
  [RUN_PROFILE.SHOT_CALL, callShot],
  [RUN_PROFILE.SHOT_DOCUMENT, documentShot],
  [RUN_PROFILE.SHOT_HISTORY, historyShot],
  [RUN_PROFILE.SHOT_INBOX, inboxShot],
  [RUN_PROFILE.SHOT_CHANGES, changesShot],
  [RUN_PROFILE.SHOT_SKILLS, skillsShot],
  [RUN_PROFILE.SHOT_PAGES, pagesShot],
  [RUN_PROFILE.SHOT_INTEGRATIONS, integrationsShot],
  [RUN_PROFILE.SHOT_TASKS, tasksShot],
  [RUN_PROFILE.SHOT_PALETTE, paletteShot],
]);

/** Each shot as built, by its profile. */
const built = new Map<string, ShotSpec>();

/** The shot a run stages: one of the shot profiles in a fixture run, else none. */
export function shotSpec(
  run: { readonly fixtureMode: boolean; readonly profile: string } | undefined,
): ShotSpec | undefined {
  if (run === undefined || !run.fixtureMode) return undefined;
  const build = BUILDERS.get(run.profile);
  if (build === undefined) return undefined;
  const held = built.get(run.profile);
  if (held !== undefined) return held;
  const spec = build();
  built.set(run.profile, spec);
  return spec;
}

/** The shot this window stages, read from the state as it stands; none before the state has arrived. */
export function currentShot(): ShotSpec | undefined {
  return shotSpec(appStateNow()?.run);
}
