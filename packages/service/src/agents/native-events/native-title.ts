import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { failureKind } from "@repo/runtime/effect";
import { Effect } from "effect";
import type { HostedEnvironment } from "../../environment.js";
import { deploymentTitleModel } from "../coder-host/model.js";
import { titleAgent } from "../coder-host/title.js";

export function titleNativeAgent(
  target: ConversationTarget,
  agent: Agent,
): Effect.Effect<void, never, DatabaseServices | HostedEnvironment> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const model = yield* deploymentTitleModel();
    yield* titleAgent(model, target, agent).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(`The agent's title was not written: ${failureKind(failure)}`),
      ),
    );
  });
}
