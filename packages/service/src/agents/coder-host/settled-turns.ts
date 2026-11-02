/**
 * settled-turns.ts -- what hears of each coding agent turn the store writer settles, wherever it was settled: the deployment's count of it, and the report to the agent's starter.
 *
 * The writer tells its `SettledTurnListener` once the settle's transaction
 * is done (`@luke/database/models/writer`), whichever path settled the turn:
 * the relay's or a runner's own end, a Stop, a lost session's, or the
 * sweep's abandon. This is the one listener the deployment provides
 * (`../../runtime.ts`), and it does two things with each turn: counts it
 * (`../../events/server-events.ts`) and hands its final message to the agent
 * that started it, where one did (`starter-report.ts`). Both run once the
 * request has answered, where the runtime runs work past the answer, since
 * neither is the settle's to wait on; and the report runs on the pool
 * rather than on a transaction the settle may have run inside, which has
 * ended by then, so its reads see the settle committed and its send holds
 * no transaction open over eve.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { type SettledAgentTurn, SettledTurnListener } from "@luke/database/models/writer";
import { Context, Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import type { HostedEnvironment } from "../../environment.js";
import { turnEndCounted } from "../../events/server-events.js";
import type { GitHubApp } from "../../github/github-app.js";
import { afterResponse } from "../../http/after-response.js";
import { deploymentEveForAccounts } from "../deployment-eve.js";
import { deploymentEveOrigin } from "../eve-host/eve-origin.js";
import { EVE_MOUNT, type EveTypedTurn } from "../eve-host/eve-sessions.js";
import { reportToStarter } from "./starter-report.js";

/** The work run on the pool rather than on a transaction the settle ran inside, which has ended by the time the answer has left. */
const outsideTransaction = <A, E>(
  work: Effect.Effect<A, E, DatabaseServices>,
): Effect.Effect<A, E, DatabaseServices> =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    Effect.updateContext(work, (context: Context.Context<DatabaseServices>) =>
      Context.omit(client.transactionService)(context),
    ),
  );

/**
 * The deployment's listener over the services the report sends through,
 * read once as the layer is built: eve as the deployment acting for the
 * agent's account, and GitHub, which a send to an agent on a repository
 * asks whether its starter still reaches it.
 */
export const settledTurnListener: Layer.Layer<
  SettledTurnListener,
  never,
  HttpClient.HttpClient | GitHubApp | HostedEnvironment
> = Layer.effect(
  SettledTurnListener,
  Effect.gen(function* () {
    const reach = yield* Effect.context<HttpClient.HttpClient | GitHubApp | HostedEnvironment>();
    const reported = (turn: SettledAgentTurn) =>
      afterResponse(
        "a started agent's final message",
        Effect.flatMap(
          deploymentEveForAccounts<EveTypedTurn>(deploymentEveOrigin(), EVE_MOUNT.CODER),
          (eveFor) => reportToStarter(eveFor, turn),
        ).pipe(Effect.provideContext(reach), outsideTransaction),
      );
    return {
      heard: (turn) => Effect.all([turnEndCounted(turn), reported(turn)], { discard: true }),
    };
  }),
);
