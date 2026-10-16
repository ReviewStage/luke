/**
 * document.ts -- shot B, "The plan is one document": the plan written through every heading, its sections' bylines showing who last changed each.
 *
 * Throwaway (`README.md`). Sidebar open, side panel closed, no call, the
 * summary folded to its rail: the plan's column alone, its document
 * centred, "Edited by Luke during your call · 4m ago" over the title, and
 * each section's byline (Luke, the coding agent, and you, minutes to an hour
 * ago) as the app draws it at rest: under the pointer.
 */

import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { codingAgentAnswers } from "./coding-agent";
import { shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";

export function documentShot(): ShotSpec {
  return {
    tasks: shotTasksView({}),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: codingAgentAnswers(),
    layout: { sidebarCollapsed: true },
  };
}
