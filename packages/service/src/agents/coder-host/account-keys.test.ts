import assert from "node:assert/strict";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import { openHostedStoreTestDatabase } from "@luke/database/testing";
import type { ModelChoice } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { jsonResponse } from "@luke/wire/testing";
import { generateText, type LanguageModel } from "ai";
import { Effect, Redacted, Result, Schema } from "effect";
import { afterAll, test } from "vitest";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { ownKeyOf } from "./account-keys.js";
import { titleModel } from "./model.js";
import { productionSummaryModel } from "./replay-summary.js";

/**
 * The key a call beside an account's agents spends, read from the account's
 * rows over a real dialect and spent against a provider faked at its fetch:
 * the account's own API key for the provider it prefers or the other's, and
 * none, never ours, where it saved none, holds only a Claude setup-token, or
 * its key cannot be read; and an agent's title and a replay's summary told
 * on it.
 *
 * Synthetic keys and accounts; the key-encryption keys are fixed bytes
 * written for this file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const RING = {
  HELD: `1:${Buffer.alloc(32, 1).toString("base64")}`,
  OTHER: `1:${Buffer.alloc(32, 8).toString("base64")}`,
} as const;

const ACCOUNT_KEY = {
  ANTHROPIC: "sk-ant-account-own-key-1111",
  OPENAI: "sk-proj-account-own-key-1111",
} as const;

const CHOICE = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: { model: "anthropic/claude-opus-5.5", effort: "high" },
  [PROVIDER_KEY_PROVIDER.OPENAI]: { model: "openai/gpt-6.1-sol", effort: "high" },
} as const;

/** A message Anthropic's API answers a call with. */
const ANTHROPIC_MESSAGE = {
  id: "msg_fixture",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Done." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** What a request asked a provider for: the model its body names, where it names one. */
const readRequestModel = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ model: Schema.optional(Schema.String) })),
);

/** A provider answering each request with the next of its answers, keeping the key every request carried and where it went, with the model it asked for. */
function provider(answers: readonly Response[]) {
  const keys: string[] = [];
  const asked: { readonly host: string; readonly model: string | undefined }[] = [];
  let next = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    keys.push(
      headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /u, "") ?? "",
    );
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? readRequestModel(init.body) : {};
    asked.push({ host: url.host, model: body.model });
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    return answer?.clone() ?? jsonResponse({}, 500);
  };
  return { fetch, keys, asked };
}

async function accountWithKeys(saved: Partial<Record<ProviderKeyProvider, string>>) {
  const userId = await database.createUser();
  const ring = parseKeyRing(Redacted.make(RING.HELD));
  if (Result.isFailure(ring)) return assert.fail("not a ring");
  for (const [named, key] of Object.entries(saved)) {
    // SAFETY: the entries are the record's own, keyed by the providers above.
    const providerId = named as ProviderKeyProvider;
    const sealed = sealProviderKey(
      ring.success,
      { userId, provider: providerId, kind: PROVIDER_KEY_KIND.API_KEY },
      Redacted.make(key),
    );
    await database.run(
      saveProviderKey(
        userId,
        providerId,
        PROVIDER_KEY_KIND.API_KEY,
        sealed,
        "sk-…test",
        null,
        new Date(0),
      ),
    );
  }
  return userId;
}

/** The own key a call beside the account's agents spends on, preferring the provider given, as its provider and revealed key, on a deployment holding the ring named, or none for null. */
async function ownKey(
  userId: string,
  preferred: ProviderKeyProvider,
  ring: string | null = RING.HELD,
) {
  const own = await database.run(
    ownKeyOf(userId, preferred, ring === null ? undefined : Redacted.make(ring)),
  );
  return own === undefined ? undefined : { provider: own.provider, key: Redacted.value(own.key) };
}

/** An account holding a Claude setup-token alone, which is no API key. */
async function accountWithSetupToken() {
  const userId = await database.createUser();
  const ring = parseKeyRing(Redacted.make(RING.HELD));
  if (Result.isFailure(ring)) return assert.fail("not a ring");
  const owner = {
    userId,
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  };
  const token = "sk-ant-oat01-account-setup-token-1111";
  await database.run(
    saveProviderKey(
      userId,
      owner.provider,
      owner.kind,
      sealProviderKey(ring.success, owner, Redacted.make(token)),
      "sk-ant-…1111",
      null,
      new Date(0),
    ),
  );
  return userId;
}

test("a call beside an account's agents, such as a title, chapters, or a replay's summary, spends the account's own key for the provider it prefers, the other provider's where it saved only that, and nothing where it saved none, holds only a Claude setup-token, or none opens, never Vespin's", async () => {
  const both = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
    [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI,
  });
  const openAiOnly = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI,
  });
  const none = await accountWithKeys({});
  const setupTokenOnly = await accountWithSetupToken();

  assert.deepEqual(await ownKey(both, PROVIDER_KEY_PROVIDER.OPENAI), {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    key: ACCOUNT_KEY.OPENAI,
  });
  assert.deepEqual(await ownKey(both, PROVIDER_KEY_PROVIDER.ANTHROPIC), {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    key: ACCOUNT_KEY.ANTHROPIC,
  });
  assert.deepEqual(await ownKey(openAiOnly, PROVIDER_KEY_PROVIDER.ANTHROPIC), {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    key: ACCOUNT_KEY.OPENAI,
  });
  assert.equal(await ownKey(none, PROVIDER_KEY_PROVIDER.ANTHROPIC), undefined);
  assert.equal(await ownKey(setupTokenOnly, PROVIDER_KEY_PROVIDER.ANTHROPIC), undefined);
  assert.equal(await ownKey(both, PROVIDER_KEY_PROVIDER.ANTHROPIC, RING.OTHER), undefined);
  assert.equal(await ownKey(both, PROVIDER_KEY_PROVIDER.ANTHROPIC, null), undefined);
});

/** The deployment's environment as a call beside the agents reads it: the ring the account's keys open under, and no key of ours, which it holds none of. */
const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING.HELD),
};

/** Asks the model once, answering its text or nothing where the provider refused. */
async function askOnce(
  model: LanguageModel,
  providerOptions?: Record<string, Record<string, string>>,
): Promise<string | undefined> {
  try {
    const answer = await generateText({
      model,
      prompt: "Go.",
      maxRetries: 0,
      ...(providerOptions === undefined ? undefined : { providerOptions }),
    });
    return answer.text;
  } catch {
    return undefined;
  }
}

/** An agent's title model for the account, preferring the provider given, as production reads it, over the provider's door given. */
async function titleModelFor(
  userId: string,
  preferred: ProviderKeyProvider,
  fetch: typeof globalThis.fetch,
) {
  const own = await database.run(
    ownKeyOf(userId, preferred, ENVIRONMENT.providerKeyEncryptionKeys),
  );
  return own === undefined ? undefined : titleModel(own, fetch);
}

test("an agent's title is told on the account's own key, Anthropic's small model on its Anthropic key and OpenAI's on an OpenAI key it saved alone, and no model at all where it saved none, never on Vespin's key", async () => {
  const anthropicKeyed = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const openAiOnly = await accountWithKeys({ [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI });
  const none = await accountWithKeys({});
  const anthropic = provider([jsonResponse(ANTHROPIC_MESSAGE, 200)]);
  const openAi = provider([jsonResponse({ error: { message: "fixture: stop here" } }, 500)]);

  const onAnthropic = await titleModelFor(
    anthropicKeyed,
    PROVIDER_KEY_PROVIDER.OPENAI,
    anthropic.fetch,
  );
  const onOpenAi = await titleModelFor(openAiOnly, PROVIDER_KEY_PROVIDER.ANTHROPIC, openAi.fetch);
  assert.ok(onAnthropic !== undefined && onOpenAi !== undefined);
  await askOnce(onAnthropic);
  await askOnce(onOpenAi);

  assert.deepEqual(anthropic.keys, [ACCOUNT_KEY.ANTHROPIC]);
  assert.deepEqual(anthropic.asked, [{ host: "api.anthropic.com", model: "claude-haiku-5-5" }]);
  assert.deepEqual(openAi.keys, [ACCOUNT_KEY.OPENAI]);
  assert.deepEqual(openAi.asked, [{ host: "api.openai.com", model: "gpt-6-luna" }]);
  assert.equal(
    await titleModelFor(none, PROVIDER_KEY_PROVIDER.ANTHROPIC, anthropic.fetch),
    undefined,
  );
});

/** A replay's summary model for the account and the new agent's choice, as a Start reads it, over the provider's door given. */
function summaryModelFor(userId: string, choice: ModelChoice, fetch: typeof globalThis.fetch) {
  return database.run(
    productionSummaryModel(userId, choice, "low", fetch).pipe(
      Effect.provideService(HostedEnvironment, ENVIRONMENT),
    ),
  );
}

test("a replay's summary is written on the account's own key, the new agent's own model where it saved that provider's key and the other provider's where it saved only that, and none where it saved none, so the Start replays without one, never on Vespin's key", async () => {
  const anthropicKeyed = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const openAiOnly = await accountWithKeys({ [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI });
  const none = await accountWithKeys({});
  const anthropic = provider([jsonResponse(ANTHROPIC_MESSAGE, 200)]);
  const openAi = provider([jsonResponse({ error: { message: "fixture: stop here" } }, 500)]);
  const opus = CHOICE[PROVIDER_KEY_PROVIDER.ANTHROPIC];

  const own = await summaryModelFor(anthropicKeyed, opus, anthropic.fetch);
  const other = await summaryModelFor(openAiOnly, opus, openAi.fetch);
  assert.ok(own !== undefined && other !== undefined);
  assert.equal(await askOnce(own.model, own.providerOptions), "Done.");
  await askOnce(other.model, other.providerOptions);

  assert.deepEqual(anthropic.keys, [ACCOUNT_KEY.ANTHROPIC]);
  assert.deepEqual(anthropic.asked, [{ host: "api.anthropic.com", model: "claude-opus-5-5" }]);
  assert.deepEqual(openAi.keys, [ACCOUNT_KEY.OPENAI]);
  assert.deepEqual(openAi.asked, [{ host: "api.openai.com", model: "gpt-6.1-sol" }]);
  // The other provider's model may hold less than the new agent's, so its chunks are sized to its own window.
  assert.equal(own.windowTokens, undefined);
  assert.equal(other.windowTokens, 200_000);
  assert.equal(await summaryModelFor(none, opus, anthropic.fetch), undefined);
});
