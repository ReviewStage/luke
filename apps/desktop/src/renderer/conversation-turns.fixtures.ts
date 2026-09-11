import { ACTION_OUTPUT_STATUS, type ActionOutputEnvelope } from "@sidecar/actions";
import {
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewInput,
  type ConversationViewToolKinds,
  type ConversationViewTurnGroup,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_URGENCY,
  type StoredToolPart,
  selectConversationView,
  TOOL_PART_STATE,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import { CONVERSATION_EVENT_KIND, MESSAGE_RATING, TURN_ORIGIN, TURN_STATUS } from "@sidecar/wire";
import type { SessionView } from "./session-model";

/**
 * Synthetic scenarios the renderer is driven by before its data arrives: the
 * rows a store would hold, run through the view selection exactly as a
 * service would run them, over a roster that still holds some of the sessions
 * they name and has let one go. Nothing here is copied from a real session.
 */

const PROVIDER = "conductor";
const AGENT = "claude-code";

export const FIXTURE_SESSION = {
  /** Held by the roster: its chip names it by the roster's current title and opens like its row. */
  HELD: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
  /** Held by the roster, but its provider reported no address: a name, not a press. */
  UNOPENABLE: "7d2a3b25-0b1c-4d3e-9f40-1b2c3d4e5f61",
  /** Gone from the roster since the action ran: named by the envelope's snapshot, opened by identity. */
  DEPARTED: "8e3b4c36-1c2d-4e4f-a051-2c3d4e5f6a72",
  /** The workspace a creation made, which the roster came to hold. */
  CREATED: "9f4c5d47-2d3e-4f50-b162-3d4e5f6a7b83",
} as const;

export const FIXTURE_TITLE = {
  HELD: "Fixture session",
  HELD_THEN: "Fixture session (before rename)",
  UNOPENABLE: "Quiet fixture",
  DEPARTED: "Archived fixture",
  CREATED: "Notch panel clipping",
} as const;

function rosterSession(id: string, title: string, openable: boolean): SessionView {
  return {
    id,
    title,
    providerId: PROVIDER,
    provider: "Conductor",
    agentId: AGENT,
    agent: "Claude Code",
    applications: [],
    detail: "Working",
    urgency: SESSION_URGENCY.WORKING,
    label: "Working",
    location: SESSION_LOCATION.CLOUD,
    lastActivityAt: 1757505600000,
    openable,
    canMessage: true,
    actions: [],
    hasChange: false,
  };
}

/** The roster as it stands when the scenarios are drawn. */
export const FIXTURE_ROSTER: readonly SessionView[] = [
  rosterSession(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD, true),
  rosterSession(FIXTURE_SESSION.UNOPENABLE, FIXTURE_TITLE.UNOPENABLE, false),
  rosterSession(FIXTURE_SESSION.CREATED, FIXTURE_TITLE.CREATED, true),
];

const FIXTURE_TOOL_KINDS: ConversationViewToolKinds = new Map([
  ["announce", CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE],
  ["send_session_message", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["run_session_control", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["open_session", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["create_workspace", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["add_workspace_agent", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["rename_workspace", CONVERSATION_VIEW_TOOL_KIND.ACTION],
  ["rename_session", CONVERSATION_VIEW_TOOL_KIND.ACTION],
]);

const identity = (providerSessionId: string) => ({
  provider_id: PROVIDER,
  provider_session_id: providerSessionId,
});

const target = (providerSessionId: string, title: string) => ({
  providerId: PROVIDER,
  providerSessionId,
  title,
  agentId: AGENT,
});

const accepted = (
  envelope: Omit<Extract<ActionOutputEnvelope, { status: "accepted" }>, "status">,
) => ({
  status: ACTION_OUTPUT_STATUS.ACCEPTED,
  ...envelope,
});

type ToolCallInput = StoredToolPart["input"];
type ToolCallOutput = Extract<
  StoredToolPart,
  { state: typeof TOOL_PART_STATE.OUTPUT_AVAILABLE }
>["output"];

let calls = 0;

function call(toolName: string, input: ToolCallInput, output: ToolCallOutput): StoredToolPart {
  calls += 1;
  return {
    type: `tool-${toolName}`,
    toolCallId: `call_fixture_${String(calls).padStart(2, "0")}`,
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input,
    output,
  };
}

function erroredCall(toolName: string, input: ToolCallInput, errorText: string): StoredToolPart {
  calls += 1;
  return {
    type: `tool-${toolName}`,
    toolCallId: `call_fixture_${String(calls).padStart(2, "0")}`,
    state: TOOL_PART_STATE.OUTPUT_ERROR,
    input,
    errorText,
  };
}

function pendingCall(toolName: string, input: ToolCallInput): StoredToolPart {
  calls += 1;
  return {
    type: `tool-${toolName}`,
    toolCallId: `call_fixture_${String(calls).padStart(2, "0")}`,
    state: TOOL_PART_STATE.INPUT_AVAILABLE,
    input,
  };
}

const ask = (id: string, text: string): StoredUIMessage => ({
  id,
  role: MESSAGE_ROLE.USER,
  metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  parts: [{ type: "text", text }],
});

const reply = (id: string, parts: StoredUIMessage["parts"]): StoredUIMessage => ({
  id,
  role: MESSAGE_ROLE.ASSISTANT,
  metadata: { author: MESSAGE_AUTHOR.BRAIN },
  parts,
});

/** The fixture turns by what each stands for; exported so a test can name the turn it reads. */
export const FIXTURE_TURN = {
  /** A typed ask answered with one reply and one read: no action at all. */
  ASK: "1a000000-0000-4000-8000-000000000101",
  /** Every session action kind in one settled turn: folded closed under its count. */
  EVERY_KIND: "1a000000-0000-4000-8000-000000000102",
  /** A refused, an unknown, a pending, and an errored action. */
  REFUSED: "1a000000-0000-4000-8000-000000000103",
  /** An observed session's own turn, opened by the roster: Luke's own judgment. */
  ANNOUNCED: "1a000000-0000-4000-8000-000000000104",
  /** A turn still running two actions in: folded open, with Luke's wait at its foot. */
  RUNNING: "1a000000-0000-4000-8000-000000000105",
  /** One action and nothing else: the row itself, no fold. */
  SINGLE: "1a000000-0000-4000-8000-000000000106",
  /** A hold's release in main: Luke's own judgment, with words and an action of his own. */
  OWN: "1a000000-0000-4000-8000-000000000107",
} as const;

const TURN = FIXTURE_TURN;

const AT = {
  ASK: 1757505600000,
  EVERY_KIND: 1757505700000,
  REFUSED: 1757505800000,
  ANNOUNCED: 1757505900000,
  RUNNING: 1757506000000,
  SINGLE: 1757506100000,
  OWN: 1757506200000,
} as const;

/** The instant the fixtures are read against: the running turn has been going for a while. */
export const FIXTURE_NOW = 1757506300000;

/** The one reply the fixture rates: the first turn's answer, rated down as its newest word. */
export const FIXTURE_RATED_MESSAGE = "2b000000-0000-4000-8000-000000000202";

/** One conversation covering every row the renderer draws. */
export const FIXTURE_INPUT: ConversationViewInput = {
  main: [
    {
      message: ask("2b000000-0000-4000-8000-000000000201", "Is the fixture session still waiting?"),
      seq: 1,
      turnId: TURN.ASK,
      createdAt: AT.ASK,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000202", [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "The developer asked about the fixture session, so read its tail before answering.",
          state: "done",
        },
        call("read_transcript", identity(FIXTURE_SESSION.HELD), {
          lines: ["assistant: Waiting for permission to run the test suite."],
        }),
        { type: "step-start" },
        { type: "text", text: "It is holding on a permission prompt.", state: "done" },
      ]),
      seq: 2,
      turnId: TURN.ASK,
      createdAt: AT.ASK + 1500,
    },
    {
      message: ask(
        "2b000000-0000-4000-8000-000000000203",
        "Tell it to go ahead, archive the old one, and set up a workspace for the notch clipping.",
      ),
      seq: 3,
      turnId: TURN.EVERY_KIND,
      createdAt: AT.EVERY_KIND,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000204", [
        { type: "step-start" },
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.HELD), text: "Yes, run the tests." },
          accepted({ target: target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD_THEN) }),
        ),
        call(
          "run_session_control",
          { ...identity(FIXTURE_SESSION.DEPARTED), control_id: "archive" },
          accepted({
            target: {
              ...target(FIXTURE_SESSION.DEPARTED, FIXTURE_TITLE.DEPARTED),
              controlKind: SESSION_CONTROL_KIND.ARCHIVE,
              controlLabel: "Archive",
            },
          }),
        ),
        call(
          "run_session_control",
          { ...identity(FIXTURE_SESSION.HELD), control_id: "stop" },
          accepted({
            target: {
              ...target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD_THEN),
              controlKind: SESSION_CONTROL_KIND.STOP,
              controlLabel: "Stop",
            },
          }),
        ),
        call(
          "run_session_control",
          { ...identity(FIXTURE_SESSION.UNOPENABLE), control_id: "retry" },
          accepted({
            target: {
              ...target(FIXTURE_SESSION.UNOPENABLE, FIXTURE_TITLE.UNOPENABLE),
              controlKind: SESSION_CONTROL_KIND.ACTION,
              controlLabel: "Retry",
            },
          }),
        ),
        call(
          "open_session",
          { ...identity(FIXTURE_SESSION.HELD), application: "claude" },
          accepted({
            target: {
              ...target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD_THEN),
              applicationId: "claude",
            },
            note: "Opened in Claude.",
          }),
        ),
        call(
          "create_workspace",
          { provider_id: PROVIDER, name: FIXTURE_TITLE.CREATED, agent: AGENT },
          accepted({
            target: { providerId: PROVIDER },
            createdSession: { providerId: PROVIDER, providerSessionId: FIXTURE_SESSION.CREATED },
          }),
        ),
        call(
          "add_workspace_agent",
          { ...identity(FIXTURE_SESSION.CREATED), agent: "codex" },
          accepted({ target: target(FIXTURE_SESSION.CREATED, FIXTURE_TITLE.CREATED) }),
        ),
        call(
          "rename_workspace",
          { ...identity(FIXTURE_SESSION.CREATED), name: FIXTURE_TITLE.CREATED },
          accepted({ target: target(FIXTURE_SESSION.CREATED, "Untitled workspace") }),
        ),
        call(
          "rename_session",
          { ...identity(FIXTURE_SESSION.HELD), name: FIXTURE_TITLE.HELD },
          accepted({ target: target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD_THEN) }),
        ),
        { type: "step-start" },
        {
          type: "text",
          text: "Done: told it to go ahead, archived the old one, and set up the workspace.",
          state: "done",
        },
      ]),
      seq: 4,
      turnId: TURN.EVERY_KIND,
      createdAt: AT.EVERY_KIND + 4000,
    },
    {
      message: ask("2b000000-0000-4000-8000-000000000205", "Approve it and delete the other one."),
      seq: 5,
      turnId: TURN.REFUSED,
      createdAt: AT.REFUSED,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000206", [
        { type: "step-start" },
        erroredCall(
          "run_session_control",
          { ...identity(FIXTURE_SESSION.HELD), control_id: "approve" },
          "The control is no longer advertised.",
        ),
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.DEPARTED), text: "Please delete it." },
          {
            status: ACTION_OUTPUT_STATUS.REFUSED,
            reason: "That session is no longer observed.",
            target: target(FIXTURE_SESSION.DEPARTED, FIXTURE_TITLE.DEPARTED),
          },
        ),
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.HELD), text: "Carry on." },
          {
            status: ACTION_OUTPUT_STATUS.UNKNOWN,
            reason: "The connection closed before the provider answered.",
            target: target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD),
          },
        ),
        pendingCall("send_session_message", {
          ...identity(FIXTURE_SESSION.HELD),
          text: "Still there?",
        }),
        { type: "step-start" },
        {
          type: "text",
          text: "The approve control is gone, and the other session is no longer observed.",
          state: "done",
        },
      ]),
      seq: 6,
      turnId: TURN.REFUSED,
      createdAt: AT.REFUSED + 2000,
    },
    {
      message: ask("2b000000-0000-4000-8000-000000000207", "Nudge both fixtures along."),
      seq: 7,
      turnId: TURN.RUNNING,
      createdAt: AT.RUNNING,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000208", [
        { type: "step-start" },
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.HELD), text: "Carry on." },
          accepted({ target: target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD) }),
        ),
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.CREATED), text: "Carry on." },
          accepted({ target: target(FIXTURE_SESSION.CREATED, FIXTURE_TITLE.CREATED) }),
        ),
        pendingCall("send_session_message", {
          ...identity(FIXTURE_SESSION.UNOPENABLE),
          text: "You too.",
        }),
      ]),
      seq: 8,
      turnId: TURN.RUNNING,
      createdAt: AT.RUNNING + 900,
    },
    {
      message: ask("2b000000-0000-4000-8000-000000000209", "Stop the fixture session."),
      seq: 9,
      turnId: TURN.SINGLE,
      createdAt: AT.SINGLE,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000210", [
        { type: "step-start" },
        call(
          "run_session_control",
          { ...identity(FIXTURE_SESSION.HELD), control_id: "stop" },
          accepted({
            target: {
              ...target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD),
              controlKind: SESSION_CONTROL_KIND.STOP,
              controlLabel: "Stop",
            },
          }),
        ),
        { type: "step-start" },
        { type: "text", text: "Stopped it.", state: "done" },
      ]),
      seq: 10,
      turnId: TURN.SINGLE,
      createdAt: AT.SINGLE + 800,
    },
    {
      message: reply("2b000000-0000-4000-8000-000000000211", [
        { type: "step-start" },
        {
          type: "text",
          text: "The meeting ended, so I answered the fixture session's question myself.",
          state: "done",
        },
        call(
          "send_session_message",
          { ...identity(FIXTURE_SESSION.HELD), text: "Yes, go ahead." },
          accepted({ target: target(FIXTURE_SESSION.HELD, FIXTURE_TITLE.HELD) }),
        ),
      ]),
      seq: 11,
      turnId: TURN.OWN,
      createdAt: AT.OWN,
    },
  ],
  observed: [
    {
      session: { providerId: PROVIDER, providerSessionId: FIXTURE_SESSION.HELD },
      messages: [
        {
          message: reply("2b000000-0000-4000-8000-000000000301", [
            { type: "step-start" },
            {
              type: "reasoning",
              text: "The session stopped to ask for permission; that is worth a word.",
              state: "done",
            },
            call(
              "announce",
              { briefing: "The fixture session is waiting on a permission prompt." },
              {},
            ),
            { type: "text", text: "Announced.", state: "done" },
          ]),
          seq: 1,
          turnId: TURN.ANNOUNCED,
          createdAt: AT.ANNOUNCED,
        },
      ],
    },
  ],
  turns: [
    { id: TURN.ASK, origin: TURN_ORIGIN.TYPED, status: TURN_STATUS.SETTLED, queuedAt: AT.ASK },
    {
      id: TURN.EVERY_KIND,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: AT.EVERY_KIND,
    },
    {
      id: TURN.REFUSED,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: AT.REFUSED,
    },
    {
      id: TURN.ANNOUNCED,
      origin: TURN_ORIGIN.ROSTER_DIFF,
      status: TURN_STATUS.SETTLED,
      queuedAt: AT.ANNOUNCED,
    },
    {
      id: TURN.RUNNING,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.RUNNING,
      queuedAt: AT.RUNNING,
      startedAt: AT.RUNNING + 200,
    },
    {
      id: TURN.SINGLE,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: AT.SINGLE,
    },
    {
      id: TURN.OWN,
      origin: TURN_ORIGIN.HOLD_RELEASE,
      status: TURN_STATUS.SETTLED,
      queuedAt: AT.OWN,
    },
  ],
  // The developer's verdicts, as the record holds them: the first reply rated
  // down, then up, and down again, so the newest word is what the thumbs show.
  events: [
    {
      messageId: FIXTURE_RATED_MESSAGE,
      kind: CONVERSATION_EVENT_KIND.RATING,
      seq: 1,
      rating: { rating: MESSAGE_RATING.DOWN },
    },
    {
      messageId: FIXTURE_RATED_MESSAGE,
      kind: CONVERSATION_EVENT_KIND.RATING,
      seq: 2,
      rating: { rating: MESSAGE_RATING.UP },
    },
    {
      messageId: FIXTURE_RATED_MESSAGE,
      kind: CONVERSATION_EVENT_KIND.RATING,
      seq: 3,
      rating: { rating: MESSAGE_RATING.DOWN },
    },
  ],
  toolKinds: FIXTURE_TOOL_KINDS,
};

/** The scenarios as the renderer takes them: the view selection over the rows above. */
export function fixtureConversationTurns(): readonly ConversationViewTurnGroup[] {
  return selectConversationView(FIXTURE_INPUT);
}
