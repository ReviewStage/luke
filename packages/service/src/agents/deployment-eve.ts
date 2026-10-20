// deployment-eve.ts -- eve as the deployment reaches it acting for an account, under its own secret.
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import type { BrainHostTurn } from "./brain-host/bounds.js";
import { type EveMount, type EveSessions, eveSessionsComposer } from "./brain-host/eve-sessions.js";

/**
 * Every web function that reaches eve for an account whose bearer it does
 * not hold composes the deployment's caller here and nowhere else: a
 * cookie request's `eveFor` (`coder-host/stop.ts`), a chat notice to an
 * agent's starter (`workspace-chat.ts`), a GitHub wake
 * (`github-webhook-app.ts`), and an automation's run
 * (`maintenance-app.ts`). The caller is the deployment's own secret at
 * eve's door, `HostedEnvironment.eveDeploymentSecret` (read as unset where
 * it is blank or the cron's own value, `environment.ts`), beside the
 * account; the door's deployment actor admits it only for what its table
 * allows and only on what that account reaches (`brain-host/auth.ts`). So no
 * caller reaches for another secret, and a deployment holding none, or no
 * environment at all, or no origin for eve, reaches eve for nobody.
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
): Effect.Effect<(account: string) => EveSessions<Turn>, HostedRefusal, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    const secret = Option.getOrUndefined(environment)?.eveDeploymentSecret;
    if (secret === undefined || origin === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const compose = yield* eveSessionsComposer;
    return (account: string) => compose<Turn>({ origin, caller: { secret, account }, mount });
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
  (account: string) => Effect.Effect<EveSessions<Turn>, HostedRefusal>,
  never,
  HttpClient.HttpClient
> {
  return Effect.map(
    Effect.result(deploymentEve<Turn>(origin, mount)),
    (reached) => (account: string) =>
      Result.isSuccess(reached)
        ? Effect.succeed(reached.success(account))
        : Effect.fail(reached.failure),
  );
}
