import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";

import { workspaceIdSchema } from "./task-wire.js";
import { TERMINAL_FLOW } from "./terminal-view.js";

/**
 * pr-run-view.ts -- running a coding agent's work on this Mac: a run's target, its phases, and the port its output reaches the one panel on.
 *
 * A run is named by the agent whose work it runs, with the agent's workspace
 * and repository. Its setup and run commands are the workspace's, shared by
 * every member (`repository-run-wire.ts`), and never the agent's. A run is
 * asked of the panel that draws it: main mints a connection for that panel
 * and that agent, posts the panel a port, and the host takes the agent's
 * working tree from its sandbox (`run-snapshot-wire.ts`) into Luke's own
 * checkout of it, runs the commands there, and hands up what they print as
 * events named by the connection, which main posts on that one port. What a
 * run prints is never an answer, app state, a trace, a counted event, or a
 * file; it is paced to what the tab has drawn by the terminal's watermarks.
 * No call carries anything of the token the host fetches with.
 */

/** The bounds of what a run says. */
export const PR_RUN_BOUNDS = {
  /** The most characters a run's sentence about where it stands carries. */
  MAX_MESSAGE_CHARS: 2_000,
} as const;

/** The pacing of a run's output, which is a terminal's. */
export const PR_RUN_FLOW = {
  ACK_EVERY_BYTES: TERMINAL_FLOW.ACK_EVERY_BYTES,
  PAUSE_ABOVE_BYTES: TERMINAL_FLOW.PAUSE_ABOVE_BYTES,
  RESUME_BELOW_BYTES: TERMINAL_FLOW.RESUME_BELOW_BYTES,
} as const;

/** Where a run stands: fetching and checking out, running, or ended one of three ways. */
export const PR_RUN_PHASE = {
  PREPARING: "preparing",
  RUNNING: "running",
  /** The command ended on its own with status 0. */
  SUCCESS: "success",
  /** The command ended on its own with another status, or the run could not start, `message` saying why. */
  FAILURE: "failure",
  /** The developer stopped it, closed its tab, signed out, or quit. */
  STOPPED: "stopped",
} as const;

export type PrRunPhase = (typeof PR_RUN_PHASE)[keyof typeof PR_RUN_PHASE];

const connectionId = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(64),
);

/** A commit's id as Git spells it. */
const commitShaSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{40}$/u));

/** A coding agent whose work is run, with its workspace and repository: what a run, its checkout, and its tab are named by. */
export const prRunTargetSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  agentId: EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f-]{36}$/u)),
});

export type PrRunTarget = typeof prRunTargetSchema.Type;

/** Reading a workspace's shared run commands names the workspace. */
export const prRunWorkspaceParamsSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

/** Where a run stands, as its tab draws it. */
const prRunStateSchema = EffectSchema.Struct({
  phase: EffectSchema.Literals(Object.values(PR_RUN_PHASE)),
  /** The commit checked out and run, once it is known. */
  sha: EffectSchema.optional(commitShaSchema),
  /** The command's exit status, once it ended on its own. */
  exitCode: EffectSchema.optional(EffectSchema.Int),
  /** Why a run could not start, or what it is doing, in words for the developer. */
  message: EffectSchema.optional(
    EffectSchema.String.check(EffectSchema.isMaxLength(PR_RUN_BOUNDS.MAX_MESSAGE_CHARS)),
  ),
});

export type PrRunState = typeof prRunStateSchema.Type;

/** What a call that may be refused in words answers: done, or why not. */
export const prRunOutcomeSchema = EffectSchema.Union([
  EffectSchema.Struct({ done: EffectSchema.Literal(true) }),
  EffectSchema.Struct({
    refused: EffectSchema.String.check(EffectSchema.isMaxLength(PR_RUN_BOUNDS.MAX_MESSAGE_CHARS)),
  }),
]);

export type PrRunOutcome = typeof prRunOutcomeSchema.Type;

/** Where a pull request's checkout stands on disk, or null where there is none. */
export const prRunLocationSchema = EffectSchema.Struct({
  path: EffectSchema.NullOr(EffectSchema.String),
});

export type PrRunLocation = typeof prRunLocationSchema.Type;

/** The host's start: the connection main minted for the asking panel, and the pull request. */
export const prRunStartParamsSchema = EffectSchema.Struct({
  connectionId,
  ...prRunTargetSchema.fields,
});

/** A call naming one connection. */
export const prRunConnectionParamsSchema = EffectSchema.Struct({ connectionId });

/** How many bytes of a connection's output its tab has written since the last ack. */
export const prRunAckParamsSchema = EffectSchema.Struct({
  connectionId,
  bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

/** What a run printed, base64, for the one connection that reaches its tab. */
export const prRunOutputEventSchema = EffectSchema.Struct({
  connectionId,
  data: EffectSchema.String,
});

/** Where a run stands, for the one connection that reaches its tab. */
export const prRunStateEventSchema = EffectSchema.Struct({
  connectionId,
  ...prRunStateSchema.fields,
});

export type PrRunStateEvent = typeof prRunStateEventSchema.Type;

/** The channel a run's port is posted to its panel on. */
export const PR_RUN_PORT_CHANNEL = "pr-run:port";

/** What travels on a run's port. */
export const PR_RUN_PORT_MESSAGE = {
  /** main → renderer: what the run printed, to `xterm.write`. */
  OUTPUT: "output",
  /** main → renderer: where the run stands. */
  STATE: "state",
  /** renderer → main: how many bytes of output the tab has written since the last ack. */
  ACK: "ack",
} as const;

/** The ticket a run's port is posted with, naming its pull request. */
export const prRunPortTicketSchema = prRunTargetSchema;

/** What main sends on a run's port. */
export const prRunPortOutboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(PR_RUN_PORT_MESSAGE.OUTPUT),
    data: EffectSchema.Uint8Array,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PR_RUN_PORT_MESSAGE.STATE),
    state: prRunStateSchema,
  }),
]);

export type PrRunPortOutbound = typeof prRunPortOutboundSchema.Type;

/** What the renderer sends on a run's port: acks alone, since a run takes no input. */
export const prRunPortInboundSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PR_RUN_PORT_MESSAGE.ACK),
  bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});
