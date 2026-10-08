import { randomUUID } from "node:crypto";
import { Data, Effect, type Layer, type Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  type EveSessions,
  type EveSessionsComposer,
  eveSessionsComposer,
} from "../hosted/brain-host/eve-sessions.js";
import { openAiBrainModel } from "../hosted/brain-host/model.js";
import { HOSTED_TOOL_SET } from "../hosted/brain-tool-set.js";
import { storeWriter } from "../hosted/store/index.js";
import { exchangeAttachment } from "./exchange-attachment.js";
import type { ExchangeAttachment } from "./live-exchange.js";
import { PLAN_SCRIBE } from "./plan-scribe.js";

/**
 * The exchange attachment as the voice function passes it: `exchangeAttachment`
 * over the deployment's own seams, composed once per function instance on the
 * first session offered and reused for every session after. The seams are
 * the two the hosted tier already turns on: the deployment's own secret it
 * acts for an account under at eve's door, and the origin eve answers on. A
 * deployment missing either composes no exchange and the attachment fails, which the
 * service answers as the refusal of every session, since a session with no
 * exchange behind it would have no one to answer its asks: the same kill
 * switch every hosted endpoint keeps, and the same outcome a store that
 * cannot be reached has. Nothing is read from the environment here; the
 * function hands the reads in, and a test hands in its own database and a
 * fake eve behind the same door.
 */

interface DeploymentExchangeSeams {
  /** The secret the deployment acts for an account under at eve's door, the cron's own; nothing refuses every session. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
  /** The origin eve answers on; nothing refuses every session. */
  readonly eveOrigin: () => string | undefined;
  /** The deployment's OpenAI key the plan's notetaker runs on; nothing means a call writes no plan. */
  readonly openAiKey: () => Redacted.Redacted | undefined;
  /** eve as the deployment reaches it for one account; a test hands in a fake, the function composes the real client below. */
  readonly eve?: (accountId: string) => EveSessions;
  /**
   * The `HttpClient` eve's client is composed over. The exchange stands inside
   * the voice service, whose effects ask for the store's client alone, so the
   * web runtime's client is not in reach here; absent, the same fetch layer
   * the service's upstream reaches OpenAI through (`openai.ts`) stands.
   */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
  /** Where a standing exchange's own reports go. */
  readonly report: (message: string) => void;
}

/** The deployment names no secret or origin the exchange could stand under; every session is refused on it. */
class ExchangeUnconfigured extends Data.TaggedError("ExchangeUnconfigured")<{
  readonly message: string;
}> {}

/** The refusal for one missing configuration value, worded for the deployment's log. */
function exchangeUnconfigured(missing: string): ExchangeUnconfigured {
  return new ExchangeUnconfigured({
    message: `the hosted exchange cannot stand: ${missing} is not configured`,
  });
}

const EXCHANGE_CONFIGURATION = {
  DEPLOYMENT_SECRET: "the deployment secret",
  EVE_ORIGIN: "eve's origin",
} as const;

/** The two seams read now, or the first one missing, named. */
function configuredSeams(
  seams: DeploymentExchangeSeams,
): Effect.Effect<{ deploymentSecret: Redacted.Redacted; origin: string }, ExchangeUnconfigured> {
  const deploymentSecret = seams.deploymentSecret();
  if (deploymentSecret === undefined) {
    return Effect.fail(exchangeUnconfigured(EXCHANGE_CONFIGURATION.DEPLOYMENT_SECRET));
  }
  const origin = seams.eveOrigin();
  if (origin === undefined) {
    return Effect.fail(exchangeUnconfigured(EXCHANGE_CONFIGURATION.EVE_ORIGIN));
  }
  return Effect.succeed({ deploymentSecret, origin });
}

/** eve as the deployment reaches it for one account, under the deployment's own secret on the origin eve answers on. */
function deploymentEve(
  compose: EveSessionsComposer,
  origin: string,
  deploymentSecret: Redacted.Redacted,
): (accountId: string) => EveSessions {
  return (accountId) =>
    compose({
      origin,
      caller: { secret: deploymentSecret, account: accountId },
    });
}

export function deploymentExchange(seams: DeploymentExchangeSeams): ExchangeAttachment {
  // The composition that stood is kept and one that failed is not, so the
  // next session tries again and a store unreachable for one session does
  // not refuse the instance's every later one.
  let standing: ExchangeAttachment | undefined;

  const compose = Effect.gen(function* () {
    const { deploymentSecret, origin } = yield* configuredSeams(seams);
    // The writer's composition probes every declared output schema, so a warm
    // instance pays that walk once rather than once per session.
    // A call writes into a plan conversation, whose rows name the planning
    // tools, so the writer holds rows to the hosted set as the brain's does.
    const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
    // eve's client is composed once per instance too, over the client the seam names; a test's
    // fake eve stands in its place and composes none.
    const eve =
      seams.eve ??
      deploymentEve(
        yield* Effect.provide(eveSessionsComposer, seams.httpClient ?? FetchHttpClient.layer),
        origin,
        deploymentSecret,
      );
    return exchangeAttachment({
      writer,
      eve,
      scribeModel: () => {
        const key = seams.openAiKey();
        return key === undefined ? undefined : openAiBrainModel(key, PLAN_SCRIBE.MODEL);
      },
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
