// deployment-eve.ts -- eve as the deployment reaches it acting for an account, under its own secret.
import type { DatabaseServices } from "@luke/database/core/query";
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import type { BrainHostTurn } from "./brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_MOUNT,
  type EveMount,
  eveSessionsComposer,
} from "./brain-host/eve-sessions.js";
import { sessionsRouter } from "./coder-host/runtime-sessions.js";

/**
 * The web functions that reach eve, over the web runtime's own
 * `HttpClient`, for an account whose bearer they do not hold compose the
 * deployment's caller here: a cookie request's `eveFor`
 * (`coder-host/stop.ts`), a GitHub wake (`github-webhook-app.ts`), and an
 * automation's run (`maintenance-app.ts`). The caller is the deployment's
 * own secret at eve's door, `HostedEnvironment.eveDeploymentSecret` (read as
 * unset where it is blank or the cron's own value, `environment.ts`),
 * beside the account; the door's deployment actor admits it only for what
 * its table allows and only on what that account reaches
 * (`brain-host/auth.ts`). So none of them reaches for another secret, and a
 * deployment holding none, or no environment at all, or no origin for eve,
 * reaches eve for nobody.
 *
 * The voice function is the one caller that composes its own: its exchange
 * stands for a function instance's life outside any request, over an
 * `HttpClient` of its own, so it reads the same secret by the same rule
 * from its environment (`eveDeploymentSecretIn`) and composes eve's client
 * in `voice/deployment-exchange.ts`.
 */

/**
 * eve as the deployment reaches it for each account, on the origin and
 * mount given, sending the kinds of turn `Turn` names and none unless a
 * caller names one; unavailable where no secret or no origin stands. Note
 * that the environment is read once, here, so a composer handed on to a
 * fiber whose context holds none still carries the secret it was made with.
 */
export function deploymentEve<Turn extends BrainHostTurn = never>(
  origin: string | undefined,
  mount: EveMount,
): Effect.Effect<
  (account: string) => AgentSessions<Turn>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
> {
  return Effect.gen(function* () {
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    const secret = Option.getOrUndefined(environment)?.eveDeploymentSecret;
    if (secret === undefined || origin === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const compose = yield* eveSessionsComposer;
    // A coding agent's session is answered by the runtime its conversation runs on (`coder-host/runtime-sessions.ts`).
    const route = yield* sessionsRouter;
    return (account: string) => {
      const eve = compose<Turn>({ origin, caller: { secret, account }, mount });
      return mount === EVE_MOUNT.CODER ? route(eve, account) : eve;
    };
  });
}

/**
 * `deploymentEve` for a pass that acts for many accounts, a GitHub
 * delivery's wakes or the sweep's automation runs: each account is answered
 * its own eve, or the refusal on its own, so a deployment that cannot reach
 * eve as itself fails each account it acts for rather than the whole pass.
 */
export function deploymentEveForAccounts<Turn extends BrainHostTurn = never>(
  origin: string | undefined,
  mount: EveMount,
): Effect.Effect<
  (account: string) => Effect.Effect<AgentSessions<Turn>, HostedRefusal>,
  never,
  HttpClient.HttpClient | DatabaseServices
> {
  return Effect.map(
    Effect.result(deploymentEve<Turn>(origin, mount)),
    (reached) => (account: string) =>
      Result.isSuccess(reached)
        ? Effect.succeed(reached.success(account))
        : Effect.fail(reached.failure),
  );
}
