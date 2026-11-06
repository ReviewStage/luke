import type { Agent } from "@repo/database/models/agent-store";
import { redactCredentials } from "@repo/features/credential-redaction";
import type { TurnFailure } from "@repo/features/turn-run";
import { Cause, Data, Effect, ErrorReporter, References } from "effect";

const AGENT_FAILURE_CHARS = 300;

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

export function runningLogId(running: string): Readonly<Record<string, string>> {
  return { sandboxSessionId: running };
}

export function keptFailureWords(words: string): string {
  return redactCredentials(words).slice(0, AGENT_FAILURE_CHARS);
}

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
