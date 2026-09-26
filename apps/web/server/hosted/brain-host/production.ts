import { BRAIN_OPENAI_DEFAULTS } from "@sidecar/brain";
import { eq } from "drizzle-orm";
import { Effect, Option, type Redacted, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { auth } from "../../auth.js";
import { type CloudAgentProviderId, unparsedWire, type WireBoundaryInput } from "../../core.js";
import { db } from "../../db/query.js";
import { providerKey } from "../../db/vault-schema.js";
import type { WebStoreRun } from "../../runtime.js";
import { executeSessionAction } from "../action-execute.js";
import { oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "../bearer.js";
import { HOSTED_TOOL_SET } from "../brain-tool-set.js";
import { payloadKeyRing } from "../encryption.js";
import { HostedEnvironment } from "../environment.js";
import { GITHUB_ACCESS_WITHOUT_CONNECTIONS, type GitHubAccessShape } from "../github-source.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http-effect.js";
import { type HostedSpend, spendHostedMeter } from "../quota.js";
import { type HostedStore, hostedStore, storeWriter } from "../store/index.js";
import { readApiKeyFor } from "../vault-keys.js";
import type { VaultKeyRow } from "../vault-route.js";
import type { StoreWriter } from "./announce.js";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_MODEL_FIXTURE } from "./bounds.js";
import { conversationOwnedBy, runtimeSessionOwner } from "./conversation.js";
import type { SessionOwnership } from "./door.js";
import { type HostedEmbedder, hostedEmbedder } from "./embedding.js";
import { deploymentEveOrigin } from "./eve-origin.js";
import type { CloudActionExecutor } from "./performer.js";

/**
 * The deployment's real seams behind the eve project's authored files, built
 * over `HostedEnvironment` so every secret is read once, as the environment
 * is, and travels sealed: the bearer's account through the auth service's
 * own userinfo, the stored keys out of the vault table under the vault
 * secret, the store under the payload key ring, the writer over the
 * catalog's tool set, Luke's own OpenAI key and model, the notebook search's
 * embedder on that same key, and the daily meter. The store and the writer
 * are each built on first use and kept for the instance, so the agent's
 * discovery, which imports the authored files, touches no database. An
 * authored file hands what it needs here and nothing else.
 */

/**
 * What a seam over the ambient client answers: an effect the caller composes
 * into whatever it already runs, so the edge serving the request is the one
 * place the client behind it is provided.
 */
type BrainHostEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

interface OpenAiAccess {
  /** Sealed until the SDK client is built. */
  readonly apiKey: Redacted.Redacted;
  readonly modelId: string;
}

export interface BrainHostSeams {
  /** The store under the vault's key ring, composed once per instance; the unavailable refusal while the deployment holds no vault secret. */
  readonly store: () => Effect.Effect<HostedStore, HostedRefusal>;
  /** The writer over the catalog's tool set, composed once per instance; its composition probes every declared schema. */
  readonly writer: () => Effect.Effect<StoreWriter>;
  readonly userInfo: UserInfoEndpoint;
  /** Who a session or a conversation belongs to, for the door. */
  readonly ownership: SessionOwnership;
  /** The secret the deployment acts for an account under at eve's door, the tick's own, sealed; nothing while the environment names none. */
  readonly deploymentSecret: () => Redacted.Redacted | undefined;
  /** The origin eve answers on from inside its own service, or nothing where the deployment names none. */
  readonly eveOrigin: () => string | undefined;
  /** Luke's own OpenAI access, or nothing when the deployment holds no key and the hosted brain is off. */
  readonly openAi: () => OpenAiAccess | undefined;
  /** The notebook search's embedder on the same key, or nothing when the deployment holds none and the search runs keyword-only. */
  readonly embedder: () => HostedEmbedder | undefined;
  /** Whether the deployment asked for the scripted fixture model in place of OpenAI. */
  readonly scriptedModel: () => boolean;
  readonly spend: (userId: string) => Promise<HostedSpend>;
  /** The account's stored provider keys, sealed, as the roster and the actions are admitted under them. */
  readonly vaultRows: (userId: string) => BrainHostEffect<readonly VaultKeyRow[]>;
  /** The secret the vault's rows are sealed under, itself sealed; the unavailable refusal while the deployment holds none. */
  readonly vaultSecret: () => Effect.Effect<Redacted.Redacted, HostedRefusal>;
  /** The account's stored key for a cloud provider, decrypted and sealed; nothing where none is stored or it cannot be opened. */
  readonly providerKey: (
    userId: string,
    providerId: CloudAgentProviderId,
  ) => BrainHostEffect<Redacted.Redacted | undefined>;
  readonly executeAction: CloudActionExecutor;
  /** The account's GitHub credential for the planning model's repository read. */
  readonly githubAccess: GitHubAccessShape;
  readonly now: () => number;
}

/** A stored provider key as the vault holds it, still sealed: the roster and the actions are admitted under these. */
const VaultKeyRowSchema = Schema.Struct({
  providerId: Schema.String,
  ciphertext: Schema.String,
});

const findVaultRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: VaultKeyRowSchema,
  execute: (userId) =>
    db
      .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(eq(providerKey.userId, userId)),
});

/**
 * The deployment's seams, built over the runner the edge composing them hands
 * in and the environment service the edge provides. `ownership` and `spend`
 * answer promises because what reads them does: eve's own door takes a
 * promise-shaped ownership, and the AI SDK's model middleware takes a
 * promise-shaped meter. Neither has a request fiber to compose into, so the
 * authored eve file that builds these seams hands its own `runWeb` down
 * rather than this module keeping a runner of its own. The vault secret's
 * absence is answered as the unavailable refusal wherever a seam needs it,
 * never thrown: a deployment without the vault has no store to read.
 */
export const productionBrainHostSeams = /* @__PURE__ */ Effect.fn("web/productionBrainHostSeams")(
  function* (run: WebStoreRun): Effect.fn.Return<BrainHostSeams, never, HostedEnvironment> {
    const environment = yield* HostedEnvironment;
    const vaultSecret: Effect.Effect<Redacted.Redacted, HostedRefusal> =
      environment.providerKeyEncryptionSecret === undefined
        ? Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)
        : Effect.succeed(environment.providerKeyEncryptionSecret);
    // Each is composed on its first use and kept for the instance: the writer's
    // composition probes every declared output schema, so a warm instance pays
    // that walk once rather than once per request.
    const store = yield* Effect.cached(
      Effect.map(vaultSecret, (secret) => hostedStore({ keys: payloadKeyRing(secret) })),
    );
    const writer = yield* Effect.cached(storeWriter({ tools: HOSTED_TOOL_SET }));
    const vaultRows = (userId: string): BrainHostEffect<readonly VaultKeyRow[]> =>
      findVaultRows(userId);
    return {
      store: () => store,
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
      embedder: () =>
        environment.openAiKey === undefined ? undefined : hostedEmbedder(environment.openAiKey),
      scriptedModel: () =>
        process.env[BRAIN_HOST_ENVIRONMENT.MODEL_FIXTURE] === BRAIN_HOST_MODEL_FIXTURE.SCRIPTED,
      spend: (userId) => run(spendHostedMeter({ userId, now: Date.now() })),
      vaultRows,
      vaultSecret: () => vaultSecret,
      // A row the vault cannot open under a deployment with no secret is a key that is absent.
      providerKey: (userId, providerId) =>
        Effect.flatMap(vaultRows(userId), (rows) =>
          Effect.flatMap(Effect.option(vaultSecret), (secret) =>
            Option.match(secret, {
              onNone: () => Effect.succeed(undefined),
              onSome: (held) => readApiKeyFor(rows, held)(providerId)(),
            }),
          ),
        ),
      executeAction: (input) => executeSessionAction(input),
      // No account holds a GitHub connection until the account-bound connection lands.
      githubAccess: GITHUB_ACCESS_WITHOUT_CONNECTIONS,
      now: () => Date.now(),
    };
  },
);
