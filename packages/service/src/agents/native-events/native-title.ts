import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { failureKind } from "@repo/runtime/effect";
import { Effect } from "effect";
import type { HostedEnvironment } from "../../environment.js";
import { deploymentTitleModel } from "../coder-host/model.js";
import { titleAgent } from "../coder-host/title.js";

/**
 * native-title.ts -- a native agent's title, asked for as its runner's turns start and end, as eve's relay asks for an eve agent's.
 *
 * The title is generated on our own key
 * (`../coder-host/model.ts`'s `deploymentTitleModel`), whatever key the
 * account saved or none, and named where none stands
 * (`../coder-host/title.ts`), its untitled task with it. A deployment
 * holding no such key titles it from its opening's first words with no
 * model call; the account's own key never pays for one. Nothing here fails
 * the batch: a title not written is said in the log and asked for again at
 * the next turn's start or end.
 */

/** The agent's title asked for, where none stands. */
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
