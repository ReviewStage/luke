import type { DatabaseServices } from "@luke/database/core/query";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { failureKind } from "@luke/runtime/effect";
import { Effect } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { ownKeyOf } from "../coder-host/account-keys.js";
import { titleModel } from "../coder-host/model.js";
import { titleCodingAgent } from "../coder-host/title.js";

/**
 * native-title.ts -- a native agent's title, asked for as its runner's turns start and end, as eve's relay asks for an eve agent's.
 *
 * The title is generated on the account's own API key, as an eve agent's is
 * (`../coder-host/production.ts`'s `titleModel`), preferring the provider of
 * the agent's own model, and named where none stands
 * (`../coder-host/title.ts`), its untitled task with it. An account that
 * saved no API key, as one on a subscription alone, is titled from its
 * opening's first words with no model call. Luke's own key never pays for
 * one. Nothing here fails the batch: a title not written is said in the log
 * and asked for again at the next turn's start or end.
 */

/** The agent's title asked for, where none stands. */
export function titleNativeAgent(
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<void, never, DatabaseServices | HostedEnvironment> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const environment = yield* HostedEnvironment;
    const preferred = providerModelOf(agent.model)?.provider ?? MODEL_PROVIDER.ANTHROPIC;
    yield* ownKeyOf(target.userId, preferred, environment.providerKeyEncryptionKeys).pipe(
      Effect.flatMap((own) =>
        titleCodingAgent(own === undefined ? undefined : titleModel(own), target, agent),
      ),
      Effect.catch((failure) =>
        Effect.logWarning(`The agent's title was not written: ${failureKind(failure)}`),
      ),
    );
  });
}
