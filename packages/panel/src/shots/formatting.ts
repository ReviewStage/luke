/**
 * formatting.ts -- 0.20.0 shot "Formatting in plans and messages": the Teammate invitations plan open to edit, `/` typed on a fresh line under its Context, and the insert menu offering text, headings, lists, quote, code, diagram, table, divider, picture, and mention.
 *
 * Throwaway (`README.md`). The plan is drawn on the side panel's Plan tab,
 * full screen; its Context ends in a lone `/` line, so opening the editor
 * there puts the caret right after it and the `/` plugin opens its menu
 * without the document changing, so nothing saves.
 */

import { DOCUMENT_REGION } from "@luke/ui/tasks-model";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel";
import { codingAgentAnswers } from "./coding-agent";
import { onceDrawn } from "./dom-steps";
import { documentText, SHOT_SECTIONS, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { standingPlan, standingPlans } from "./board";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const BODY = documentText({ ...SHOT_SECTIONS, Context: `${SHOT_SECTIONS.Context}\n\n/` });

export function formattingShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan({ document: { body: `${BODY}\n`, assumptions: [] } }),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: { ...FIXTURE_CODE_PANEL, tab: SIDE_PANEL_TAB.PLAN },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    },
    layout: { sidePanelFullScreen: true },
    steps: [
      {
        key: "slash-menu",
        ready: ({ plans }) => plans.region.kind === DOCUMENT_REGION.READY && plans.sidePanel.fullScreen,
        run: () => {
          window.setTimeout(
            () =>
              onceDrawn('.desktop-document [data-block-kind="text"]', (block) => {
                block.focus();
                block.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
                // Note that we type the `/` again once the editor holds the caret, because the plugin opens its menu on an update, not on the editor's mount.
                const retype = (): void =>
                  onceDrawn(".plan-document-editor .ProseMirror", (editor) => {
                    editor.focus();
                    document.execCommand("delete");
                    document.execCommand("insertText", false, "/");
                    // Note that we scroll the menu to its foot, because its Insert group (diagram, table, divider, picture) is what the release adds.
                    window.setTimeout(
                      () =>
                        onceDrawn('[role="listbox"]', (list) => {
                          const near = [list, ...list.querySelectorAll<HTMLElement>("*")];
                          for (let up = list.parentElement, n = 0; up !== null && n < 4; up = up.parentElement, n++) near.push(up);
                          for (const each of near) if (each.scrollHeight > each.clientHeight + 4) each.scrollTop = each.scrollHeight;
                        }),
                      150,
                    );
                  });
                window.setTimeout(retype, 1500);
                // Note that we type it again whenever the menu is gone, because the capture's activation blurs the editor and the menu closes with it.
                const keep = window.setInterval(() => {
                  const list = document.querySelector('[role="listbox"]');
                  const top = list?.getBoundingClientRect().top;
                  // Note that a menu placed while the panel was still sliding stands off the window, so it is opened again where it belongs.
                  if (list !== null && top !== undefined && top >= 0 && top <= window.innerHeight) {
                    const near = [list as HTMLElement, ...list.querySelectorAll<HTMLElement>("*")];
                    for (const each of near) if (each.scrollHeight > each.clientHeight + 4) each.scrollTop = each.scrollHeight;
                  }
                  if (top === undefined) retype();
                  else if (top < 0 || top > window.innerHeight) {
                    document.execCommand("insertText", false, " ");
                    window.setTimeout(() => document.execCommand("delete"), 100);
                  }
                }, 700);
                window.setTimeout(() => window.clearInterval(keep), 40_000);
              }),
            1200,
          );
        },
      },
    ],
  };
}
