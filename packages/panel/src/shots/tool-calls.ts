/**
 * tool-calls.ts -- 0.24.0 shot "Tool calls in plain words": the finished agent's turn opened out, its calls read as words: files read and edited and the page fetched named by their chips, the tests as one Terminal card with what they printed, a message to the Invite emails agent as a quote, the plan updated, and #214 opened.
 *
 * Throwaway (`README.md`). The sidebar folded and the side panel closed, the
 * column on the Add teammate invitations agent. A finished turn folds its
 * calls, and each call row starts closed, so steps open the turn's fold and
 * then the Terminal card and the message, as a reader's presses would, and
 * keeps them so until the capture.
 */

import type { AgentTranscriptMessage } from "@luke/features/agent-wire";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { standingPlan, standingPlans } from "./board";
import { ago } from "./clock";
import { bash, codingAgentAnswers, MODEL, shotAgentMessages, TEST_OUTPUT, toolPart } from "./coding-agent";
import { AGENT_2_TITLE, PLAN_NAME, SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const PATCH = [
  "*** Begin Patch",
  "*** Update File: src/members/invite.ts",
  "@@ export async function withdrawInvite(inviteId: string, by: Member) {",
  "   assertSenderOrAdmin(invite, by);",
  '-  await db.memberships.update(inviteId, { state: "withdrawn" });',
  '+  await db.memberships.update(inviteId, { state: "withdrawn", inviteToken: null });',
  "*** Update File: src/members/invite.test.ts",
  "@@",
  "+it(\"refuses a withdrawn invite's old link\", async () => {",
  "+  await withdrawInvite(invite.id, dana);",
  '+  await expect(acceptInvite(invite.token, sam.id)).rejects.toThrow("no-longer-valid");',
  "+});",
  "*** End Patch",
].join("\n");

/** The calls drawn open: the tests' Terminal card and the message to the Invite emails agent. */
const CALLS_OPEN = ["call_tc4", "call_tc5"];

const MESSAGE =
  "Withdrawing an invite now clears its `invite_token`, so an old link is refused.\n\n" +
  "If the email shows a link, read it from `acceptUrl(invite)` rather than building it.";

/** The finished agent's transcript as 0.24.0 draws it: its brief and first turn, then Dana's review passed on, and the turn that answered it. */
function toolCallMessages(): AgentTranscriptMessage[] {
  return [
    ...shotAgentMessages(),
    {
      id: "t-review",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Dana asked on #214 whether withdrawing an invite also clears `invite_token`, so an old link can never be replayed. Make it so, with a test.",
        },
      ],
    },
    {
      id: "t-turn",
      role: "assistant",
      startedAt: ago(19),
      finishedAt: ago(12),
      model: MODEL.OPUS,
      effort: "high",
      tokens: { inputTokens: 412_880, outputTokens: 6_214, cachedInputTokens: 371_500 },
      parts: [
        { type: "step-start" },
        toolPart(
          "read_file",
          "call_tc1",
          { filePath: "src/members/invite.ts" },
          { content: "export async function withdrawInvite(inviteId: string, by: Member) {\n  …\n}\n" },
        ),
        toolPart(
          "read_web_page",
          "call_tc2",
          { url: "https://www.postgresql.org/docs/current/sql-update.html" },
          { text: "UPDATE changes the values of the specified columns in all rows that satisfy the condition." },
        ),
        toolPart(
          "apply_patch",
          "call_tc3",
          { patchText: PATCH },
          {
            files: [
              { operation: "update", path: "src/members/invite.ts" },
              { operation: "update", path: "src/members/invite.test.ts" },
            ],
          },
        ),
        bash("call_tc4", "pnpm test src/members", TEST_OUTPUT.replace("6 tests", "7 tests").replace("15 passed (15)", "16 passed (16)"), "Run the members tests"),
        toolPart(
          "message_agent",
          "call_tc5",
          { agentId: SHOT_ID.AGENT_2, text: MESSAGE },
          {
            status: "accepted",
            agent: {
              id: SHOT_ID.AGENT_2,
              title: AGENT_2_TITLE,
              model: MODEL.SOL,
              status: "running",
              onYourTask: true,
            },
          },
        ),
        toolPart(
          "edit_plan",
          "call_tc6",
          {
            notes: [
              {
                kind: "add",
                section: "Decisions",
                text: "- Withdrawing an invite clears its token, so an old link is refused.",
              },
            ],
          },
          { status: "accepted" },
        ),
        bash("call_tc7", "git push", "To github.com:acme/relay.git\n   7c1d2e3..4f1c2a9  luke/teammate-invitations -> luke/teammate-invitations\n"),
        { type: "step-start" },
        {
          type: "text",
          text:
            "Done: `withdrawInvite` now clears `invite_token` alongside the state, and a new test opens a withdrawn invite's old link and is refused. " +
            `\`pnpm test src/members\` passes, I pushed it to #214, told the Invite emails agent, and noted the decision in ${PLAN_NAME}'s plan.`,
        },
      ],
    },
  ];
}

/** Whether a fold or call row stands open: the `<details>` it is, or the one it sits in. */
function opened(element: Element): HTMLDetailsElement | undefined {
  return element instanceof HTMLDetailsElement ? element : (element.closest("details") ?? undefined);
}

/** Opens the last turn's fold of calls, then its Terminal card and its message, and keeps them open until the capture. */
const OPEN_CALLS: ShotStep = {
  key: "open-calls",
  ready: () => true,
  run: () => {
    const open = (details: HTMLDetailsElement | undefined): void => {
      if (details !== undefined && !details.open) details.querySelector<HTMLElement>(":scope > summary")?.click();
    };
    window.setInterval(() => {
      const folds = document.querySelectorAll("[data-turn-fold]");
      const last = folds[folds.length - 1];
      // Note that the last fold is the answered turn's only once the transcript has both turns.
      if (last === undefined || folds.length < 2) return;
      open(opened(last));
      for (const id of CALLS_OPEN) {
        const row = document.querySelector(`[data-call-id="${id}"]`);
        if (row !== null) open(opened(row));
      }
      // The opened calls grow the transcript past its foot, so it is scrolled back down to the turn's last words.
      const log = document.querySelector<HTMLElement>('.desktop-task-column [role="log"]');
      for (let box = log; box !== null; box = box.parentElement) {
        if (box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== "visible") {
          box.scrollTop = box.scrollHeight;
          break;
        }
      }
    }, 700);
  },
};

export function toolCallsShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: codingAgentAnswers(toolCallMessages),
    layout: { sidebarCollapsed: true, mainTab: { agent: SHOT_ID.AGENT } },
    steps: [
      OPEN_CALLS,
    ],
  };
}
