/**
 * agent-log.ts -- what a coding agent's log lines name it by, and a failure of its Start or launch said once as an error and, where nothing explains it, reported.
 *
 * Every line about a coding agent carries its ids as log annotations, which
 * reach Vercel's logs and Sentry Logs, so a failure is found by the agent's
 * id: `agentId`, `conversationId`, `taskId`, Luke's own session as
 * `sessionId` (its machine's tag, the one handle a session keeps across
 * resumes), and Vercel's running session as `sandboxSessionId`. A failure's
 * line adds `reason`, the failure's own kind, and, where a turn records it,
 * `failure`, the turn's failure as stored, so a search of the log and the
 * database agree. A caller annotates the scope its work runs in once, with
 * the ids it already holds. A line names ids, statuses,
 * codes, and a failure's own words with every credential-shaped run
 * redacted, and never a message's, a plan's, or a model's words.
 *
 * A failure a developer meets is said once as an error, where it is decided.
 * One that no named refusal explains (the sandbox would not open, the launch
 * died or was cut off) is reported through Effect's `ErrorReporter` too,
 * which the deployment's Sentry captures as an issue
 * (`observability/sentry.ts`), the scope's ids, the failure's kind, and the
 * turn's failure as its attributes.
 * The report is named for the failure's kind, which Sentry groups an issue
 * by with its stack, so there is one issue per kind rather than per agent;
 * the failure itself is not handed on, since a store's failure can quote a
 * row. A plan or a key refused on purpose, a limit reached, or a device away
 * is a named outcome, logged and never reported.
 */

import type { Agent } from "@luke/database/models/agent-store";
import { redactCredentials } from "@luke/features/credential-redaction";
import type { TurnFailure } from "@luke/features/turn-run";
import { Cause, Data, Effect, ErrorReporter, References } from "effect";

/** How much of a failure's own words a line or a turn's record keeps, inside the writer's own bound. */
const AGENT_FAILURE_CHARS = 300;

/** The annotations a report of a failure carries as its attributes, of all its line carries: the ids, the failure's kind, and the turn's failure. */
const REPORTED_KEYS = [
  "agentId",
  "conversationId",
  "turnId",
  "taskId",
  "sessionId",
  "sandboxSessionId",
  "reason",
  "failure",
] as const;

/**
 * The ids of a coding agent a line is annotated with, those the caller
 * holds: its own, its conversation's, its task's where it has one, and
 * Luke's session its machine is tagged with.
 */
export function agentLogIds(
  agent: Partial<Pick<Agent, "id" | "conversationId" | "taskId">>,
  sessionId?: string,
): Readonly<Record<string, string>> {
  return {
    ...(agent.id === undefined ? undefined : { agentId: agent.id }),
    ...(agent.conversationId === undefined ? undefined : { conversationId: agent.conversationId }),
    ...(agent.taskId === undefined || agent.taskId === null ? undefined : { taskId: agent.taskId }),
    ...(sessionId === undefined ? undefined : { sessionId }),
  };
}

/** The running session of the agent's machine a line is annotated with: Vercel's own, on a sandbox. */
export function runningLogId(running: string): Readonly<Record<string, string>> {
  return { sandboxSessionId: running };
}

/** A failure's own words as a line or a turn's record may keep them: every credential-shaped run redacted, then cut. */
export function keptFailureWords(words: string): string {
  return redactCredentials(words).slice(0, AGENT_FAILURE_CHARS);
}

/**
 * A coding agent's Start or launch that failed with nothing to explain it,
 * as Sentry's issue names it: named for the failure's kind, which its type
 * groups the issue by, what was said of it as its message, and its line's
 * ids, that kind, and the turn's failure as its attributes.
 */
class AgentStartFailed extends Data.TaggedError("AgentStartFailed")<{
  readonly message: string;
  readonly reason: string;
  readonly annotations: Readonly<Record<string, unknown>>;
}> {
  override readonly name = `AgentStartFailed(${this.reason})`;

  override get [ErrorReporter.attributes]() {
    return this.annotations;
  }
}

/**
 * The failure said once as an error, annotated with its kind (`reason`), and
 * the turn's failure where the caller writes one, beside the scope's ids;
 * and, where `reported`, reported as a Sentry issue of that kind carrying
 * the same annotations.
 */
export function agentFailureSaid(
  said: string,
  reason: string,
  reported: boolean,
  failure?: TurnFailure,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.logError(said);
    if (!reported) return;
    const annotated = yield* References.CurrentLogAnnotations;
    const annotations = Object.fromEntries(
      REPORTED_KEYS.flatMap((key) => (key in annotated ? [[key, annotated[key]]] : [])),
    );
    yield* ErrorReporter.report(
      Cause.fail(new AgentStartFailed({ message: said, reason, annotations })),
    );
  }).pipe(Effect.annotateLogs({ reason, ...(failure === undefined ? undefined : { failure }) }));
}
