/**
 * pages.ts -- shot H, "Pages": the plan's document narrow on the left, the side panel wide on the "Invite flow" page at "Version 2 of 2".
 *
 * Throwaway (`README.md`). SPEC: sidebar folded; the plan's document narrow
 * on the left; the side panel wide on a Page tab reading "Version 2 of 2",
 * a real-looking interactive mockup (the "Invite a teammate" dialog and the
 * accept page) drawn in its frame.
 *
 * The plan lists two pages (`page-html.ts`), so the panel's + offers both.
 * The Page tab draws the page line from the planning view; its frame reads
 * the HTML over `luke-page:`, which main answers from `page-html.ts` in a
 * fixture run under this profile (`main/services/window-service.ts`, marked
 * `Throwaway:`).
 */

import type { PageLine } from "@luke/features/page-wire";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { SHOT_PAGE_ID, SHOT_PAGE_TITLE, SHOT_PAGE_VERSIONS } from "./page-html";
import { shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";

/** The page the Page tab opens on. */
export const PAGE_ID = SHOT_PAGE_ID.INVITE_FLOW;

/** The plan's pages, the most recently written first. */
function shotPages(): PageLine[] {
  return [
    {
      id: SHOT_PAGE_ID.INVITE_FLOW,
      title: SHOT_PAGE_TITLE.INVITE_FLOW,
      version: SHOT_PAGE_VERSIONS.INVITE_FLOW,
      at: ago(3),
    },
    {
      id: SHOT_PAGE_ID.EXPIRY,
      title: SHOT_PAGE_TITLE.EXPIRY,
      version: SHOT_PAGE_VERSIONS.EXPIRY,
      at: ago(21),
    },
  ];
}

export function pagesShot(): ShotSpec {
  return {
    tasks: shotTasksView({ extra: { pages: shotPages() } }),
    sidePanel: { ...FIXTURE_CLOSED_PANEL, width: 920 },
    answers: codingAgentAnswers(),
    layout: { sidebarCollapsed: true, sidePanelTabs: [{ page: PAGE_ID }] },
  };
}
