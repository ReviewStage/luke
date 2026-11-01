/**
 * queue.ts -- 0.24.0 shot "Queue a message behind a turn": the Invite emails agent twenty seconds into a turn, three follow-ups queued over its message box, the first under the pointer with Steer, Edit, and Delete.
 *
 * Throwaway (`README.md`). The agent runs on Codex, which queues a
 * follow-up behind its turn. Its first turn finished with #216 as a draft;
 * Dean asked for the plain-text fallback seconds before launch, and while
 * that turn works he queued three more. The sidebar folded and the side
 * panel closed; one step holds the first queued row as a pointer resting on
 * it draws it, its actions out.
 */

import type { AgentTranscriptMessage } from "@luke/features/agent-wire";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { standingPlan, standingPlans } from "./board";
import { ago, secondsAgo } from "./clock";
import { bash, codingAgentAnswers, MODEL, toolPart } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

/** When Dean's follow-up started the running turn: about twenty seconds before the capture. */
const TURN_STARTED = secondsAgo(13);

const QUEUED = [
  "Use the workspace's name in the preview text too, not just the subject",
  "Then add a test that a withdrawn invite's email link is refused",
  "Mark #216 ready for review once the checks pass",
];

/** The Invite emails agent's transcript: its task, the turn that drafted #216, and Dean's follow-up, still being worked. */
function queueMessages(): AgentTranscriptMessage[] {
  return [
    {
      id: "q-task",
      role: "user",
      parts: [
        { type: "text", text: "Send the invite email through Postmark, with the workspace's name in the subject." },
      ],
    },
    {
      id: "q-turn-1",
      role: "assistant",
      startedAt: ago(6),
      finishedAt: ago(1),
      model: MODEL.SOL,
      effort: "high",
      parts: [
        { type: "step-start" },
        bash("call_q1", 'grep -rn "postmark" src', "src/mail/client.ts:3:import { ServerClient } from 'postmark';"),
        toolPart("read_file", "call_q2", { filePath: "src/mail/client.ts" }, { content: "export const postmark = new ServerClient(env.POSTMARK_TOKEN);\n" }),
        toolPart(
          "write_file",
          "call_q3",
          { filePath: "src/mail/templates/invite.tsx", content: "export function InviteEmail({ workspace, url }: InviteProps) {…}\n" },
          { ok: true },
        ),
        bash("call_q4", "pnpm test src/mail", " ✓ src/mail/invite.test.ts (3 tests) 204ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)"),
        { type: "step-start" },
        {
          type: "text",
          text:
            "Invites now go out through Postmark's `invite` template, with the workspace's name in the subject: " +
            "\"Dana invited you to acme on Relay\". It's on #216 as a draft. Should the email carry a plain-text part for clients that block HTML?",
        },
      ],
    },
    {
      id: "q-follow-up",
      role: "user",
      sentAt: TURN_STARTED,
      parts: [{ type: "text", text: "Yes, add the plain-text fallback, and send me a preview of both." }],
    },
    {
      id: "q-turn-2",
      role: "assistant",
      startedAt: TURN_STARTED,
      model: MODEL.SOL,
      effort: "high",
      parts: [
        { type: "step-start" },
        {
          type: "text",
          text: "Adding a plain-text part beside the HTML one, rendered from the same props, then a preview of each.",
        },
        toolPart(
          "read_file",
          "call_q5",
          { filePath: "src/mail/templates/invite.tsx" },
          { content: "export function InviteEmail({ workspace, url }: InviteProps) {…}\n" },
        ),
        toolPart(
          "write_file",
          "call_q6",
          { filePath: "src/mail/templates/invite.txt.ts", content: "export function inviteText({ workspace, url }: InviteProps): string {…}\n" },
          { ok: true },
        ),
        bash("call_q7", "pnpm email:preview invite", " Rendered invite.html and invite.txt to .preview/\n"),
      ],
    },
  ];
}

/** Draws the first queued row as the pointer resting on it does, its actions out, and keeps it so as the dock redraws. */
const REST_ON_FIRST: ShotStep = {
  key: "rest-on-first",
  ready: () => true,
  run: () => {
    window.setInterval(() => {
      const row = document.querySelector<HTMLElement>(".agent-queue-rows li.luke-list-row");
      if (row !== null && row.dataset.menuOpen !== "true") row.dataset.menuOpen = "true";
    }, 200);
  },
};

export function queueShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    readerId: MEMBER.DEAN.userId,
    answers: codingAgentAnswers(undefined, {
      messages: queueMessages,
      startedAt: ago(6),
      queue: {
        revision: 3,
        messages: QUEUED.map((text, at) => ({
          id: `5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1${String(at)}`,
          text,
          queuedBy: MEMBER.DEAN.userId,
        })),
      },
    }),
    layout: { sidebarCollapsed: true, mainTab: { agent: SHOT_ID.AGENT_2 } },
    steps: [REST_ON_FIRST],
  };
}
