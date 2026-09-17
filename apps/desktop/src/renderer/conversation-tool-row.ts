import {
  ACTION_KIND,
  ACTION_OUTPUT,
  ACTION_OUTPUT_STATUS,
  type ActionKind,
  type ActionOutputEnvelope,
  type ActionTargetSnapshot,
  ADD_AGENT_REQUEST,
  actionToolKind,
  CONTROL_REQUEST,
  CREATE_WORKSPACE_REQUEST,
  FEEDBACK_REQUEST,
  MESSAGE_REQUEST,
  OPEN_REQUEST,
  PANEL_REQUEST,
  RENAME_SESSION_REQUEST,
  RENAME_WORKSPACE_REQUEST,
  SETTING_REQUEST,
  UPDATE_REQUEST,
} from "@sidecar/actions";
import { BRAIN_TOOL, SUBAGENTS_ACTION } from "@sidecar/brain/tool-names";
import { APP_PANEL_TAB, APP_UPDATE_ACTION } from "@sidecar/guide";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory/tool-names";
import {
  SESSION_CONTROL_KIND,
  type SessionControlKind,
  type SessionIdentity,
  type StoredToolPart,
  storedToolName,
  TOOL_PART_STATE,
} from "@sidecar/session";
import {
  ACTION_RESULT_STATUS,
  EXCESS_KEYS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import type { SessionView } from "./session-model";

/**
 * A request read against its schema; downstream code reads `ok`/`value` exactly
 * as it did against the facade. A key the declaration does not name is dropped
 * rather than refused, which is the grain the action request schemas were
 * declared with before parse options moved to the read.
 */
function parsedRequest<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  input: UnparsedWireValue,
): { readonly ok: true; readonly value: Value } | { readonly ok: false } {
  return Result.match(readEither(schema, { excess: EXCESS_KEYS.DROP })(input), {
    onSuccess: (value) => ({ ok: true, value }),
    onFailure: () => ({ ok: false }),
  });
}

/**
 * How a tool call's part becomes a row: from the call's own arguments and
 * what its output carries, and nothing else. For an action the arguments say
 * what was asked — which session, what text, which control, which setting —
 * and the envelope says what became of it and what the target was when it
 * ran: its title, its agent, the control's label and kind, the session a
 * creation made. For every other tool — a roster look, a transcript read, a
 * notebook search, a workspace write, a delegation — the arguments say what
 * was read or written and the answer says only whether the tool refused; not
 * a word of what it read or wrote is drawn. The roster as it stands now
 * supplies the current name of a session it still holds; once it has let the
 * session go, the envelope's snapshot names it, which is what keeps a departed
 * chat nameable. No sentence is stored anywhere for a row to draw: the words
 * here are the desktop's, and the phone words the same parts itself.
 */

/**
 * What kind of thing a row records: every action kind, and beside them the
 * kinds of the brain's own tools, which are not actions and answer in no
 * envelope. The row's mark and its words both follow the kind, and a call to
 * a tool this build has no words for is drawn as the other, by its name.
 */
export const TOOL_ROW_KIND = {
  ...ACTION_KIND,
  ROSTER: "roster",
  TRANSCRIPT: "transcript",
  WORKSPACE_READ: "workspace-read",
  WORKSPACE_WRITE: "workspace-write",
  DAILY_NOTE_APPEND: "daily-note-append",
  DAILY_NOTES_LIST: "daily-notes-list",
  SKILL: "skill",
  DELEGATE: "delegate",
  CHILDREN: "children",
  CONVERSATIONS: "conversations",
  CHILD_HISTORY: "child-history",
  NOTEBOOK_SEARCH: "notebook-search",
  NOTEBOOK_READ: "notebook-read",
  OTHER: "other",
} as const satisfies Record<string, string>;

export type ToolRowKind = (typeof TOOL_ROW_KIND)[keyof typeof TOOL_ROW_KIND];

/** The kinds that are not actions: the brain's own tools, and the other. */
type DetailKind = Exclude<ToolRowKind, ActionKind>;

const ACTION_ROW_KINDS: ReadonlySet<string> = new Set<string>(Object.values(ACTION_KIND));

/** Whether a row records an action — a thing done to a session or to Luke — rather than the turn's working. */
export function isActionRowKind(kind: ToolRowKind): kind is ActionKind {
  return ACTION_ROW_KINDS.has(kind);
}

/** The brain's own tools, each to the kind of row it draws; a memory tool is the notebook's. */
const DETAIL_KIND_BY_TOOL: ReadonlyMap<string, DetailKind> = new Map<string, DetailKind>([
  [BRAIN_TOOL.LIST_SESSIONS, TOOL_ROW_KIND.ROSTER],
  [BRAIN_TOOL.READ_TRANSCRIPT, TOOL_ROW_KIND.TRANSCRIPT],
  [BRAIN_TOOL.READ_WORKSPACE_FILE, TOOL_ROW_KIND.WORKSPACE_READ],
  [BRAIN_TOOL.WRITE_WORKSPACE_FILE, TOOL_ROW_KIND.WORKSPACE_WRITE],
  [BRAIN_TOOL.APPEND_DAILY_NOTE, TOOL_ROW_KIND.DAILY_NOTE_APPEND],
  [BRAIN_TOOL.LIST_DAILY_NOTES, TOOL_ROW_KIND.DAILY_NOTES_LIST],
  [BRAIN_TOOL.LOAD_SKILL, TOOL_ROW_KIND.SKILL],
  [BRAIN_TOOL.SESSIONS_SPAWN, TOOL_ROW_KIND.DELEGATE],
  [BRAIN_TOOL.SUBAGENTS, TOOL_ROW_KIND.CHILDREN],
  [BRAIN_TOOL.SESSIONS_LIST, TOOL_ROW_KIND.CONVERSATIONS],
  [BRAIN_TOOL.SESSIONS_HISTORY, TOOL_ROW_KIND.CHILD_HISTORY],
  [NOTEBOOK_MEMORY_TOOL.SEARCH, TOOL_ROW_KIND.NOTEBOOK_SEARCH],
  [NOTEBOOK_MEMORY_TOOL.GET, TOOL_ROW_KIND.NOTEBOOK_READ],
]);

/** A tool's name as a reader sees it, for a tool this build has no words for: the underscores the model spells it with become spaces. */
export function detailToolLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

/**
 * What became of the action, as the row marks it: the envelope's three words,
 * and beside them the two the part's own state says before an envelope
 * exists — a call still under way, and one whose tool failed outright and
 * answered with an error rather than an envelope. Part state and envelope
 * status are different questions: an answered part whose envelope says
 * refused is a row that says so, while an errored part is a refusal drawn only
 * inside its turn.
 */
export const TOOL_ROW_STATUS = {
  ACCEPTED: ACTION_OUTPUT_STATUS.ACCEPTED,
  UNKNOWN: ACTION_OUTPUT_STATUS.UNKNOWN,
  REFUSED: ACTION_OUTPUT_STATUS.REFUSED,
  PENDING: "pending",
  FAILED: "failed",
} as const;

type ToolRowStatus = (typeof TOOL_ROW_STATUS)[keyof typeof TOOL_ROW_STATUS];

/**
 * The session a row names, drawn as a chip: its current title while the roster
 * holds it, the title the envelope kept once it does not, under the mark of the
 * agent behind it or its provider. The chip is the row's own press by another
 * hand where the session has an identity to open by; a session the roster
 * holds but reported no address for, and a creation whose answer named no
 * session, are names alone.
 */
export interface ToolRowChip {
  readonly text: string;
  readonly markId?: string;
  readonly identity?: SessionIdentity;
  readonly openable: boolean;
}

/** One run of the row's words: plain text, or the chip. */
type ToolRowRun = { readonly text: string } | { readonly chip: ToolRowChip };

export interface ToolRow {
  readonly kind: ToolRowKind;
  /** What a control does, when its adapter said; the row's mark follows it. */
  readonly controlKind?: SessionControlKind;
  readonly status: ToolRowStatus;
  /** The provider the action reached, for the row's trailing mark. */
  readonly providerId?: string;
  readonly runs: readonly ToolRowRun[];
  /** Why a refused or unknown call ended as it did, or what an errored tool answered. */
  readonly reason?: string;
  /** The carrier's own sentence about an accepted action, where it wrote one. */
  readonly note?: string;
  readonly warning?: string;
}

/** What a chip says of a session neither the roster nor the envelope can name. */
export const UNNAMED_SESSION = "an unnamed chat";

/** What a row says when the record of the action's answer cannot be read. */
const UNREADABLE_ENVELOPE = "The record of this action's answer could not be read.";

/**
 * What a brain tool's answer says of itself, and nothing more: the status the
 * tool's own record carries and the reason a refusal gives. Every other key —
 * the roster, the transcript, the file, the search's results — is dropped
 * unread, so the row can say the tool refused without drawing what it read.
 */
const TOOL_ANSWER = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

function envelopeOf(part: StoredToolPart): ActionOutputEnvelope | undefined {
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) return undefined;
  // SAFETY: a stored part's output is JSON the store holds as jsonb; the wire boundary is where it is read.
  const read = readEither(ACTION_OUTPUT, { excess: EXCESS_KEYS.DROP })(
    unparsedWire(part.output as WireBoundaryInput),
  );
  return Result.getOrUndefined(read);
}

/** What became of the action and, where it did not simply land, why. */
interface RowOutcome {
  readonly status: ToolRowStatus;
  readonly reason?: string;
}

function rowStatus(part: StoredToolPart, envelope: ActionOutputEnvelope | undefined): RowOutcome {
  switch (part.state) {
    case TOOL_PART_STATE.INPUT_STREAMING:
    case TOOL_PART_STATE.INPUT_AVAILABLE:
      return { status: TOOL_ROW_STATUS.PENDING };
    case TOOL_PART_STATE.OUTPUT_ERROR:
      return { status: TOOL_ROW_STATUS.FAILED, reason: part.errorText };
    case TOOL_PART_STATE.OUTPUT_AVAILABLE:
      if (envelope === undefined) {
        return { status: TOOL_ROW_STATUS.UNKNOWN, reason: UNREADABLE_ENVELOPE };
      }
      return envelope.status === ACTION_OUTPUT_STATUS.ACCEPTED
        ? { status: envelope.status }
        : { status: envelope.status, reason: envelope.reason };
  }
}

/**
 * What became of a brain tool's call: the part's own state before an answer,
 * and once answered, a refusal exactly where the tool's record says so — a
 * status other than accepted beside a reason — and a landing everywhere else,
 * since a read that answered its roster or its lines carries no status at all.
 */
function detailOutcome(part: StoredToolPart): RowOutcome {
  switch (part.state) {
    case TOOL_PART_STATE.INPUT_STREAMING:
    case TOOL_PART_STATE.INPUT_AVAILABLE:
      return { status: TOOL_ROW_STATUS.PENDING };
    case TOOL_PART_STATE.OUTPUT_ERROR:
      return { status: TOOL_ROW_STATUS.FAILED, reason: part.errorText };
    case TOOL_PART_STATE.OUTPUT_AVAILABLE: {
      // SAFETY: a stored part's output is JSON the store holds as jsonb; the wire boundary is where it is read.
      const read = parsedRequest(TOOL_ANSWER, unparsedWire(part.output as WireBoundaryInput));
      return read.ok &&
        read.value.status !== undefined &&
        read.value.status !== ACTION_RESULT_STATUS.ACCEPTED &&
        read.value.reason !== undefined
        ? { status: TOOL_ROW_STATUS.REFUSED, reason: read.value.reason }
        : { status: TOOL_ROW_STATUS.ACCEPTED };
    }
  }
}

function inputOf(part: StoredToolPart): UnparsedWireValue {
  // SAFETY: a stored part's input is the call's JSON arguments; the wire boundary is where they are read.
  return unparsedWire(part.input as WireBoundaryInput);
}

/** One string the call's arguments carry under a key, or nothing where the arguments do not say. */
function wordIn(input: UnparsedWireValue, key: string): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return isWireString(value) ? value : undefined;
}

function rosterSession(
  identity: SessionIdentity | undefined,
  roster: readonly SessionView[],
): SessionView | undefined {
  if (identity === undefined) return undefined;
  return roster.find(
    (session) =>
      session.providerId === identity.providerId && session.id === identity.providerSessionId,
  );
}

/** What a chip falls back on when neither the roster nor the envelope names the session: the call's own words. */
interface ChipFallback {
  readonly name?: string;
  readonly markId?: string;
}

/**
 * The chip for the session an action named: by the roster while it holds the
 * session, by the envelope's snapshot once it does not, and by the call's own
 * words where neither says. A session the roster holds is pressable exactly
 * when its own row is; outside the roster, the caller decides whether the
 * identity alone is enough to press, which a created workspace's identifier is not.
 */
function sessionChip(
  identity: SessionIdentity | undefined,
  target: ActionTargetSnapshot | undefined,
  roster: readonly SessionView[],
  fallback: ChipFallback = {},
  options: { readonly openWhenAbsentIdentity?: boolean } = {},
): ToolRowChip {
  const session = rosterSession(identity, roster);
  if (session !== undefined) {
    return {
      text: session.title,
      markId: session.agentId ?? session.providerId,
      identity: { providerId: session.providerId, providerSessionId: session.id },
      openable: session.openable,
    };
  }
  const markId = target?.agentId ?? fallback.markId ?? target?.providerId ?? identity?.providerId;
  return {
    text: target?.title ?? fallback.name ?? UNNAMED_SESSION,
    ...(markId !== undefined ? { markId } : undefined),
    ...(identity !== undefined ? { identity } : undefined),
    openable: (options.openWhenAbsentIdentity ?? true) && identity !== undefined,
  };
}

function identityFrom(
  input: { provider_id: string; provider_session_id: string } | undefined,
  target: ActionTargetSnapshot | undefined,
): SessionIdentity | undefined {
  if (input !== undefined) {
    return { providerId: input.provider_id, providerSessionId: input.provider_session_id };
  }
  return target?.providerSessionId !== undefined
    ? { providerId: target.providerId, providerSessionId: target.providerSessionId }
    : undefined;
}

/** The name an application id draws: the roster's own for the session, or the id where the roster no longer says. */
function applicationName(applicationId: string, session: SessionView | undefined): string {
  return (
    session?.applications.find((application) => application.id === applicationId)?.name ??
    applicationId
  );
}

interface Composition {
  readonly runs: readonly ToolRowRun[];
  readonly providerId?: string;
  readonly controlKind?: SessionControlKind;
}

/** The session an action's arguments name, as a chip and the provider mark beside it. */
interface NamedSession {
  readonly identity: SessionIdentity | undefined;
  readonly chip: ToolRowChip;
  readonly providerId?: string;
}

function namedSession(
  input: { provider_id: string; provider_session_id: string } | undefined,
  target: ActionTargetSnapshot | undefined,
  roster: readonly SessionView[],
): NamedSession {
  const identity = identityFrom(input, target);
  const providerId = target?.providerId ?? identity?.providerId;
  return {
    identity,
    chip: sessionChip(identity, target, roster),
    ...(providerId !== undefined ? { providerId } : undefined),
  };
}

/**
 * A setting as the row names it: its guide id in words, since the label its
 * row wears is built beside the current settings, which a row of the past
 * has no business reading.
 */
function settingLabel(settingId: string): string {
  return `the ${detailToolLabel(settingId)} setting`;
}

/** What each press of the Updates row did, in the row's words. */
const UPDATE_WORDS = {
  [APP_UPDATE_ACTION.CHECK]: "Checked for updates",
  [APP_UPDATE_ACTION.DOWNLOAD]: "Opened the latest release to download",
  [APP_UPDATE_ACTION.RESTART]: "Restarted into the downloaded update",
} as const satisfies Record<(typeof APP_UPDATE_ACTION)[keyof typeof APP_UPDATE_ACTION], string>;

function composeRuns(
  kind: ActionKind,
  part: StoredToolPart,
  target: ActionTargetSnapshot | undefined,
  envelope: ActionOutputEnvelope | undefined,
  roster: readonly SessionView[],
): Composition {
  const input = inputOf(part);
  switch (kind) {
    case ACTION_KIND.MESSAGE: {
      const read = parsedRequest(MESSAGE_REQUEST, input);
      const { chip, providerId } = namedSession(read.ok ? read.value : undefined, target, roster);
      return {
        runs: [
          { text: "Sent a message to " },
          { chip },
          ...(read.ok ? [{ text: `: "${read.value.text}"` }] : []),
        ],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case ACTION_KIND.CONTROL: {
      const read = parsedRequest(CONTROL_REQUEST, input);
      const { chip, providerId } = namedSession(read.ok ? read.value : undefined, target, roster);
      const controlKind = target?.controlKind;
      const label = target?.controlLabel;
      const lead =
        controlKind === SESSION_CONTROL_KIND.ARCHIVE
          ? "Archived "
          : controlKind === SESSION_CONTROL_KIND.STOP
            ? "Stopped "
            : label === undefined
              ? "Ran a control on "
              : `Ran "${label}" on `;
      return {
        runs: [{ text: lead }, { chip }],
        ...(providerId !== undefined ? { providerId } : undefined),
        ...(controlKind !== undefined ? { controlKind } : undefined),
      };
    }
    case ACTION_KIND.OPEN: {
      const read = parsedRequest(OPEN_REQUEST, input);
      const { identity, chip, providerId } = namedSession(
        read.ok ? read.value : undefined,
        target,
        roster,
      );
      const applicationId = target?.applicationId ?? (read.ok ? read.value.application : undefined);
      return {
        runs: [
          { text: "Opened " },
          { chip },
          ...(applicationId === undefined
            ? []
            : [{ text: ` in ${applicationName(applicationId, rosterSession(identity, roster))}` }]),
        ],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case ACTION_KIND.CREATE_WORKSPACE: {
      const read = parsedRequest(CREATE_WORKSPACE_REQUEST, input);
      const created =
        envelope?.status === ACTION_OUTPUT_STATUS.ACCEPTED ? envelope.createdSession : undefined;
      const providerId = target?.providerId ?? (read.ok ? read.value.provider_id : undefined);
      const name = read.ok ? read.value.name : undefined;
      // A creation names no agent, so its mark is the provider's.
      const fallback: ChipFallback = {
        ...(name !== undefined ? { name } : undefined),
        ...(providerId !== undefined ? { markId: providerId } : undefined),
      };
      // The session the answer named is the chip, wherever the roster stands;
      // a creation whose answer named none is a name alone, or no chip at all.
      const chip: ToolRowChip | undefined =
        created !== undefined
          ? sessionChip(created, target, roster, fallback, { openWhenAbsentIdentity: false })
          : name !== undefined
            ? {
                text: name,
                ...(providerId !== undefined ? { markId: providerId } : undefined),
                openable: false,
              }
            : undefined;
      return {
        runs:
          chip === undefined
            ? [{ text: "Created a new workspace" }]
            : [{ text: "Created a new workspace " }, { chip }],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case ACTION_KIND.ADD_AGENT: {
      const read = parsedRequest(ADD_AGENT_REQUEST, input);
      const { chip, providerId } = namedSession(read.ok ? read.value : undefined, target, roster);
      return {
        runs: [
          { text: read.ok ? `Added a ${read.value.agent} agent to ` : "Added an agent to " },
          { chip },
        ],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case ACTION_KIND.RENAME_WORKSPACE:
    case ACTION_KIND.RENAME_SESSION: {
      const read = parsedRequest(
        kind === ACTION_KIND.RENAME_WORKSPACE ? RENAME_WORKSPACE_REQUEST : RENAME_SESSION_REQUEST,
        input,
      );
      const { chip, providerId } = namedSession(read.ok ? read.value : undefined, target, roster);
      return {
        runs: [
          { text: kind === ACTION_KIND.RENAME_WORKSPACE ? "Renamed workspace " : "Renamed " },
          { chip },
          ...(read.ok ? [{ text: ` to "${read.value.name}"` }] : []),
        ],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case ACTION_KIND.SETTING: {
      const read = parsedRequest(SETTING_REQUEST, input);
      return {
        runs: [
          {
            text: read.ok
              ? `Changed ${settingLabel(read.value.setting_id)} to "${read.value.value}"`
              : "Changed a setting",
          },
        ],
      };
    }
    case ACTION_KIND.PANEL: {
      const read = parsedRequest(PANEL_REQUEST, input);
      const tab = read.ok ? (read.value.tab ?? APP_PANEL_TAB.SESSIONS) : APP_PANEL_TAB.SESSIONS;
      return { runs: [{ text: `Showed the ${tab} tab` }] };
    }
    case ACTION_KIND.FEEDBACK: {
      const read = parsedRequest(FEEDBACK_REQUEST, input);
      return {
        runs: [{ text: read.ok ? `Opened the ${read.value.kind} composer` : "Opened a composer" }],
      };
    }
    case ACTION_KIND.UPDATE: {
      const read = parsedRequest(UPDATE_REQUEST, input);
      return {
        runs: [{ text: read.ok ? UPDATE_WORDS[read.value.action] : "Pressed the Updates row" }],
      };
    }
  }
}

/**
 * The words for one of the brain's own tools: what it read or wrote, named
 * by the call's arguments where they name it, and never a word of the answer.
 * A transcript read names its session as the chip an action's row would, with
 * the provider's mark trailing.
 */
function composeDetail(
  kind: DetailKind,
  toolName: string,
  part: StoredToolPart,
  roster: readonly SessionView[],
): Composition {
  const input = inputOf(part);
  switch (kind) {
    case TOOL_ROW_KIND.ROSTER:
      return { runs: [{ text: "Looked at the roster" }] };
    case TOOL_ROW_KIND.TRANSCRIPT: {
      const providerId = wordIn(input, "provider_id");
      const providerSessionId = wordIn(input, "provider_session_id");
      const identity =
        providerId !== undefined && providerSessionId !== undefined
          ? { providerId, providerSessionId }
          : undefined;
      return {
        runs: [
          { text: "Read the transcript of " },
          { chip: sessionChip(identity, undefined, roster) },
        ],
        ...(providerId !== undefined ? { providerId } : undefined),
      };
    }
    case TOOL_ROW_KIND.WORKSPACE_READ: {
      const name = wordIn(input, "name");
      return {
        runs: [
          {
            text:
              name === undefined ? "Read a workspace file" : `Read the workspace file "${name}"`,
          },
        ],
      };
    }
    case TOOL_ROW_KIND.WORKSPACE_WRITE: {
      const name = wordIn(input, "name");
      return {
        runs: [
          {
            text:
              name === undefined ? "Wrote a workspace file" : `Wrote the workspace file "${name}"`,
          },
        ],
      };
    }
    // An entry's words are the note's, not the row's: the row says a note grew and nothing of what it gained.
    case TOOL_ROW_KIND.DAILY_NOTE_APPEND:
      return { runs: [{ text: "Added to today's note" }] };
    case TOOL_ROW_KIND.DAILY_NOTES_LIST:
      return { runs: [{ text: "Listed his dated notes" }] };
    case TOOL_ROW_KIND.SKILL: {
      const location = wordIn(input, "location");
      return {
        runs: [
          { text: location === undefined ? "Loaded a skill" : `Loaded the skill at "${location}"` },
        ],
      };
    }
    case TOOL_ROW_KIND.DELEGATE: {
      const label = wordIn(input, "label");
      return {
        runs: [
          {
            text:
              label === undefined
                ? "Delegated a task to a child"
                : `Delegated "${label}" to a child`,
          },
        ],
      };
    }
    case TOOL_ROW_KIND.CHILDREN:
      return {
        runs: [
          {
            text:
              wordIn(input, "action") === SUBAGENTS_ACTION.CANCEL
                ? "Cancelled a child"
                : "Listed the children",
          },
        ],
      };
    case TOOL_ROW_KIND.CONVERSATIONS:
      return { runs: [{ text: "Listed his own conversations" }] };
    case TOOL_ROW_KIND.CHILD_HISTORY:
      return { runs: [{ text: "Read a child's history" }] };
    case TOOL_ROW_KIND.NOTEBOOK_SEARCH: {
      const query = wordIn(input, "query");
      return {
        runs: [
          {
            text:
              query === undefined
                ? "Searched the notebook"
                : `Searched the notebook for "${query}"`,
          },
        ],
      };
    }
    case TOOL_ROW_KIND.NOTEBOOK_READ: {
      const path = wordIn(input, "path");
      return {
        runs: [
          {
            text:
              path === undefined ? "Read from the notebook" : `Read "${path}" from the notebook`,
          },
        ],
      };
    }
    case TOOL_ROW_KIND.OTHER:
      return { runs: [{ text: `Ran ${detailToolLabel(toolName)}` }] };
  }
}

/**
 * The row a tool call's part draws: an action's, composed from the part's
 * arguments and its envelope, or a brain tool's, composed from its arguments
 * and whether it refused. The roster as it stands supplies only the current
 * name and address of a session it still holds.
 */
export function toolRow(part: StoredToolPart, roster: readonly SessionView[]): ToolRow {
  const toolName = storedToolName(part);
  const kind = actionToolKind(toolName);
  if (kind === undefined) {
    const detailKind = DETAIL_KIND_BY_TOOL.get(toolName) ?? TOOL_ROW_KIND.OTHER;
    const { status, reason } = detailOutcome(part);
    const composition = composeDetail(detailKind, toolName, part, roster);
    return {
      kind: detailKind,
      status,
      ...(composition.providerId !== undefined
        ? { providerId: composition.providerId }
        : undefined),
      runs: composition.runs,
      ...(reason !== undefined ? { reason } : undefined),
    };
  }
  const envelope = envelopeOf(part);
  const target = envelope?.target;
  const { status, reason } = rowStatus(part, envelope);
  const composition = composeRuns(kind, part, target, envelope, roster);
  const accepted = envelope?.status === ACTION_OUTPUT_STATUS.ACCEPTED ? envelope : undefined;
  return {
    kind,
    ...(composition.controlKind !== undefined
      ? { controlKind: composition.controlKind }
      : undefined),
    status,
    ...(composition.providerId !== undefined ? { providerId: composition.providerId } : undefined),
    runs: composition.runs,
    ...(reason !== undefined ? { reason } : undefined),
    ...(accepted?.note !== undefined ? { note: accepted.note } : undefined),
    ...(accepted?.warning !== undefined ? { warning: accepted.warning } : undefined),
  };
}
