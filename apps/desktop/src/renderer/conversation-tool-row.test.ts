import assert from "node:assert/strict";
import { ACTION_KIND, ACTION_OUTPUT_STATUS, type ActionKind } from "@sidecar/actions";
import {
  isStoredToolPart,
  MESSAGE_ROLE,
  SESSION_CONTROL_KIND,
  type StoredToolPart,
  TOOL_PART_STATE,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { test } from "vitest";
import {
  isActionRowKind,
  TOOL_ROW_KIND,
  TOOL_ROW_STATUS,
  type ToolRow,
  type ToolRowChip,
  toolRow,
  UNNAMED_SESSION,
} from "./conversation-tool-row";
import {
  FIXTURE_INPUT,
  FIXTURE_ROSTER,
  FIXTURE_SESSION,
  FIXTURE_TITLE,
} from "./conversation-turns.fixtures";
import type { SessionView } from "./session-model";

const PROVIDER = "conductor";
const AGENT = "claude-code";

type ToolCallInput = StoredToolPart["input"];
type ToolCallOutput = Extract<
  StoredToolPart,
  { state: typeof TOOL_PART_STATE.OUTPUT_AVAILABLE }
>["output"];

function part(
  toolName: string,
  input: ToolCallInput,
  answer:
    | { state: typeof TOOL_PART_STATE.OUTPUT_AVAILABLE; output: ToolCallOutput }
    | { state: typeof TOOL_PART_STATE.OUTPUT_ERROR; errorText: string }
    | { state: typeof TOOL_PART_STATE.INPUT_AVAILABLE },
): StoredToolPart {
  return { type: `tool-${toolName}`, toolCallId: "call_1", input, ...answer };
}

const answered = (output: ToolCallOutput) =>
  ({ state: TOOL_PART_STATE.OUTPUT_AVAILABLE, output }) as const;

const HELD = { provider_id: PROVIDER, provider_session_id: FIXTURE_SESSION.HELD };
const DEPARTED_TARGET = {
  providerId: PROVIDER,
  providerSessionId: FIXTURE_SESSION.DEPARTED,
  title: FIXTURE_TITLE.DEPARTED,
  agentId: AGENT,
};

function chipOf(row: ToolRow | undefined): ToolRowChip | undefined {
  for (const run of row?.runs ?? []) if ("chip" in run) return run.chip;
  return undefined;
}

/** Every action part the fixture conversation holds, in order. */
function fixtureActionParts(): StoredToolPart[] {
  return FIXTURE_INPUT.main.flatMap((row) =>
    row.message.role === MESSAGE_ROLE.ASSISTANT ? row.message.parts.filter(isStoredToolPart) : [],
  );
}

test("every action kind the fixtures carry composes an action row, and a brain tool composes a row of its own kind", () => {
  const kinds = new Set<ActionKind>();
  for (const candidate of fixtureActionParts()) {
    const row = toolRow(candidate, FIXTURE_ROSTER);
    if (isActionRowKind(row.kind)) kinds.add(row.kind);
  }
  assert.deepEqual(
    [...kinds].sort(),
    [
      ACTION_KIND.ADD_AGENT,
      ACTION_KIND.CONTROL,
      ACTION_KIND.CREATE_WORKSPACE,
      ACTION_KIND.MESSAGE,
      ACTION_KIND.RENAME_SESSION,
      ACTION_KIND.RENAME_WORKSPACE,
    ].sort(),
  );
  // A transcript read names its session as a chip, the way an action's row does, under the provider's mark.
  const read = toolRow(part("read_transcript", HELD, answered({ lines: [] })), FIXTURE_ROSTER);
  assert.equal(read.kind, TOOL_ROW_KIND.TRANSCRIPT);
  assert.equal(isActionRowKind(read.kind), false);
  assert.equal(read.status, TOOL_ROW_STATUS.ACCEPTED);
  assert.equal(read.providerId, PROVIDER);
  assert.equal(chipOf(read)?.text, FIXTURE_TITLE.HELD);
  assert.equal(chipOf(read)?.openable, true);
  // A tool this build has no words for is drawn as the other, by its name.
  const other = toolRow(part("frobnicate_widget", { a: 1 }, answered({})), FIXTURE_ROSTER);
  assert.equal(other.kind, TOOL_ROW_KIND.OTHER);
  assert.deepEqual(other.runs, [{ text: "Ran frobnicate widget" }]);
  // An announce composes a row of its own kind quoting the briefing it carried, the way a sent message's row quotes its text.
  const announced = toolRow(
    part("announce", { briefing: "Two sessions finished." }, answered({ status: "accepted" })),
    FIXTURE_ROSTER,
  );
  assert.equal(announced.kind, TOOL_ROW_KIND.ANNOUNCE);
  assert.equal(isActionRowKind(announced.kind), false);
  assert.equal(announced.status, TOOL_ROW_STATUS.ACCEPTED);
  assert.deepEqual(announced.runs, [{ text: 'Announced: "Two sessions finished."' }]);
  const unworded = toolRow(part("announce", {}, answered({ status: "accepted" })), FIXTURE_ROSTER);
  assert.deepEqual(unworded.runs, [{ text: "Announced" }]);
});

test("the brain's own tools are worded by their arguments, never their answers, and a refusal says why", () => {
  const words = (row: ToolRow) => row.runs.map((run) => ("text" in run ? run.text : "")).join("");
  const roster = toolRow(
    part("list_sessions", {}, answered({ roster: "(a roster)" })),
    FIXTURE_ROSTER,
  );
  assert.equal(roster.kind, TOOL_ROW_KIND.ROSTER);
  assert.equal(words(roster), "Looked at the roster");
  assert.equal(roster.status, TOOL_ROW_STATUS.ACCEPTED);
  assert.equal(roster.reason, undefined);

  const search = toolRow(
    part("memory_search", { query: "notch" }, answered({ results: [{ path: "MEMORY.md" }] })),
    FIXTURE_ROSTER,
  );
  assert.equal(search.kind, TOOL_ROW_KIND.NOTEBOOK_SEARCH);
  assert.equal(words(search), 'Searched the notebook for "notch"');
  assert.equal(
    words(
      toolRow(part("memory_get", { path: "USER.md" }, answered({ content: "" })), FIXTURE_ROSTER),
    ),
    'Read "USER.md" from the notebook',
  );
  assert.equal(
    words(
      toolRow(
        part("read_workspace_file", { name: "MEMORY.md" }, answered({ status: "accepted" })),
        FIXTURE_ROSTER,
      ),
    ),
    'Read the workspace file "MEMORY.md"',
  );
  assert.equal(
    words(
      toolRow(part("load_skill", { location: "skills/x/SKILL.md" }, answered({})), FIXTURE_ROSTER),
    ),
    'Loaded the skill at "skills/x/SKILL.md"',
  );
  // An entry's words stay in the note: the row says a note grew, not what it gained.
  const appended = toolRow(
    part(
      "append_daily_note",
      { content: "- Decided: clip the panel to the notch." },
      answered({ status: "accepted", path: "memory/2026-09-14.md", chars: 40 }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(appended.kind, TOOL_ROW_KIND.DAILY_NOTE_APPEND);
  assert.equal(appended.status, TOOL_ROW_STATUS.ACCEPTED);
  assert.equal(words(appended), "Added to today's note");
  assert.doesNotMatch(words(appended), /notch/u);
  const listedNotes = toolRow(
    part(
      "list_daily_notes",
      {},
      answered({ status: "accepted", notes: [{ path: "memory/2026-09-14.md", chars: 40 }] }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(listedNotes.kind, TOOL_ROW_KIND.DAILY_NOTES_LIST);
  assert.equal(words(listedNotes), "Listed his dated notes");
  assert.doesNotMatch(words(listedNotes), /2026/u);
  assert.equal(
    words(
      toolRow(part("sessions_spawn", { task: "…", label: "Tests" }, answered({})), FIXTURE_ROSTER),
    ),
    'Delegated "Tests" to a child',
  );
  assert.equal(
    words(
      toolRow(part("subagents", { action: "cancel", child_id: "c" }, answered({})), FIXTURE_ROSTER),
    ),
    "Cancelled a child",
  );
  assert.equal(
    words(toolRow(part("subagents", {}, answered({})), FIXTURE_ROSTER)),
    "Listed the children",
  );

  // A refusal is the tool's own record: a status other than accepted beside a reason.
  const refused = toolRow(
    part(
      "write_workspace_file",
      { name: "MEMORY.md", content: "" },
      answered({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "not run: this agent has no workspace",
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(refused.kind, TOOL_ROW_KIND.WORKSPACE_WRITE);
  assert.equal(words(refused), 'Wrote the workspace file "MEMORY.md"');
  assert.equal(refused.status, TOOL_ROW_STATUS.REFUSED);
  assert.equal(refused.reason, "not run: this agent has no workspace");
  // Under way and failed are the part's own words, as for an action.
  assert.equal(
    toolRow(
      part("memory_get", { path: "USER.md" }, { state: TOOL_PART_STATE.INPUT_AVAILABLE }),
      FIXTURE_ROSTER,
    ).status,
    TOOL_ROW_STATUS.PENDING,
  );
  const failed = toolRow(
    part("list_sessions", {}, { state: TOOL_PART_STATE.OUTPUT_ERROR, errorText: "boom" }),
    FIXTURE_ROSTER,
  );
  assert.equal(failed.status, TOOL_ROW_STATUS.FAILED);
  assert.equal(failed.reason, "boom");
});

test("a chip names a held session by the roster and opens exactly when its row would", () => {
  const row = toolRow(
    part(
      "send_session_message",
      { ...HELD, text: "go" },
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        target: {
          providerId: PROVIDER,
          providerSessionId: FIXTURE_SESSION.HELD,
          title: FIXTURE_TITLE.HELD_THEN,
        },
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(row), {
    text: FIXTURE_TITLE.HELD,
    markId: AGENT,
    identity: { providerId: PROVIDER, providerSessionId: FIXTURE_SESSION.HELD },
    openable: true,
  });
  assert.equal(row?.status, TOOL_ROW_STATUS.ACCEPTED);
  assert.equal(row?.providerId, PROVIDER);

  const quiet = toolRow(
    part(
      "send_session_message",
      { provider_id: PROVIDER, provider_session_id: FIXTURE_SESSION.UNOPENABLE, text: "go" },
      answered({ status: ACTION_OUTPUT_STATUS.ACCEPTED }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(chipOf(quiet)?.openable, false);
  assert.equal(chipOf(quiet)?.text, FIXTURE_TITLE.UNOPENABLE);
});

test("a departed session is named from the envelope's snapshot and opened by identity", () => {
  const row = toolRow(
    part(
      "run_session_control",
      {
        provider_id: PROVIDER,
        provider_session_id: FIXTURE_SESSION.DEPARTED,
        control_id: "archive",
      },
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        target: {
          ...DEPARTED_TARGET,
          controlKind: SESSION_CONTROL_KIND.ARCHIVE,
          controlLabel: "Archive",
        },
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(row), {
    text: FIXTURE_TITLE.DEPARTED,
    markId: AGENT,
    identity: { providerId: PROVIDER, providerSessionId: FIXTURE_SESSION.DEPARTED },
    openable: true,
  });
  assert.equal(row?.controlKind, SESSION_CONTROL_KIND.ARCHIVE);

  const nameless = toolRow(
    part(
      "send_session_message",
      { provider_id: PROVIDER, provider_session_id: "gone", text: "go" },
      answered({ status: ACTION_OUTPUT_STATUS.ACCEPTED }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(nameless), {
    text: UNNAMED_SESSION,
    markId: PROVIDER,
    identity: { providerId: PROVIDER, providerSessionId: "gone" },
    openable: true,
  });
});

test("a control still under way is worded by the roster's advertisement under the call's id, and the envelope outranks it once it answers", () => {
  const words = (row: ToolRow) => row.runs.map((run) => ("text" in run ? run.text : "")).join("");
  const advertising: SessionView[] = FIXTURE_ROSTER.map((session) =>
    session.id === FIXTURE_SESSION.HELD
      ? {
          ...session,
          actions: [
            {
              kind: ACTION_KIND.CONTROL,
              id: "stop",
              label: "Stop",
              controlKind: SESSION_CONTROL_KIND.STOP,
            },
            { kind: ACTION_KIND.CONTROL, id: "retry", label: "Retry" },
          ],
        }
      : session,
  );
  const pending = (controlId: string) =>
    toolRow(
      part(
        "run_session_control",
        { ...HELD, control_id: controlId },
        { state: TOOL_PART_STATE.INPUT_AVAILABLE },
      ),
      advertising,
    );
  // The advertisement's kind and label read the moment the call is made, so the row never says "a control" first.
  assert.equal(pending("stop").status, TOOL_ROW_STATUS.PENDING);
  assert.equal(pending("stop").controlKind, SESSION_CONTROL_KIND.STOP);
  assert.equal(words(pending("stop")), "Stopped ");
  assert.equal(pending("retry").controlKind, undefined);
  assert.equal(words(pending("retry")), 'Ran "Retry" on ');
  // An id the roster does not advertise is still a control with no name: the id's spelling is never read.
  assert.equal(pending("archive").controlKind, undefined);
  assert.equal(words(pending("archive")), "Ran a control on ");
  // The roster's advertisement is the held session's own; another session's id names nothing here.
  const elsewhere = toolRow(
    part(
      "run_session_control",
      {
        provider_id: PROVIDER,
        provider_session_id: FIXTURE_SESSION.UNOPENABLE,
        control_id: "stop",
      },
      { state: TOOL_PART_STATE.INPUT_AVAILABLE },
    ),
    advertising,
  );
  assert.equal(words(elsewhere), "Ran a control on ");
  // Once the envelope exists, its snapshot is the control as it ran, whatever the roster advertises now.
  const answered = toolRow(
    part(
      "run_session_control",
      { ...HELD, control_id: "stop" },
      {
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        output: {
          status: ACTION_OUTPUT_STATUS.ACCEPTED,
          target: {
            providerId: PROVIDER,
            providerSessionId: FIXTURE_SESSION.HELD,
            controlKind: SESSION_CONTROL_KIND.ACTION,
            controlLabel: "Halt",
          },
        },
      },
    ),
    advertising,
  );
  assert.equal(answered.controlKind, SESSION_CONTROL_KIND.ACTION);
  assert.equal(words(answered), 'Ran "Halt" on ');
});

test("a control's kind and label come from the envelope, never from the call's own spelling", () => {
  const withKind = (controlKind: string | undefined) =>
    toolRow(
      part(
        "run_session_control",
        { ...HELD, control_id: "x" },
        answered({
          status: ACTION_OUTPUT_STATUS.ACCEPTED,
          target: {
            providerId: PROVIDER,
            providerSessionId: FIXTURE_SESSION.HELD,
            ...(controlKind !== undefined ? { controlKind } : undefined),
            controlLabel: "Retry",
          },
        }),
      ),
      FIXTURE_ROSTER,
    );
  assert.equal(withKind(SESSION_CONTROL_KIND.STOP)?.controlKind, SESSION_CONTROL_KIND.STOP);
  assert.equal(withKind(SESSION_CONTROL_KIND.ACTION)?.controlKind, SESSION_CONTROL_KIND.ACTION);
  assert.equal(withKind(undefined)?.controlKind, undefined);
  // The words lead, the chip follows: two runs, the chip second, whatever the kind.
  for (const kind of [SESSION_CONTROL_KIND.STOP, SESSION_CONTROL_KIND.ARCHIVE, undefined]) {
    const runs = withKind(kind)?.runs ?? [];
    assert.equal(runs.length, 2);
    assert.ok(runs[0] !== undefined && "text" in runs[0]);
    assert.ok(runs[1] !== undefined && "chip" in runs[1]);
  }
});

test("a creation's chip is the session its answer named, by the roster once it holds it", () => {
  const input = { provider_id: PROVIDER, name: FIXTURE_TITLE.CREATED };
  const landed = toolRow(
    part(
      "create_workspace",
      input,
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        target: { providerId: PROVIDER },
        createdSession: { providerId: PROVIDER, providerSessionId: FIXTURE_SESSION.CREATED },
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(landed)?.identity, {
    providerId: PROVIDER,
    providerSessionId: FIXTURE_SESSION.CREATED,
  });
  assert.equal(chipOf(landed)?.openable, true);
  assert.equal(chipOf(landed)?.text, FIXTURE_TITLE.CREATED);

  const unlanded = toolRow(
    part(
      "create_workspace",
      input,
      answered({ status: ACTION_OUTPUT_STATUS.ACCEPTED, target: { providerId: PROVIDER } }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(unlanded), {
    text: FIXTURE_TITLE.CREATED,
    markId: PROVIDER,
    openable: false,
  });

  // The answer named a session the roster does not hold, and the call named nothing: the chip
  // is still the session, opened by identity, under the provider's mark. A row stored when the
  // call still declared an agent reads the same, since the key is outside the declaration now.
  const departed = toolRow(
    part(
      "create_workspace",
      { provider_id: PROVIDER, agent: AGENT },
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        target: { providerId: PROVIDER },
        createdSession: { providerId: PROVIDER, providerSessionId: "created-then-archived" },
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.deepEqual(chipOf(departed), {
    text: UNNAMED_SESSION,
    markId: PROVIDER,
    identity: { providerId: PROVIDER, providerSessionId: "created-then-archived" },
    openable: false,
  });

  const unnamed = toolRow(
    part(
      "create_workspace",
      { provider_id: PROVIDER },
      answered({ status: ACTION_OUTPUT_STATUS.ACCEPTED }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(chipOf(unnamed), undefined);
  assert.equal(unnamed?.runs.length, 1);
  assert.equal(unnamed?.providerId, PROVIDER);
});

test("part state and envelope status are different questions, and each has its own word", () => {
  const message = { ...HELD, text: "go" };
  assert.equal(
    toolRow(
      part("send_session_message", message, { state: TOOL_PART_STATE.INPUT_AVAILABLE }),
      FIXTURE_ROSTER,
    )?.status,
    TOOL_ROW_STATUS.PENDING,
  );
  const failed = toolRow(
    part("send_session_message", message, {
      state: TOOL_PART_STATE.OUTPUT_ERROR,
      errorText: "tool threw",
    }),
    FIXTURE_ROSTER,
  );
  assert.equal(failed?.status, TOOL_ROW_STATUS.FAILED);
  assert.equal(failed?.reason, "tool threw");
  const refused = toolRow(
    part(
      "send_session_message",
      message,
      answered({ status: ACTION_OUTPUT_STATUS.REFUSED, reason: "not advertised" }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(refused?.status, TOOL_ROW_STATUS.REFUSED);
  assert.equal(refused?.reason, "not advertised");
  const unknown = toolRow(
    part(
      "send_session_message",
      message,
      answered({ status: ACTION_OUTPUT_STATUS.UNKNOWN, reason: "lost" }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(unknown?.status, TOOL_ROW_STATUS.UNKNOWN);
  assert.equal(unknown?.reason, "lost");
  const unreadable = toolRow(
    part("send_session_message", message, answered({ status: "done" })),
    FIXTURE_ROSTER,
  );
  assert.equal(unreadable?.status, TOOL_ROW_STATUS.UNKNOWN);
  assert.notEqual(unreadable?.reason, undefined);
  const noted = toolRow(
    part(
      "send_session_message",
      message,
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        note: "Delivered on the next turn.",
        warning: "Slowly.",
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(noted?.note, "Delivered on the next turn.");
  assert.equal(noted?.warning, "Slowly.");
  assert.equal(noted?.reason, undefined);
});

test("a call whose arguments cannot be read still draws its kind and whatever the envelope names", () => {
  const row = toolRow(
    part(
      "send_session_message",
      { nonsense: true },
      answered({
        status: ACTION_OUTPUT_STATUS.ACCEPTED,
        target: {
          providerId: PROVIDER,
          providerSessionId: FIXTURE_SESSION.DEPARTED,
          title: FIXTURE_TITLE.DEPARTED,
        },
      }),
    ),
    FIXTURE_ROSTER,
  );
  assert.equal(row.kind, ACTION_KIND.MESSAGE);
  assert.equal(row.runs.length, 2);
  assert.deepEqual(chipOf(row)?.identity, {
    providerId: PROVIDER,
    providerSessionId: FIXTURE_SESSION.DEPARTED,
  });
});
