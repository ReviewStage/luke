/**
 * shot-profiles.ts -- the registry: which shot each `--profile shot-*` launch stages, built once on first use.
 *
 * Throwaway (`README.md`). Only a fixture run stages a shot. Each shot's
 * builder lives in a file of its own and is called lazily, the first time
 * the shot is asked for, so no shot module reads another module's values at
 * load and nothing here can be caught in an import cycle; the spec built is
 * kept, so every reader is handed the same objects render after render.
 */

import type { TasksView } from "@luke/features/tasks-view";
import { RUN_PROFILE } from "@luke/host/app-state";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { appStateNow } from "../use-app-state";
import type { ShotSpec } from "./shot-spec";
import { shotAgents } from "./coding-agent";
import { pullRequestTabShot } from "./pull-request-tab";
import { chaptersShot } from "./chapters";
import { boardShot } from "./board";
import { agentsSettingsShot } from "./agents-settings";
import { tasksListShot } from "./tasks-list";
import { skillsShot } from "./skills";
import { formattingShot } from "./formatting";
import { selectSeveralShot } from "./select-several";
import { automationRunsShot } from "./automation-runs";
import { frameTabsShot } from "./frame-tabs";
import { rowMenuShot } from "./row-menu";
import { rowSheetShot } from "./row-sheet";
import { taskMarksShot } from "./task-marks";
import { browserTabShot } from "./browser-tab";
import { agentMenuShot } from "./agent-menu";

/** Each shot's builder, by its profile. */
const BUILDERS: ReadonlyMap<string, () => ShotSpec> = new Map([
  [RUN_PROFILE.SHOT_PULL_REQUEST_TAB, pullRequestTabShot],
  [RUN_PROFILE.SHOT_CHAPTERS, chaptersShot],
  [RUN_PROFILE.SHOT_BOARD, boardShot],
  [RUN_PROFILE.SHOT_AGENTS_SETTINGS, agentsSettingsShot],
  [RUN_PROFILE.SHOT_TASKS_LIST, tasksListShot],
  [RUN_PROFILE.SHOT_SKILLS, skillsShot],
  [RUN_PROFILE.SHOT_FORMATTING, formattingShot],
  [RUN_PROFILE.SHOT_SELECT_SEVERAL, selectSeveralShot],
  [RUN_PROFILE.SHOT_AUTOMATION_RUNS, automationRunsShot],
  [RUN_PROFILE.SHOT_FRAME_TABS, frameTabsShot],
  [RUN_PROFILE.SHOT_ROW_MENU, rowMenuShot],
  [RUN_PROFILE.SHOT_ROW_SHEET, rowSheetShot],
  [RUN_PROFILE.SHOT_TASK_MARKS, taskMarksShot],
  [RUN_PROFILE.SHOT_BROWSER_TAB, browserTabShot],
  [RUN_PROFILE.SHOT_AGENT_MENU, agentMenuShot],
]);

/**
 * The tasks view with the plan's two agents listed, where the shot names
 * none of its own: 0.23.0 lists an agent from the view alone, no longer from
 * an agents read.
 */
function withAgents(view: TasksView): TasksView {
  return { ...view, taskAgents: view.taskAgents ?? shotAgents() };
}

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
  const made = build();
  const spec = { ...made, planning: withAgents(made.planning) };
  built.set(run.profile, spec);
  return spec;
}

/** The shot this window stages, read from the state as it stands; none before the state has arrived. */
export function currentShot(): ShotSpec | undefined {
  return shotSpec(appStateNow()?.run);
}

/** The update a shot draws: none to install, so no Update pill; a run with no shot keeps the fixture's. */
export function shotUpdate(update: UpdateSnapshot): UpdateSnapshot {
  if (currentShot() === undefined) return update;
  return {
    status: UPDATE_STATUS.IDLE,
    currentVersion: update.currentVersion,
    installSupported: true,
    upToDate: true,
  };
}
