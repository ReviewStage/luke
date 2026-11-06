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

const outsideTransaction = <A, E>(
  work: Effect.Effect<A, E, DatabaseServices>,
): Effect.Effect<A, E, DatabaseServices> =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    Effect.updateContext(work, (context: Context.Context<DatabaseServices>) =>
      Context.omit(client.transactionService)(context),
    ),
  );

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
