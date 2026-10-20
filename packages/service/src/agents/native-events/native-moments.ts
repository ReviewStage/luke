import type { BrainRunUsage, ToolCallSettlement } from "@luke/features/brain";
import type { UnparsedWireValue } from "@luke/wire";

/**
 * native-moments.ts -- what a native harness's run amounts to for the transcript, said once for every harness.
 *
 * A runner posts its harness's own messages: Claude Code's SDK messages now
 * (`claude-code-moments.ts`), Codex's app-server notifications later. Each
 * harness's reader turns its messages into these moments, and the one
 * projection (`native-projection.ts`) folds the moments into the store
 * writer's events, so a second harness adds a reader and nothing else.
 * A moment says what happened, never what to write: the projection decides
 * when a turn opens, which step words belong to, and when a sentence is
 * finished enough to tell.
 */

export const NATIVE_MOMENT = {
  /** A line Luke wrote was handed to the harness: the awaiting row written under this client id is the turn's. */
  LINE_ACCEPTED: "line_accepted",
  /** The harness named its own session or thread, which a relaunch resumes. */
  SESSION: "session",
  /** The harness is at work: a turn opens here where none is open. */
  ACTIVE: "active",
  /** A model call answered: what follows belongs to its step. `key` is the harness's own id for the call's answer, where it names one. */
  STEP: "step",
  /** The step's model call is over, its calls answered: the next words open another step. */
  STEP_CLOSED: "step_closed",
  /** A piece of the step's words, still forming. */
  TEXT_DELTA: "text_delta",
  /** One whole run of the step's words, which the pieces before it formed. */
  TEXT: "text",
  /** One reasoning summary of the step. */
  REASONING: "reasoning",
  /** The model asked for a tool, under the name the transcript stores. */
  TOOL_STARTED: "tool_started",
  /** A tool answered. */
  TOOL_SETTLED: "tool_settled",
  /** What a model turn of the harness cost. */
  USAGE: "usage",
  /** A model turn of the harness ended, failed where `failure` says why. */
  RESULT: "result",
  /** The harness folded its context. */
  COMPACTED: "compacted",
  /** The plan's limit refused the harness, until when where it says; `refused` false is the limit lifting. */
  RATE_LIMIT: "rate_limit",
  /** The model turn ended with work still in flight: the turn is waiting, not over. */
  WAITING: "waiting",
  /** The launch ended: the turn under way is over, as `ending` says. */
  ENDED: "ended",
} as const;

/** How a launch ended, as the turn row keeps it. */
export const NATIVE_ENDING = {
  /** The work is done. */
  DONE: "done",
  /** Luke's Stop ended it. */
  STOPPED: "stopped",
  /** The harness or its runner failed, or stopped short of the end. */
  FAILED: "failed",
} as const;
type NativeEnding = (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING];

export type NativeMoment =
  | { readonly kind: typeof NATIVE_MOMENT.LINE_ACCEPTED; readonly clientId: string }
  | { readonly kind: typeof NATIVE_MOMENT.SESSION; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_MOMENT.ACTIVE }
  | { readonly kind: typeof NATIVE_MOMENT.STEP; readonly key?: string }
  | { readonly kind: typeof NATIVE_MOMENT.STEP_CLOSED }
  | { readonly kind: typeof NATIVE_MOMENT.TEXT_DELTA; readonly text: string }
  | { readonly kind: typeof NATIVE_MOMENT.TEXT; readonly text: string }
  | { readonly kind: typeof NATIVE_MOMENT.REASONING; readonly text: string }
  | {
      readonly kind: typeof NATIVE_MOMENT.TOOL_STARTED;
      readonly callId: string;
      readonly name: string;
      readonly input: UnparsedWireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.TOOL_SETTLED;
      readonly callId: string;
      readonly settlement: ToolCallSettlement;
    }
  | { readonly kind: typeof NATIVE_MOMENT.USAGE; readonly usage: BrainRunUsage }
  | { readonly kind: typeof NATIVE_MOMENT.RESULT; readonly failure?: string }
  | { readonly kind: typeof NATIVE_MOMENT.COMPACTED }
  | {
      readonly kind: typeof NATIVE_MOMENT.RATE_LIMIT;
      readonly refused: boolean;
      /** Which limit and when it resets, in the harness's own words, kept for the turn's failure. */
      readonly detail: string;
    }
  | { readonly kind: typeof NATIVE_MOMENT.WAITING }
  | {
      readonly kind: typeof NATIVE_MOMENT.ENDED;
      readonly ending: NativeEnding;
      readonly detail?: string;
    };
