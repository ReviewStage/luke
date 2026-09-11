import { eq } from "drizzle-orm";
import { type CloudAgentProviderId, unparsedWire, type WireBoundaryInput } from "../../core.js";
import { getDatabase } from "../../db/index.js";
import { providerKey } from "../../db/schema.js";
import { runWeb } from "../../runtime.js";
import { executeSessionAction } from "../action-execute.js";
import { oauthUserInfoFromAuthAnswer, type UserInfoEndpoint } from "../bearer.js";
import { CATALOG_TOOL_SET } from "../brain-tool-set.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "../encryption.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "../openai.js";
import { type HostedSpend, spendHostedMeter } from "../quota.js";
import type { HostedStoreDatabase } from "../store/database.js";
import { type HostedStore, hostedStore, storeWriter } from "../store/index.js";
import { readApiKeyFor } from "../vault-keys.js";
import type { VaultKeyRow } from "../vault-route.js";
import type { StoreWriter } from "./announce.js";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_MODEL_FIXTURE } from "./bounds.js";
import { conversationOwnedBy, runtimeSessionOwner } from "./conversation.js";
import type { SessionOwnership } from "./door.js";
import type { CloudActionExecutor } from "./performer.js";

/**
 * The deployment's real seams behind the eve project's authored files, each
 * built on first use so the agent's discovery, which imports these files,
 * touches no database and needs no secret: the bearer's account through the
 * auth service's own userinfo, the stored keys out of the vault table under
 * the vault secret, the store under the payload key ring, the writer over
 * the catalog's tool set, Luke's own OpenAI key and model, and the daily
 * meter. An authored file hands what it needs here and nothing else.
 */

/** The default model the hosted brain runs on when the deployment names none. */
const DEFAULT_BRAIN_MODEL = "gpt-5.4";

interface OpenAiAccess {
  readonly apiKey: string;
  readonly modelId: string;
}

export interface BrainHostSeams {
  readonly db: () => HostedStoreDatabase;
  readonly store: () => HostedStore;
  /** The writer over the catalog's tool set, composed once; its composition probes every declared schema. */
  readonly writer: () => Promise<StoreWriter>;
  readonly userInfo: UserInfoEndpoint;
  /** Who a session or a conversation belongs to, for the door. */
  readonly ownership: SessionOwnership;
  /** Luke's own OpenAI access, or nothing when the deployment holds no key and the hosted brain is off. */
  readonly openAi: () => OpenAiAccess | undefined;
  /** Whether the deployment asked for the scripted fixture model in place of OpenAI. */
  readonly scriptedModel: () => boolean;
  readonly spend: (userId: string) => Promise<HostedSpend>;
  /** The account's stored provider keys, sealed, as the roster and the actions are admitted under them. */
  readonly vaultRows: (userId: string) => Promise<readonly VaultKeyRow[]>;
  /** The secret the vault's rows are sealed under. */
  readonly vaultSecret: () => string;
  /** The account's stored key for a cloud provider, decrypted; nothing where none is stored or it cannot be opened. */
  readonly providerKey: (
    userId: string,
    providerId: CloudAgentProviderId,
  ) => Promise<string | undefined>;
  readonly executeAction: CloudActionExecutor;
  readonly now: () => number;
}

function once<Value>(build: () => Value): () => Value {
  let built: { value: Value } | undefined;
  return () => {
    built ??= { value: build() };
    return built.value;
  };
}

function vaultSecret(): string {
  const secret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];
  if (!secret)
    throw new Error(`${VAULT_ENCRYPTION_ENVIRONMENT.SECRET} is required by the brain host.`);
  return secret;
}

export function productionBrainHostSeams(): BrainHostSeams {
  const db = once(() => getDatabase());
  const store = once(() =>
    hostedStore({ db: db(), keys: payloadKeyRing(vaultSecret()), run: runWeb }),
  );
  const writer = once(() => storeWriter({ db: db(), tools: CATALOG_TOOL_SET }));
  const vaultRows = async (userId: string): Promise<readonly VaultKeyRow[]> =>
    db()
      .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
      .from(providerKey)
      .where(eq(providerKey.userId, userId));
  return {
    db,
    store,
    writer,
    ownership: {
      sessionOwner: (sessionId) => runtimeSessionOwner(db(), sessionId),
      ownsConversation: (userId, conversationId) =>
        conversationOwnedBy(db(), userId, conversationId),
    },
    // The auth service opens the database as it is imported, so it is reached
    // only when a bearer is checked and never by discovery of these files.
    userInfo: async (input) => {
      const { auth } = await import("../../auth.js");
      // SAFETY: the auth service answers JSON; the read below is what holds it to the userinfo shape.
      const answer = (await auth.api.oauth2UserInfo(input)) as WireBoundaryInput;
      return oauthUserInfoFromAuthAnswer(unparsedWire(answer));
    },
    openAi: () => {
      const apiKey = process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY];
      if (!apiKey) return undefined;
      return {
        apiKey,
        modelId: process.env[HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL] || DEFAULT_BRAIN_MODEL,
      };
    },
    scriptedModel: () =>
      process.env[BRAIN_HOST_ENVIRONMENT.MODEL_FIXTURE] === BRAIN_HOST_MODEL_FIXTURE.SCRIPTED,
    spend: (userId) => spendHostedMeter(db(), { userId, now: Date.now() }),
    vaultRows,
    vaultSecret,
    providerKey: async (userId, providerId) =>
      readApiKeyFor(await vaultRows(userId), vaultSecret())(providerId)(),
    executeAction: (input) => executeSessionAction(input),
    now: () => Date.now(),
  };
}
