import { Schema as EffectSchema } from "effect";
import { agentsContract } from "./contract/agents.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * terminal-view.ts -- a coding agent's terminals as the host answers the desktop for them: what each call takes and answers, why one could not be done, and the events an attached shell's connection is heard through.
 *
 * The host speaks our own relay for each attached shell
 * (`terminal-wire.ts`) and answers the desktop through the Gateway: the
 * calls carry ids, sizes, and names; what a shell printed is heard as the
 * connection's own events, named by a connection id the desktop minted for
 * the one panel it posted a port to, so the bytes reach that panel and no
 * other place. A refusal the tab acts on is an answer, spelled as its
 * procedure declares it (`hosted-failure.ts`); an outage is the call's own
 * failure.
 */

/**
 * The terminal calls' refusals the tab spells as it shipped them: an archived
 * agent is gone, the agent's sandbox not answering (Vercel Sandbox's API or
 * tmux in it, the routes' one upstream) is the sandbox unanswered, and an
 * agent not the caller's to reach is not found, as another workspace's is.
 */
export const TERMINAL_RENAMES = {
  [HOSTED_API_ERROR.AGENT_RETIRED]: "gone",
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: "sandbox-unanswered",
  [HOSTED_API_ERROR.NOT_PERMITTED]: "not-found",
} as const;

/** The procedures the tab's calls ask. */
const terminalContract = {
  terminals: agentsContract.terminals,
  openTerminal: agentsContract.openTerminal,
  renameTerminal: agentsContract.renameTerminal,
  endTerminal: agentsContract.endTerminal,
  sandboxResume: agentsContract.sandboxResume,
};

/**
 * Why a terminal call could not be done: the sandbox stopped or not yet
 * opened, no such agent or shell, the sandbox unanswered, its snapshot gone,
 * the agent archived, or no answer at all.
 */
export const TERMINAL_REFUSAL = failureSetOf(terminalContract, { as: TERMINAL_RENAMES });

export type TerminalRefusal = (typeof TERMINAL_REFUSAL)[keyof typeof TERMINAL_REFUSAL];

/** How a shell's connection stands. */
export const TERMINAL_CONNECTION = {
  /** The socket is opening; the first word on a new connection. */
  CONNECTING: "connecting",
  /** Connected, and the shell reattached. */
  ATTACHED: "attached",
  /** The socket dropped — a sleep, a network change, the relay's bound — and the host is reconnecting on its own. */
  RECONNECTING: "reconnecting",
  /** Ended by the host after ten minutes with nothing typed, printed, or shown, or as a sign-out ends it; the host does not reconnect until the tab attaches again. */
  IDLE: "idle",
  /** The sandbox is stopped; only the developer's resume brings it back. */
  STOPPED: "stopped",
  /** The agent has not opened its sandbox yet; the host asks again until it has. */
  STARTING: "starting",
  /** The shell ended, its exit status in `code`. */
  EXITED: "exited",
  /** The agent was archived, or the shell was ended elsewhere. */
  GONE: "gone",
  /** The deployment serves no terminal relay: its upgrade path answered not found, so asking again later is the developer's to do. */
  UNAVAILABLE: "unavailable",
} as const;

export type TerminalConnection = (typeof TERMINAL_CONNECTION)[keyof typeof TERMINAL_CONNECTION];

const id = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(64));
const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));
const title = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(60));

/**
 * How a shell's output is paced to what the tab has drawn, and the bounds of
 * what the tab sends. Both ends count output in bytes, as the port's
 * `Uint8Array` carries it, never characters: the tab acks every
 * `ACK_EVERY_BYTES` it has written, the host stops reading the socket once
 * more than `PAUSE_ABOVE_BYTES` stand unacked, and reads again once fewer
 * than `RESUME_BELOW_BYTES` do. These are VS Code's watermarks.
 */
export const TERMINAL_FLOW = {
  ACK_EVERY_BYTES: 5_000,
  PAUSE_ABOVE_BYTES: 100_000,
  RESUME_BELOW_BYTES: 5_000,
  /** The most characters one input message carries: a paste is cut into messages of this size. */
  MAX_INPUT_CHARS: 65_536,
  /** The widest and tallest a terminal is taken to be. */
  MAX_COLUMNS: 1_000,
  MAX_ROWS: 1_000,
} as const;

/** A call that names an agent. */
export const terminalAgentParamsSchema = EffectSchema.Struct({ agentId: id });

/** A call that names one of an agent's shells. */
export const terminalShellParamsSchema = EffectSchema.Struct({ agentId: id, terminalId: id });

export const terminalCreateParamsSchema = EffectSchema.Struct({
  agentId: id,
  title: EffectSchema.optional(title),
});

export const terminalRenameParamsSchema = EffectSchema.Struct({
  agentId: id,
  terminalId: id,
  title,
});

/** A shell attached for one panel, under the connection id the desktop minted for it. */
export const terminalConnectParamsSchema = EffectSchema.Struct({
  connectionId: id,
  agentId: id,
  terminalId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

/** A connection the call names. */
export const terminalConnectionParamsSchema = EffectSchema.Struct({ connectionId: id });

/** What was typed on a connection. */
export const terminalInputParamsSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String.check(EffectSchema.isMaxLength(TERMINAL_FLOW.MAX_INPUT_CHARS)),
});

/** A connection's terminal resized. */
export const terminalResizeParamsSchema = EffectSchema.Struct({
  connectionId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

/** How many bytes of a connection's output the terminal has written since the last ack. */
export const terminalAckParamsSchema = EffectSchema.Struct({
  connectionId: id,
  bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

/** The agent's shells and where its sandbox stands, or why not; a shell renamed or ended answers the same. */
export const terminalsActAnswerSchema = answerView(agentsContract.renameTerminal, {
  as: TERMINAL_RENAMES,
});

/** The shell started, or why not. */
export const terminalCreatedActAnswerSchema = answerView(agentsContract.openTerminal, {
  as: TERMINAL_RENAMES,
});

/** Where the sandbox stands after a resume, or why not. */
export const terminalResumedActAnswerSchema = answerView(agentsContract.sandboxResume, {
  as: TERMINAL_RENAMES,
});

export type TerminalsActAnswer = typeof terminalsActAnswerSchema.Type;
export type TerminalCreatedActAnswer = typeof terminalCreatedActAnswerSchema.Type;
export type TerminalResumedActAnswer = typeof terminalResumedActAnswerSchema.Type;

/** What a connection's shell printed, its bytes in base64, as the host's event carries it. */
export const terminalOutputEventSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String,
});

/** How a connection stands, as the host's event carries it. */
export const terminalStateEventSchema = EffectSchema.Struct({
  connectionId: id,
  state: EffectSchema.Literals(Object.values(TERMINAL_CONNECTION)),
  code: EffectSchema.optional(EffectSchema.Int),
});

export type TerminalStateEvent = typeof terminalStateEventSchema.Type;
