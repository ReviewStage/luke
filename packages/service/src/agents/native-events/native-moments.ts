import type { BrainRunUsage, ToolCallSettlement } from "@luke/features/brain";
import { PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import type { UnparsedWireValue, WireValue } from "@luke/wire";

/**
 * native-moments.ts -- what a native harness's run amounts to for the transcript, said once for every harness.
 *
 * A runner posts its harness's own messages: Claude Code's SDK messages
 * (`claude-code-moments.ts`) or Codex's app-server notifications
 * (`codex-moments.ts`). Each
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
  /**
   * A subagent call answered that its subagent runs on in the background:
   * the call stays open, as a delegation's row runs, until `SUBAGENT_ENDED`
   * names the same key. `key` is what the harness names the subagent's end
   * by: the call's own id on Claude Code, the child thread's on Codex.
   */
  SUBAGENT_RUNNING: "subagent_running",
  /** A subagent that runs in the background ended: the call it runs under settles. */
  SUBAGENT_ENDED: "subagent_ended",
  /** What a model turn of the harness cost. */
  USAGE: "usage",
  /**
   * What the harness's session has cost in all, for a harness that reports
   * its running total rather than each call's (Codex): the turn is metered
   * what the total grew by since last metered, and a total reported again,
   * as a resumed thread reports it, meters nothing.
   */
  USAGE_TOTAL: "usage_total",
  /** A model turn of the harness ended, failed where `failure` says why. */
  RESULT: "result",
  /** The harness folded its context. */
  COMPACTED: "compacted",
  /** The plan's limit refused the harness, until when where it says; `refused` false is the limit lifting. */
  RATE_LIMIT: "rate_limit",
  /**
   * How the provider answered a model turn on the plan that pays for the
   * agent: it ran, or it refused the sign-in, the plan's limit, or the
   * account. Its row takes it where the agent runs on a plan.
   */
  PLAN: "plan",
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

/** How a turn found the plan, as its row keeps it (`setPlanStatus`). */
export const PLAN_STATUS = {
  VERIFIED: PROVIDER_KEY_STATUS.VERIFIED,
  INVALID: PROVIDER_KEY_STATUS.INVALID,
  LIMIT_REACHED: PROVIDER_KEY_STATUS.LIMIT_REACHED,
  INELIGIBLE: PROVIDER_KEY_STATUS.INELIGIBLE,
} as const;
export type PlanStatus = (typeof PLAN_STATUS)[keyof typeof PLAN_STATUS];

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
      /** The call's input as it stood when it answered, for a harness that fills it in after the start (Codex); it replaces the started one. */
      readonly input?: UnparsedWireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.SUBAGENT_RUNNING;
      readonly callId: string;
      readonly key: string;
      /** The call's input as it stood when it answered, for a harness that fills it in after the start (Codex); the call settles with it. */
      readonly input?: WireValue;
    }
  | {
      readonly kind: typeof NATIVE_MOMENT.SUBAGENT_ENDED;
      readonly key: string;
      readonly settlement: ToolCallSettlement;
    }
  | { readonly kind: typeof NATIVE_MOMENT.USAGE; readonly usage: BrainRunUsage }
  | { readonly kind: typeof NATIVE_MOMENT.USAGE_TOTAL; readonly total: BrainRunUsage }
  | { readonly kind: typeof NATIVE_MOMENT.RESULT; readonly failure?: string }
  | { readonly kind: typeof NATIVE_MOMENT.COMPACTED }
  | {
      readonly kind: typeof NATIVE_MOMENT.RATE_LIMIT;
      readonly refused: boolean;
      /** Which limit and when it resets, in the harness's own words, kept for the turn's failure. */
      readonly detail: string;
      /** When the limit resets, in epoch milliseconds, where the harness said. */
      readonly resetsAt?: number;
    }
  | { readonly kind: typeof NATIVE_MOMENT.PLAN; readonly status: PlanStatus }
  | { readonly kind: typeof NATIVE_MOMENT.WAITING }
  | {
      readonly kind: typeof NATIVE_MOMENT.ENDED;
      readonly ending: NativeEnding;
      readonly detail?: string;
      /**
       * The wakeups the agent is left to be delivered, each due in epoch
       * milliseconds, which replace those it had: what a released wait named,
       * or none for a Stop, which ends the CLI's own wakeups with it. Absent
       * for any other end, which leaves them as they stood.
       */
      readonly wakeups?: readonly NativeWakeup[];
    };

/** A wakeup Luke delivers to a native agent as a message once it comes due. */
export interface NativeWakeup {
  readonly at: number;
  readonly prompt: string;
}

/**
 * What a reader may know of the projection as it reads one event: the
 * calls it holds by name, the harness's session as last recorded, and the
 * event's own number, which names what the harness names nothing for.
 */
export interface NativeHeld {
  /** The name a held call is stored under, by its id; nothing for a call the projection does not hold. */
  readonly callName: (callId: string) => string | undefined;
  readonly session: string | undefined;
  readonly sequence: number;
}
