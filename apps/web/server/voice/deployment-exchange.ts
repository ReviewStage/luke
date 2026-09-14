import { randomUUID } from "node:crypto";
import { EVE_CALLER, type EveSessions, eveSessions } from "../hosted/brain-host/eve-sessions.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import { payloadKeyRing } from "../hosted/encryption.js";
import { storeWriter } from "../hosted/store/index.js";
import type { WebStoreRun } from "../runtime.js";
import { exchangeAttachment } from "./exchange-attachment.js";
import type { ExchangeAttachment, ExchangeReport } from "./live-exchange.js";

/**
 * The exchange attachment as the sessions route passes it: `exchangeAttachment`
 * over the deployment's own seams, composed once per function instance on the
 * first session offered and reused for every session after. The seams are
 * the three the hosted tier already turns on: the payload secret the store's
 * sealed rows open under, the deployment's own secret it acts for an account
 * under at eve's door, and the origin eve answers on. A deployment missing
 * any of the three composes no exchange and the attachment throws, which the
 * service answers as the refusal of every session, since a session with no
 * exchange behind it would have no one to answer its asks: the same kill
 * switch every hosted endpoint keeps, and the same outcome a store that
 * cannot be reached has. Nothing is read from the environment here; the
 * function hands the reads in, and a test hands in its own database and a
 * fake eve behind the same door.
 */

export interface DeploymentExchangeSeams {
  /** The edge's own runner, over which the writer is composed and every effect of the exchange is answered. */
  readonly run: WebStoreRun;
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

export function deploymentExchange(seams: DeploymentExchangeSeams): ExchangeAttachment {
  let composed: Promise<ExchangeAttachment> | undefined;

  const compose = async (): Promise<ExchangeAttachment> => {
    const encryptionSecret = seams.encryptionSecret();
    if (encryptionSecret === undefined) {
      throw new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.ENCRYPTION_SECRET);
    }
    const deploymentSecret = seams.deploymentSecret();
    if (deploymentSecret === undefined) {
      throw new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.DEPLOYMENT_SECRET);
    }
    const origin = seams.eveOrigin();
    if (origin === undefined) throw new ExchangeUnconfigured(EXCHANGE_CONFIGURATION.EVE_ORIGIN);
    // The writer's composition probes every declared output schema, so a warm
    // instance pays that walk once rather than once per session.
    const writer = await seams.run(storeWriter({ tools: CATALOG_TOOL_SET }));
    return exchangeAttachment({
      context: { keys: payloadKeyRing(encryptionSecret) },
      run: seams.run,
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
  };

  return async (session) => {
    composed ??= compose();
    try {
      return await (await composed)(session);
    } catch (error) {
      // A composition that failed is not kept: the next session tries again,
      // so a store unreachable for one session does not refuse the instance's
      // every later one.
      composed = undefined;
      throw error;
    }
  };
}
