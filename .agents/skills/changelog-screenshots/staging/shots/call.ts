/**
 * call.ts -- shot A, "The Call tab": two calls about "Teammate invitations" read as one thread, Luke's work under the line that asked for it.
 *
 * Throwaway (`README.md`). SPEC: sidebar folded, side panel full screen on
 * Call. Yesterday's call settles who can withdraw an invite: the developer
 * asks, and Luke's finished work stands under the ask (a thought, two
 * repository commands, a subagent on Sonnet 5.5 Medium, and a `run_on_mac`
 * `git log` so "On your Mac" draws), ending on "Worked for 52s"; Luke's
 * answer and the rest of the call follow, and the call closes on
 * "Call ended · 12m 41s" with its card (gpt-live-1, metered seconds). Then
 * the call standing now, about how long an invite stays good, ends on a
 * turn Luke started twenty seconds before launch, so it reads
 * "Working… 20s". Every time is counted back from launch (`clock.ts`), and
 * every word, command, and output is invented.
 *
 * A finished spoken turn folds behind one line, so a staging step opens
 * every closed turn fold on the Call tab once, as a developer reading it
 * would, leaving each call's own row (and its output) folded.
 */

import {
  TASK_WORK_PART,
  TASK_WORK_STATE,
  TASK_WORK_TOOL,
  TASKS_READ,
  type TaskWorkPart,
  type TaskWorkTurn,
} from "@luke/features/planning-view";
import {
  type TaskTranscript,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@luke/features/transcript-wire";
import {
  LIVE_CLOSE_REASON,
  LIVE_DEFAULTS,
  LIVE_STATUS,
  TRANSCRIPT_SPEAKER,
  type TranscriptSpeaker,
} from "@luke/live";
import { FIXTURE_CALL_PANEL } from "../tasks/tasks-fixture";
import { ago, secondsAgo } from "./clock";
import { codingAgentAnswers, MODEL } from "./coding-agent";
import { SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec, ShotStep } from "./shot-spec";

const { USER, ASSISTANT } = TRANSCRIPT_SPEAKER;

const SECOND_MS = 1_000;

/** Yesterday's call: when it started, and how long it ran. */
const EARLIER_START = ago(25 * 60 + 10);
const EARLIER_LENGTH_MS = (12 * 60 + 41) * SECOND_MS;

/** The call standing now, by the store's id for its session, and when it started. */
const LIVE_SESSION = "6b8d0f2a-4c6e-4b8d-9f1a-3c5e7a9b1d2f";
const LIVE_START = ago(4);

/** The row ids the voice wrote for yesterday's lines, which the turn names its ask by. */
const EARLIER_ASK_ROW = "shot-earlier-0";

/** Yesterday's lines, in order: the developer's ask, Luke's answer after his work, and the decision. */
const EARLIER_LINES: readonly (readonly [TranscriptSpeaker, string])[] = [
  [
    USER,
    "Before we write the withdraw part: who can take an invite back today? Just whoever sent it?",
  ],
  [
    ASSISTANT,
    "Just the sender. withdrawInvite checks invitedBy and nothing else, and the commit that added it says sender only for now. Removing a member already lets any admin do it.",
  ],
  [
    USER,
    "Then admins should be able to withdraw too, same as removal. And a withdrawn link should read like a used one.",
  ],
  [
    ASSISTANT,
    "Agreed. The sender or any workspace admin can withdraw a pending invite, and a withdrawn or accepted link reads \u201cThis invite is no longer valid.\u201d Both are in the plan now.",
  ],
  [USER, "Good, that settles withdrawing. Let's pick up expiry next time."],
];

/** The lines heard on the call standing now: who spoke, the words, and where on the call they began and ended. */
const LIVE_LINES: readonly (readonly [TranscriptSpeaker, string, number, number])[] = [
  [USER, "Picking up expiry. Is seven days still right for an invite link?", 1_400, 4_600],
  [
    ASSISTANT,
    "It's what the plan assumes. Should admins be able to change it per workspace?",
    5_200,
    9_300,
  ],
  [
    USER,
    "Not yet. Keep seven days, but check whether workspaces have a settings table we could hang an override on later.",
    10_200,
    16_400,
  ],
];

/** Where the developer's last line on the call standing now began, which the running turn names its ask by. */
const LIVE_ASK_FROM_MS = 10_200;

/** One of yesterday's lines as the record answers it, named by its place and by the row the voice wrote. */
function earlierMessage([role, text]: readonly [TranscriptSpeaker, string], index: number) {
  const message: TranscriptMessage = {
    id: String(index),
    role,
    parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    metadata: { rowIds: [`shot-earlier-${index}`] },
  };
  return message;
}

/** What the record holds: yesterday's call, ended, and the one standing now, whose words the voice window reports. */
function shotTranscript(): TaskTranscript {
  return {
    calls: [
      {
        id: SHOT_ID.CALL,
        startedAt: EARLIER_START,
        messages: EARLIER_LINES.map(earlierMessage),
        endedAt: EARLIER_START + EARLIER_LENGTH_MS,
        ending: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: EARLIER_LENGTH_MS / SECOND_MS + 3, confirmed: true },
        model: LIVE_DEFAULTS.MODEL,
      },
      {
        id: LIVE_SESSION,
        startedAt: LIVE_START,
        messages: LIVE_LINES.map(([role, text], index) => ({
          id: String(index),
          role,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
        })),
      },
    ],
    earlierOmitted: false,
  };
}

/** A command the planning model ran, in the plan's repository or on the developer's Mac, answered with `output`. */
function command(
  id: string,
  where: typeof TASK_WORK_TOOL.REPOSITORY | typeof TASK_WORK_TOOL.MAC_COMMAND,
  line: string,
  output: string | undefined,
) {
  return {
    type: TASK_WORK_PART.TOOL,
    id,
    tool: where,
    name: where === TASK_WORK_TOOL.MAC_COMMAND ? "run_on_mac" : "run_in_repository",
    state: output === undefined ? TASK_WORK_STATE.RUNNING : TASK_WORK_STATE.DONE,
    subject: line,
    input: JSON.stringify({ command: line }),
    ...(output === undefined ? undefined : { output }),
  } as const;
}

/** The subagent yesterday's turn handed a search to, finished, on Sonnet 5.5 at medium effort. */
function subagent(startedAt: number): TaskWorkPart {
  const task =
    "Find every place that reads a pending membership, so withdrawing an invite doesn't strand a row.";
  return {
    type: TASK_WORK_PART.TOOL,
    id: "shot-call-worker",
    tool: TASK_WORK_TOOL.WORKER,
    name: "worker",
    state: TASK_WORK_STATE.DONE,
    subject: task,
    task: "task_4kR9wPz2",
    input: JSON.stringify({ message: task }),
    session: {
      earlierOmitted: false,
      title: "Pending membership readers",
      startedAt,
      endedAt: startedAt + 26 * SECOND_MS,
      model: MODEL.SONNET,
      effort: "medium",
      tokens: { inputTokens: 21_480, outputTokens: 912, cachedInputTokens: 14_336 },
      parts: [
        command(
          "shot-worker-1",
          TASK_WORK_TOOL.REPOSITORY,
          'rg -n "pending" src/members src/workspaces',
          "src/members/invite.ts:18:    state: 'pending',\n" +
            "src/members/list.ts:22:  .where(eq(memberships.state, 'active'))\n" +
            "src/workspaces/seats.ts:31:  // pending invites hold a seat until accepted",
        ),
        {
          type: TASK_WORK_PART.TEXT,
          text: "Three readers: invite.ts writes it, list.ts filters it out, and seats.ts counts it as a seat. Withdrawing should delete the row so the seat frees up.",
        },
      ],
    },
  };
}

/**
 * What Luke did on the plan's calls: yesterday's turn, finished, under the
 * developer's ask; and the turn standing now, twenty seconds in, under the
 * developer's last line on the call.
 */
function shotWork(): TaskWorkTurn[] {
  const askedAt = EARLIER_START + 9 * SECOND_MS;
  return [
    {
      turnId: "shot-turn-withdraw",
      startedAt: askedAt,
      endedAt: askedAt + 52 * SECOND_MS,
      state: TASK_WORK_STATE.DONE,
      earlierOmitted: false,
      asked: [EARLIER_ASK_ROW],
      model: MODEL.SOL,
      effort: "medium",
      tokens: { inputTokens: 48_215, outputTokens: 1_874, cachedInputTokens: 36_864 },
      parts: [
        {
          type: TASK_WORK_PART.REASONING,
          text: "Who can withdraw today? Read withdrawInvite, hand the pending-membership readers to a subagent, and check the history for why it is sender-only.",
        },
        command(
          "shot-call-1",
          TASK_WORK_TOOL.REPOSITORY,
          "rg -n \"state = 'pending'\" src",
          "src/db/schema/memberships.ts:14:  // state = 'pending' until the invite is accepted\n" +
            "src/members/invite.ts:18:    state: 'pending',",
        ),
        command(
          "shot-call-2",
          TASK_WORK_TOOL.REPOSITORY,
          "sed -n 40,52p src/members/invite.ts",
          "export async function withdrawInvite(invite: Invite, by: Member) {\n" +
            "  if (invite.invitedBy !== by.id) throw new InviteError('not-yours');\n" +
            "  await db.memberships.delete(invite.membershipId);\n" +
            "}",
        ),
        subagent(askedAt + 14 * SECOND_MS),
        command(
          "shot-call-3",
          TASK_WORK_TOOL.MAC_COMMAND,
          "git -C ~/code/relay log --oneline -3 -- src/members",
          JSON.stringify({
            stdout:
              "e81f2c4 Withdraw a pending invite (sender only for now)\n" +
              "7d03b18 Pending memberships for invites\n" +
              "2a9c6f1 Remove a member: require an admin\n",
            stderr: "",
            exitCode: 0,
          }),
        ),
        {
          type: TASK_WORK_PART.TEXT,
          text: "Only the sender can withdraw today: withdrawInvite checks invitedBy and nothing else, and e81f2c4 calls that a stopgap. removeMember already allows any admin through assertAdmin.",
        },
      ],
    },
    {
      turnId: "shot-turn-expiry",
      startedAt: secondsAgo(20),
      state: TASK_WORK_STATE.RUNNING,
      earlierOmitted: false,
      askedAt: [{ voiceSessionId: LIVE_SESSION, fromMs: LIVE_ASK_FROM_MS }],
      model: MODEL.SOL,
      effort: "medium",
      parts: [
        {
          type: TASK_WORK_PART.REASONING,
          text: "Seven days stays the default. Look for a per-workspace settings table an expiry override could live in.",
        },
        command(
          "shot-call-4",
          TASK_WORK_TOOL.REPOSITORY,
          "ls src/db/schema",
          "invites.ts\nmemberships.ts\nusers.ts\nworkspaces.ts",
        ),
        command(
          "shot-call-5",
          TASK_WORK_TOOL.REPOSITORY,
          'rg -n "settings" src/db/schema/workspaces.ts',
          undefined,
        ),
      ],
    },
  ];
}

/** The call standing now as the voice window reports it: listening, on the plan, with its lines and their spans. */
function shotCall(): NonNullable<ShotSpec["call"]> {
  return {
    voiceStatus: LIVE_STATUS.LISTENING,
    callTaskId: SHOT_ID.TASK,
    callTranscript: {
      voiceSessionId: LIVE_SESSION,
      lines: LIVE_LINES.map(([speaker, words, startMs, endMs], index) => ({
        rowId: `shot-live-${index}`,
        speaker,
        words,
        startMs,
        endMs,
      })),
    },
  };
}

/**
 * A closed turn fold on the Call tab not yet opened by the staging: a
 * finished turn's lead or a run of calls, never a call's own row, whose
 * output stays folded.
 */
const CLOSED_FOLD =
  '.task-call details[data-turn-fold]:not([data-shot-opened]) > summary[aria-expanded="false"]';

/** Opens every closed turn fold on the Call tab once, a nested one as its parent's opening draws it. */
function openFolds(): void {
  for (const summary of document.querySelectorAll<HTMLElement>(CLOSED_FOLD)) {
    const fold = summary.parentElement;
    if (fold === null) continue;
    fold.dataset.shotOpened = "true";
    summary.click();
  }
}

/** The step that keeps the Call tab's folds open as they are drawn: a finished turn's lead and the run of calls inside it. */
const OPEN_FOLDS: ShotStep = {
  key: "call-open-folds",
  ready: () => true,
  run: () => {
    new MutationObserver(openFolds).observe(document.body, { childList: true, subtree: true });
    openFolds();
  },
};

export function callShot(): ShotSpec {
  return {
    tasks: shotTasksView({
      extra: {
        transcript: { status: TASKS_READ.READY, transcript: shotTranscript() },
        work: shotWork(),
      },
    }),
    sidePanel: FIXTURE_CALL_PANEL,
    call: shotCall(),
    answers: codingAgentAnswers(),
    layout: { sidebarCollapsed: true, sidePanelFullScreen: true },
    steps: [OPEN_FOLDS],
  };
}
