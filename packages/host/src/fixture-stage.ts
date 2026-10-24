/**
 * fixture-stage.ts -- what a fixture run's profiles stage on the host's side: a call standing into the fixture's agent, and the page that agent showed.
 *
 * A fixture run raises no voice window and reads no service, so the call a
 * call profile shoots and the page the page profile opens are staged here,
 * where every window reads them from: the call in the document's voice slice
 * at launch, which the panel's call bar and card and the floating call
 * window draw and main's call window presence answers to, and the page as
 * the answer main's page frames read in place of the service's. The panel's
 * own fixture (`packages/panel/src/tasks/tasks-fixture.ts`,
 * `agent-fixture.ts`) names the same task, agent, and page by the ids
 * below. Everything here is invented; nothing is read from an account.
 */

import { PAGE_SHOWER, type PageVersion } from "@luke/features/page-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  type TasksPageAnswer,
  type TasksPageParams,
} from "@luke/features/tasks-view";
import { LIVE_STATUS, TRANSCRIPT_SPEAKER } from "@luke/live";
import { AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceCallTranscript } from "@luke/voice/voice-view";
import { type AppState, RUN_PROFILE } from "./app-state.js";

/** The fixture's workspace, its task, the task's coding agent, and the page that agent showed on it, by the ids every window names them by. */
export const FIXTURE_IDS = {
  WORKSPACE: "workspace-personal",
  TASK: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  AGENT: "4c8e2a6b-1d3f-4e5a-9b7c-2d4e6f8a0b1c",
  PAGE: "7a1c3e5b-9d2f-4a6c-8e0b-5f7a9c1e3b5d",
} as const;

/** The fixture's task by name, which the panel's list and the call's card both say. */
export const FIXTURE_TASK_NAME = "Teammate invitations";

/** One version of the funnel page: the steps it counts, in a self-contained document. */
function funnelPage(version: number, at: string, steps: readonly (readonly [string, number])[]) {
  const rows = steps.map(([step, invites]) => `<tr><td>${step}</td><td>${invites}</td></tr>`);
  return {
    id: FIXTURE_IDS.PAGE,
    title: "Invite funnel",
    version,
    at: Date.parse(at),
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId: FIXTURE_IDS.AGENT },
    html: [
      "<!doctype html><html><head><meta charset='utf-8'><title>Invite funnel</title><style>",
      "body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2328}",
      "table{border-collapse:collapse;margin-top:12px}td,th{padding:6px 12px;border-bottom:1px solid #d0d7de;text-align:left}",
      "td:last-child{text-align:right;font-variant-numeric:tabular-nums}",
      "</style></head><body>",
      "<h1>Invite funnel</h1>",
      "<p>Invites sent in the staging workspace over seven days, and how far each got.</p>",
      "<table><tr><th>Step</th><th>Invites</th></tr>",
      ...rows,
      "</table></body></html>",
    ].join(""),
  } satisfies PageVersion;
}

/** The page the agent showed on the task, as it first showed it. */
const FIXTURE_PAGE_FIRST = funnelPage(1, "2026-10-07T16:47:00Z", [
  ["Sent", 120],
  ["Opened", 94],
  ["Accepted", 71],
]);

/** The page's newest version, as the task's pages list it, which counts the invites that expired too. */
export const FIXTURE_PAGE: PageVersion = funnelPage(2, "2026-10-07T16:51:00Z", [
  ["Sent", 120],
  ["Opened", 94],
  ["Accepted", 71],
  ["Expired", 9],
]);

const FIXTURE_PAGE_VERSIONS: readonly PageVersion[] = [FIXTURE_PAGE_FIRST, FIXTURE_PAGE];

/** The call each call profile stages into the agent: Luke's avatar down, or standing with its tile up. */
const STAGED_AVATARS: ReadonlyMap<string, AvatarState> = new Map([
  [RUN_PROFILE.AGENT_CALL, AVATAR_OFF],
  [RUN_PROFILE.AGENT_CALL_VIDEO, { status: AVATAR_STATUS.LIVE }],
]);

/** What was said on the call so far, as the voice window would report it. */
const STAGED_CALL_TRANSCRIPT: VoiceCallTranscript = {
  voiceSessionId: "fixture-call",
  lines: [
    {
      rowId: "fixture-call-1",
      speaker: TRANSCRIPT_SPEAKER.USER,
      words: "Is the invite pull request ready to land?",
      startMs: 0,
      endMs: 2_400,
    },
    {
      rowId: "fixture-call-2",
      speaker: TRANSCRIPT_SPEAKER.ASSISTANT,
      words: "It's second in the merge queue, approved, with every check passed.",
      startMs: 2_900,
      endMs: 6_100,
    },
  ],
};

/**
 * Whether a launch stands on a staged call: a call profile's fixture run,
 * whose call no voice window reports over, whose avatar the host, which
 * holds no call, does not put down, and which the floating call window
 * draws over whichever window has the keyboard.
 */
export function callStaged(launch: {
  readonly profile: string;
  readonly fixtureMode: boolean;
}): boolean {
  return launch.fixtureMode && STAGED_AVATARS.has(launch.profile);
}

/**
 * The voice slice, the call's transcript, and the call's task a fixture run
 * opens with: a call standing into the fixture's agent, Luke listening,
 * under a call profile; none under any other, nor in a live run.
 */
export function stagedCallState(launch: {
  readonly profile: string;
  readonly fixtureMode: boolean;
}): Pick<AppState, "voice" | "callTranscript" | "tasks"> | undefined {
  const avatar = STAGED_AVATARS.get(launch.profile);
  if (!launch.fixtureMode || avatar === undefined) return undefined;
  return {
    voice: {
      view: {
        ...IDLE_VOICE_VIEW,
        voiceStatus: LIVE_STATUS.LISTENING,
        listening: true,
        call: { agentId: FIXTURE_IDS.AGENT, taskId: FIXTURE_IDS.TASK },
      },
      avatar,
    },
    callTranscript: STAGED_CALL_TRANSCRIPT,
    // The call's task, which the floating call window's card names, as it reads no fixture of the panel's.
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasks: [
        {
          id: FIXTURE_IDS.TASK,
          workspaceId: FIXTURE_IDS.WORKSPACE,
          name: FIXTURE_TASK_NAME,
          createdAt: 1,
          updatedAt: 2,
          repository: "ada/relay",
        },
      ],
    },
  };
}

/** One version of the fixture's page as a page frame and its source read it, by its id and version; that the service did not answer for any other. */
export function fixturePage(page: TasksPageParams): TasksPageAnswer {
  const version = FIXTURE_PAGE_VERSIONS.find(
    (each) => each.id === page.pageId && each.version === page.version,
  );
  return version === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page: version };
}
