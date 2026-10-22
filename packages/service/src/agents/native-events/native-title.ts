import type { DatabaseServices } from "@luke/database/core/query";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { spendHostedMeter } from "@luke/database/models/quota";
import type { ConversationTarget } from "@luke/database/models/writer";
import { failureKind } from "@luke/runtime/effect";
import { Clock, Effect } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { titleModel } from "../coder-host/model.js";
import { titleCodingAgent } from "../coder-host/title.js";

/**
 * native-title.ts -- a native agent's title, asked for as its runner's turns start and end, as eve's relay asks for an eve agent's.
 *
 * The title is generated on Luke's key, as eve's is (`../coder-host/production.ts`'s
 * `titleModel`), and named where none stands (`../coder-host/title.ts`), its
 * untitled task with it. The model's meter counts each call the title made
 * once the title is written, on the request's own database, because the
 * route holds no runner a promise-shaped meter could count on as it calls.
 * Nothing here fails the batch: a title not written is said in the log and
 * asked for again at the next turn's start or end.
 */

/** Counts each use as the account's hosted use, a count that failed said in the log. */
function countUses(userId: string, uses: number): Effect.Effect<void, never, DatabaseServices> {
  return Effect.gen(function* () {
    for (let use = 0; use < uses; use += 1) {
      const now = yield* Clock.currentTimeMillis;
      yield* spendHostedMeter({ userId, now }).pipe(
        Effect.asVoid,
        Effect.catch((failure) =>
          Effect.logWarning(`A hosted inference was not counted: ${failureKind(failure)}`),
        ),
      );
    }
  });
}

/** The agent's title asked for, where none stands and the deployment holds Luke's Anthropic key. */
export function titleNativeAgent(
  target: ConversationTarget,
  agent: CodingAgent,
): Effect.Effect<void, never, DatabaseServices | HostedEnvironment> {
  return Effect.gen(function* () {
    if (agent.title !== null) return;
    const environment = yield* HostedEnvironment;
    let uses = 0;
    const model = titleModel(
      { anthropic: environment.anthropicKey, openAi: environment.openAiKey },
      {
        spend: async () => {
          uses += 1;
        },
        report: () => undefined,
      },
    );
    if (model === undefined) return;
    yield* titleCodingAgent(model, target, agent).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(`The agent's title was not written: ${failure._tag}`),
      ),
    );
    yield* countUses(target.userId, uses);
  });
}
