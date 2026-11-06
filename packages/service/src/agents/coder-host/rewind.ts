import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import {
  REWIND_REFUSAL,
  readRewindable,
  rewindConversation,
} from "@repo/database/models/conversation-rewind";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { harnessOf } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";

const REFUSAL_OF_REWIND = {
  [REWIND_REFUSAL.NOT_FOUND]: HOSTED_REFUSAL.NOT_FOUND,
  [REWIND_REFUSAL.INSIDE_TURN]: HOSTED_REFUSAL.INVALID_REQUEST,
  [REWIND_REFUSAL.BUSY]: HOSTED_REFUSAL.UNAVAILABLE,
} as const;

const stoppedForRewind = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  yield* hostedStoreOrUnavailable(replaceAgentWakeups(agent.id, []));
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return;
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(agent.userId, agent.id));
  const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
  if (runtime === undefined) return;
  if (!(yield* runnerHalted(agent, runtime, sessionId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
});

export const rewoundAgent = /* @__PURE__ */ Effect.fn("web/rewoundAgent")(function* (
  account: string,
  agent: Agent,
  messageId: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const rewindable = yield* hostedStoreOrUnavailable(readRewindable(target, messageId));
  if (Result.isFailure(rewindable)) {
    return yield* Effect.fail(REFUSAL_OF_REWIND[rewindable.failure]);
  }
  yield* stoppedForRewind(agent);
  const cut = yield* hostedStoreOrUnavailable(rewindConversation(target, messageId));
  if (Result.isFailure(cut)) return yield* Effect.fail(REFUSAL_OF_REWIND[cut.failure]);
  yield* stoppedForRewind(agent).pipe(
    Effect.catch((refusal) =>
      Effect.logWarning(`a rewound agent was not stopped again: ${refusal.error}`),
    ),
  );
});
