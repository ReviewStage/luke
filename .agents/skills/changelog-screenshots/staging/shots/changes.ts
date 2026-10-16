/**
 * changes.ts -- shot E, "The Changes tab": the finished coding agent's tab beside its pull request's Changes tab, wide.
 *
 * Throwaway (`README.md`). SPEC: sidebar folded; the plan's column on the
 * finished coding agent's tab (PR pill and Changes chip); the side panel
 * wide (~900) on that agent's Changes tab: file count, +/− totals, the file
 * tree narrowed to changed files, one file's diff, the GitHub link.
 *
 * The canned agent (`coding-agent.ts`) answers everything but its changes,
 * which are #214's nine files (`changes-files.ts`), summing to the totals
 * its pull request names (+412 −38). The tab opens on the first file, the
 * memberships schema, whose one hunk shows lines removed and added.
 */

import type { CodingAgentChangesAnswerView } from "@luke/features/coding-agent-view";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { pullRequestFiles } from "./changes-files";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";

/** The pull request #214 as its Changes tab reads it. */
function changesAnswer(): CodingAgentChangesAnswerView {
  return {
    pullRequest: {
      url: "https://github.com/acme/relay/pull/214",
      truncated: false,
      files: pullRequestFiles(),
    },
  };
}

export function changesShot(): ShotSpec {
  const changes = changesAnswer();
  return {
    tasks: shotTasksView({}),
    sidePanel: { ...FIXTURE_CLOSED_PANEL, width: 900 },
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.CODING_AGENTS_CHANGES]: (payload) =>
        payload.agentId === SHOT_ID.AGENT ? changes : { pullRequest: null },
    },
    layout: {
      sidebarCollapsed: true,
      mainTab: { agent: SHOT_ID.AGENT },
      sidePanelTabs: [{ changes: SHOT_ID.AGENT }],
    },
  };
}
