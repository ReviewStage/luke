import {
  ACTION_KIND,
  ACTION_OUTPUT,
  ACTION_OUTPUT_STATUS,
  ACTIONS,
  type ActionOutputEnvelope,
  type ActionTargetSnapshot,
  realtimeToolKind,
  type SessionActionKind,
} from "@sidecar/actions";
import {
  SESSION_CONTROL_KIND,
  type SessionControlKind,
  type SessionIdentity,
  type StoredToolPart,
  storedToolName,
  TOOL_PART_STATE,
} from "@sidecar/session";
import { type UnparsedWireValue, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import type { SessionView } from "./session-model";

/**
 * How an action's tool part becomes a row: from the call's own arguments and
 * the envelope its output carries, and nothing else. The arguments say what
 * was asked — which session, what text, which control — and the envelope says
 * what became of it and what the target was when it ran: its title, its agent,
 * the control's label and kind, the session a creation made. The roster as it
 * stands now supplies the current name of a session it still holds; once it
 * has let the session go, the envelope's snapshot names it, which is what keeps
 * a departed chat nameable. No sentence is stored anywhere for a row to draw:
 * the words here are the desktop's, and the phone words the same parts itself.
 */

/** The action kinds a tool row is drawn for: the session family, whose tools answer in the envelope. */
const SESSION_ACTION_KINDS: ReadonlySet<string> = new Set<SessionActionKind>([
  ACTION_KIND.MESSAGE,
  ACTION_KIND.CONTROL,
  ACTION_KIND.OPEN,
  ACTION_KIND.CREATE_WORKSPACE,
  ACTION_KIND.ADD_AGENT,
  ACTION_KIND.RENAME_WORKSPACE,
  ACTION_KIND.RENAME_SESSION,
]);

function isSessionActionKind(kind: string): kind is SessionActionKind {
  return SESSION_ACTION_KINDS.has(kind);
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
  readonly kind: SessionActionKind;
  /** What a control does, when its adapter said; the row's mark follows it. */
  readonly controlKind?: SessionControlKind;
  readonly status: ToolRowStatus;
  /** The provider the action reached, for the row's trailing mark. */
  readonly providerId?: string;
  readonly runs: readonly ToolRowRun[];
  /** Why a refused or unknown action ended as it did, or what an errored tool answered. */
  readonly reason?: string;
  /** The carrier's own sentence about an accepted action, where it wrote one. */
  readonly note?: string;
  readonly warning?: string;
}

/** What a chip says of a session neither the roster nor the envelope can name. */
export const UNNAMED_SESSION = "an unnamed chat";

/** What a row says when the record of the action's answer cannot be read. */
const UNREADABLE_ENVELOPE = "The record of this action's answer could not be read.";

function envelopeOf(part: StoredToolPart): ActionOutputEnvelope | undefined {
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) return undefined;
  // SAFETY: a stored part's output is JSON the store holds as jsonb; the wire boundary is where it is read.
  const read = ACTION_OUTPUT.read(unparsedWire(part.output as WireBoundaryInput));
  return read.ok ? read.value : undefined;
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

function inputOf(part: StoredToolPart): UnparsedWireValue {
  // SAFETY: a stored part's input is the call's JSON arguments; the wire boundary is where they are read.
  return unparsedWire(part.input as WireBoundaryInput);
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
 * when its own row is; one the roster has let go is pressable by identity,
 * and the host answers with the address it last reported or refuses.
 */
function sessionChip(
  identity: SessionIdentity | undefined,
  target: ActionTargetSnapshot | undefined,
  roster: readonly SessionView[],
  fallback: ChipFallback = {},
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
    openable: identity !== undefined,
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

function composeRuns(
  kind: SessionActionKind,
  part: StoredToolPart,
  target: ActionTargetSnapshot | undefined,
  envelope: ActionOutputEnvelope | undefined,
  roster: readonly SessionView[],
): Composition {
  const input = inputOf(part);
  switch (kind) {
    case ACTION_KIND.MESSAGE: {
      const read = ACTIONS.SEND_SESSION_MESSAGE.request.read(input);
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
      const read = ACTIONS.RUN_SESSION_CONTROL.request.read(input);
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
      const read = ACTIONS.OPEN_SESSION.request.read(input);
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
      const read = ACTIONS.CREATE_WORKSPACE.request.read(input);
      const created =
        envelope?.status === ACTION_OUTPUT_STATUS.ACCEPTED ? envelope.createdSession : undefined;
      const providerId = target?.providerId ?? (read.ok ? read.value.provider_id : undefined);
      const name = read.ok ? read.value.name : undefined;
      const markId = (read.ok ? read.value.agent : undefined) ?? providerId;
      const fallback: ChipFallback = {
        ...(name !== undefined ? { name } : undefined),
        ...(markId !== undefined ? { markId } : undefined),
      };
      // The session the answer named is the chip, wherever the roster stands;
      // a creation whose answer named none is a name alone, or no chip at all.
      const chip: ToolRowChip | undefined =
        created !== undefined
          ? sessionChip(created, target, roster, fallback)
          : name !== undefined
            ? { text: name, ...(markId !== undefined ? { markId } : undefined), openable: false }
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
      const read = ACTIONS.ADD_WORKSPACE_AGENT.request.read(input);
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
      const read = (
        kind === ACTION_KIND.RENAME_WORKSPACE ? ACTIONS.RENAME_WORKSPACE : ACTIONS.RENAME_SESSION
      ).request.read(input);
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
  }
}

/**
 * The row an action's tool part draws, or nothing for a tool that is not a
 * session action. Composed from the part's arguments and its envelope alone,
 * with the roster as it stands supplying only the current name and address of
 * a session it still holds.
 */
export function toolRow(part: StoredToolPart, roster: readonly SessionView[]): ToolRow | undefined {
  const kind = realtimeToolKind(storedToolName(part));
  if (kind === undefined || !isSessionActionKind(kind)) return undefined;
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
