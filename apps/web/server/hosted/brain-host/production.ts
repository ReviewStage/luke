import { BRAIN_OPENAI_DEFAULTS } from "@sidecar/brain";
import { Effect, type Redacted } from "effect";
import { auth } from "../../auth.js";
import { unparsedWire, type WireBoundaryInput } from "../../core.js";
import type { WebStoreRun } from "../../runtime.js";
import { oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "../bearer.js";
import { HOSTED_TOOL_SET } from "../brain-tool-set.js";
import { HostedEnvironment } from "../environment.js";
import { type HostedSpend, spendHostedMeter } from "../quota.js";
import { type StoreWriter, storeWriter } from "../store/index.js";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_MODEL_FIXTURE } from "./bounds.js";
import { conversationOwnedBy, runtimeSessionOwner } from "./conversation.js";
import type { SessionOwnership } from "./door.js";
import { deploymentEveOrigin } from "./eve-origin.js";

/**
 * The deployment's real seams behind the eve project's authored files, built
 * over `HostedEnvironment` so every secret is read once, as the environment
 * is, and travels sealed: the bearer's account through the auth service's
 * own userinfo, the writer over the hosted tool set, Luke's own OpenAI key
 * and model, and the daily meter. The writer is built on first use and kept
 * for the instance, so the agent's discovery, which imports the authored
 * files, touches no database. An authored file hands what it needs here and
 * nothing else.
 */

interface OpenAiAccess {
  /** Sealed until the SDK client is built. */
  readonly apiKey: Redacted.Redacted;
  readonly modelId: string;
}

export interface BrainHostSeams {
  /** The writer over the hosted tool set, composed once per instance; its composition probes every declared schema. */
  readonly writer: () => Effect.Effect<StoreWriter>;
  readonly userInfo: UserInfoEndpoint;
  /** Who a session or a conversation belongs to, for the door. */
  readonly ownership: SessionOwnership;
  /** The secret the deployment acts for an account under at eve's door, sealed; nothing while the environment names none. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
  /** The origin eve answers on from inside its own service, or nothing where the deployment names none. */
  readonly eveOrigin: () => string | undefined;
  /** Luke's own OpenAI access, or nothing when the deployment holds no key and the hosted brain is off. */
  readonly openAi: () => OpenAiAccess | undefined;
  /** Whether the deployment asked for the scripted fixture model in place of OpenAI. */
  readonly scriptedModel: () => boolean;
  readonly spend: (userId: string) => Promise<HostedSpend>;
  readonly now: () => number;
}

/**
 * The deployment's seams, built over the runner the edge composing them hands
 * in and the environment service the edge provides. `ownership` and `spend`
 * answer promises because what reads them does: eve's own door takes a
 * promise-shaped ownership, and the AI SDK's model middleware takes a
 * promise-shaped meter. Neither has a request fiber to compose into, so the
 * authored eve file that builds these seams hands its own `runWeb` down
 * rather than this module keeping a runner of its own.
 */
export const productionBrainHostSeams = /* @__PURE__ */ Effect.fn("web/productionBrainHostSeams")(
  function* (run: WebStoreRun): Effect.fn.Return<BrainHostSeams, never, HostedEnvironment> {
    const environment = yield* HostedEnvironment;
    // Composed on its first use and kept for the instance: the writer's
    // composition probes every declared output schema, so a warm instance pays
    // that walk once rather than once per request.
    const writer = yield* Effect.cached(storeWriter({ tools: HOSTED_TOOL_SET }));
    return {
      writer: () => writer,
      ownership: {
        sessionOwner: (sessionId) => run(runtimeSessionOwner(sessionId)),
        ownsConversation: (userId, conversationId) =>
          run(conversationOwnedBy(userId, conversationId)),
      },
      deploymentSecret: () => environment.cronSecret,
      eveOrigin: deploymentEveOrigin,
      userInfo: (input) =>
        Effect.tryPromise(async () => {
          // SAFETY: the auth service answers JSON; the read below is what holds it to the userinfo shape.
          const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
          return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
        }),
      openAi: () =>
        environment.openAiKey === undefined
          ? undefined
          : {
              apiKey: environment.openAiKey,
              modelId: BRAIN_OPENAI_DEFAULTS.MODEL,
            },
      scriptedModel: () =>
        process.env[BRAIN_HOST_ENVIRONMENT.MODEL_FIXTURE] === BRAIN_HOST_MODEL_FIXTURE.SCRIPTED,
      spend: (userId) => run(spendHostedMeter({ userId, now: Date.now() })),
      now: () => Date.now(),
    };
  },
);
