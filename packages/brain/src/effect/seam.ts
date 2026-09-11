/**
 * `AgentSeam` restated as a service, for a caller that reaches for it through
 * `Effect`'s environment rather than a constructor argument. `../seam.ts`'s
 * interface is untouched, and so is every collaborator that still takes it
 * that way — `Maintenance`, `TurnRunner`, `WakeCapture`, `ChildRuns`, and
 * `AskLedger` — so this is a second door onto the same value, not a
 * replacement for the first.
 *
 * It is one tag, not one per member, because the seam is not a bag of
 * independent services a `Layer` could each supply on its own: `ledger` is
 * one `BrainRequestLedger` built over this conversation's own store and
 * lease, and `generation`, `stopped`, `ready`, `expireIfDue`,
 * `reportIncompatible`, `runRevoked`, `queueTurn`, and `enqueue` all close
 * over the same `BrainAgent`'s own private state. None of the eleven
 * members has a lifetime of its own apart from the agent that built it, so
 * splitting them would only add tags a caller could never provide
 * separately from the others.
 *
 * `agentSeamLayer` is a strangler shim: P5-14b deletes it once the agent's
 * own collaborators read the tag from their environment instead of taking
 * the plain object as a constructor argument.
 */
import { Context, Layer } from "effect";
import type { AgentSeam } from "../seam.js";

export class AgentSeamTag extends Context.Tag("@sidecar/brain/AgentSeam")<
  AgentSeamTag,
  AgentSeam
>() {}

/** @deprecated Wraps the existing seam object as a `Layer`; P5-14b deletes it with the constructor argument it stands in for. */
export const agentSeamLayer = (seam: AgentSeam): Layer.Layer<AgentSeamTag> =>
  Layer.succeed(AgentSeamTag, seam);
