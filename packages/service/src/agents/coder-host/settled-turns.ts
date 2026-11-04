/**
 * settled-turns.ts -- what hears of each coding agent turn the store writer settles, wherever it was settled: the deployment's count of it, the report to the agent's starter, and the turn on Slack, an automation run's result or a reply in its agent's thread.
 *
 * The writer tells its `SettledTurnListener` once the settle's transaction
 * is done (`@repo/database/models/writer`), whichever path settled the turn:
 * the relay's or a runner's own end, a Stop, a lost session's, or the
 * sweep's abandon. This is the one listener the deployment provides
 * (`../../runtime.ts`), and it does three things with each turn: counts it
 * (`../../events/server-events.ts`), hands its final message to the agent
 * that started it, where one did (`starter-report.ts`), and posts it on
 * Slack, as a DM of an automation run's result to its owner where the run's
 * automation asks for it, or else in the agent's current Slack thread,
 * where one speaks for it (`../../slack/slack-agent-starts.ts`). Each runs
 * once the request has answered, where the runtime runs work past the
 * answer, since none is the settle's to wait on; and the report and the
 * Slack message run on the pool rather than on a transaction the settle may
 * have run inside, so their sends hold no transaction open over eve or
 * Slack. Note that the work may start before such a transaction commits, so
 * a caller that runs the writer inside its own tells this listener only once
 * it has (`../native-events/runner-events-app.ts`), and the reads here see
 * the settle committed.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type SettledAgentTurn, SettledTurnListener } from "@repo/database/models/writer";
import { Context, Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import type { HostedEnvironment } from "../../environment.js";
import { turnEndCounted } from "../../events/server-events.js";
import type { GitHubApp } from "../../github/github-app.js";
import { afterResponse } from "../../http/after-response.js";
import { postTurnToSlack } from "../../slack/slack-agent-starts.js";
import type { SlackBot } from "../../slack/slack-bot.js";
import { routedSessions } from "./runtime-sessions.js";
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
 * agent's account, GitHub, which a send to an agent on a repository asks
 * whether its starter still reaches it, and the workspace's Slack bot.
 */
export const settledTurnListener: Layer.Layer<
  SettledTurnListener,
  never,
  HttpClient.HttpClient | GitHubApp | HostedEnvironment | SlackBot
> = Layer.effect(
  SettledTurnListener,
  Effect.gen(function* () {
    const reach = yield* Effect.context<
      HttpClient.HttpClient | GitHubApp | HostedEnvironment | SlackBot
    >();
    const reported = (turn: SettledAgentTurn) =>
      afterResponse(
        "a started agent's final message",
        reportToStarter(routedSessions, turn).pipe(
          Effect.provideContext(reach),
          outsideTransaction,
        ),
      );
    const posted = (turn: SettledAgentTurn) =>
      afterResponse(
        "an agent's turn on Slack",
        postTurnToSlack(turn).pipe(Effect.provideContext(reach), outsideTransaction),
      );
    return {
      heard: (turn) =>
        Effect.all([turnEndCounted(turn), reported(turn), posted(turn)], { discard: true }),
    };
  }),
);
