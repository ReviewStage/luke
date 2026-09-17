import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { EVE_CALLER, type EveSessions, eveSessions } from "../hosted/brain-host/eve-sessions.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import { payloadKeyRing } from "../hosted/encryption.js";
import { storeWriter } from "../hosted/store/index.js";
import { exchangeAttachment } from "./exchange-attachment.js";
import type { ExchangeAttachment, ExchangeReport } from "./live-exchange.js";

/**
 * The exchange attachment as the sessions route passes it: `exchangeAttachment`
 * over the deployment's own seams, composed once per function instance on the
 * first session offered and reused for every session after. The seams are
 * the three the hosted tier already turns on: the payload secret the store's
 * sealed rows open under, the deployment's own secret it acts for an account
 * under at eve's door, and the origin eve answers on. A deployment missing
 * any of the three composes no exchange and the attachment fails, which the
 * service answers as the refusal of every session, since a session with no
 * exchange behind it would have no one to answer its asks: the same kill
 * switch every hosted endpoint keeps, and the same outcome a store that
 * cannot be reached has. Nothing is read from the environment here; the
 * function hands the reads in, and a test hands in its own database and a
 * fake eve behind the same door.
 */

interface DeploymentExchangeSeams {
  /** The secret the store's sealed rows open under; nothing means the hosted tier is off. */
  readonly encryptionSecret: () => string | undefined;
  /** The secret the deployment acts for an account under at eve's door, the tick's own; nothing refuses every session. */
  readonly deploymentSecret: () => string | undefined;
  /** The origin eve answers on; nothing refuses every session. */
  readonly eveOrigin: () => string | undefined;
  /** eve as the deployment reaches it for one account; a test hands in a fake, the function composes the real client below. */
  readonly eve?: (accountId: string) => EveSessions;
  readonly now: () => number;
  /** Where a standing exchange's own reports go, each named with the route and the platform of the session it stood on. */
  readonly report: (report: ExchangeReport) => void;
}

/** The deployment names no secret or origin the exchange could stand under; every session is refused on it. */
class ExchangeUnconfigured extends Error {
  constructor(missing: string) {
    super(`the hosted exchange cannot stand: ${missing} is not configured`);
  }
}

const EXCHANGE_CONFIGURATION = {
  ENCRYPTION_SECRET: "the payload encryption secret",
  DEPLOYMENT_SECRET: "the deployment secret",
  EVE_ORIGIN: "eve's origin",
} as const;

/** The three seams read now, or the first one missing, named. */
function configuredSeams(
  seams: DeploymentExchangeSeams,
): Effect.Effect<
  { encryptionSecret: string; deploymentSecret: string; origin: string },
  ExchangeUnconfigured
> {
  const encryptionSecret = seams.encryptionSecret();
  if (encryptionSecret === undefined) {
    return Effect.fail(new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.ENCRYPTION_SECRET));
  }
  const deploymentSecret = seams.deploymentSecret();
  if (deploymentSecret === undefined) {
    return Effect.fail(new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.DEPLOYMENT_SECRET));
  }
  const origin = seams.eveOrigin();
  if (origin === undefined) {
    return Effect.fail(new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.EVE_ORIGIN));
  }
  return Effect.succeed({ encryptionSecret, deploymentSecret, origin });
}

export function deploymentExchange(seams: DeploymentExchangeSeams): ExchangeAttachment {
  // The composition that stood is kept and one that failed is not, so the
  // next session tries again and a store unreachable for one session does
  // not refuse the instance's every later one.
  let standing: ExchangeAttachment | undefined;

  const compose = Effect.gen(function* () {
    const { encryptionSecret, deploymentSecret, origin } = yield* configuredSeams(seams);
    // The writer's composition probes every declared output schema, so a warm
    // instance pays that walk once rather than once per session.
    const writer = yield* storeWriter({ tools: CATALOG_TOOL_SET });
    return exchangeAttachment({
      context: { keys: payloadKeyRing(encryptionSecret) },
      writer,
      eve:
        seams.eve ??
        ((accountId) =>
          eveSessions({
            origin,
            caller: { kind: EVE_CALLER.DEPLOYMENT, secret: deploymentSecret, account: accountId },
          })),
      // Nobody on the service reads the session's phases: the device reads
      // its own from the frames the relay forwards, and the record is the
      // exchange's own.
      emit: () => undefined,
      now: seams.now,
      createId: () => randomUUID(),
      report: seams.report,
    });
  });

  const composed = Effect.suspend(() =>
    standing === undefined
      ? Effect.tap(compose, (attachment) =>
          Effect.sync(() => {
            standing = attachment;
          }),
        )
      : Effect.succeed(standing),
  );

  return (session) => Effect.flatMap(composed, (attachment) => attachment(session));
}
