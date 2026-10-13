import assert from "node:assert/strict";
import { parseKeyRing, sealProviderKey } from "@sidecar/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@sidecar/database/models/provider-key-store";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
} from "@sidecar/hosted/provider-key-wire";
import { jsonResponse } from "@sidecar/wire/testing";
import { generateText } from "ai";
import { Redacted, Result } from "effect";
import { afterAll, test } from "vitest";
import { accountProviderKeys } from "../server/hosted/coder-host/account-keys";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { coderModel, type LukeKeys } from "../server/hosted/coder-host/model";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The key a coding agent's step runs on, read from the account's rows over a
 * real dialect and spent against a provider faked at its fetch: the
 * account's own key where it saved one and Luke's where it did not, a step
 * refused rather than moved onto Luke's key where the account's cannot be
 * read, and the row's status kept as the provider answers the account's key.
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

const LUKE: LukeKeys = {
  anthropic: Redacted.make("sk-ant-luke-own-key-0000"),
  openAi: Redacted.make("sk-proj-luke-own-key-0000"),
};

const ACCOUNT_KEY = {
  ANTHROPIC: "sk-ant-account-own-key-1111",
  OPENAI: "sk-proj-account-own-key-1111",
} as const;

const WINDOW = 200_000;

const CHOICE = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: { model: "anthropic/claude-opus-5.5", effort: "high" },
  [PROVIDER_KEY_PROVIDER.OPENAI]: { model: "openai/gpt-6.1-sol", effort: "high" },
} as const;

/** A message Anthropic's API answers a step with. */
const ANTHROPIC_MESSAGE = {
  id: "msg_fixture",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Done." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A provider answering each request with the next of its answers, keeping the key every request carried. */
function provider(answers: readonly Response[]) {
  const keys: string[] = [];
  let next = 0;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    keys.push(
      headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /u, "") ?? "",
    );
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    return answer?.clone() ?? jsonResponse({}, 500);
  };
  return { fetch, keys };
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
      { userId, provider: providerId },
      Redacted.make(key),
    );
    await database.run(saveProviderKey(userId, providerId, sealed, "sk-…test", new Date(0)));
  }
  return userId;
}

/** One step's model for the account, as the host would select it, over the provider given. */
async function stepModel(
  userId: string,
  providerId: ProviderKeyProvider,
  fetch: typeof globalThis.fetch,
  held: { readonly ring: string | undefined } = { ring: RING.HELD },
) {
  const { ring } = held;
  const keys = await database.run(
    accountProviderKeys(userId, {
      luke: LUKE,
      ring: ring === undefined ? undefined : Redacted.make(ring),
      run: database.run,
    }),
  );
  return coderModel(CHOICE[providerId], { ...keys, fetch }, WINDOW);
}

/** Runs one step on the model, answering its text or the failure's message. */
async function step(selected: Awaited<ReturnType<typeof stepModel>>): Promise<string> {
  if (Result.isFailure(selected)) return assert.fail(`no model: ${selected.failure}`);
  try {
    const answer = await generateText({
      model: selected.success.model,
      prompt: "Go.",
      maxRetries: 0,
    });
    return answer.text;
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

async function statusOf(userId: string, providerId: ProviderKeyProvider) {
  const rows = await database.run(listProviderKeyRows(userId));
  return rows.find((row) => row.provider === providerId)?.status;
}

test("a step runs on the account's own key where it saved one, and on Luke's for a provider where it saved none", async () => {
  const userId = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const anthropic = provider([jsonResponse(ANTHROPIC_MESSAGE, 200)]);
  const openAi = provider([jsonResponse({ error: { message: "fixture: stop here" } }, 500)]);

  assert.equal(
    await step(await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, anthropic.fetch)),
    "Done.",
  );
  await step(await stepModel(userId, PROVIDER_KEY_PROVIDER.OPENAI, openAi.fetch));

  assert.deepEqual(anthropic.keys, [ACCOUNT_KEY.ANTHROPIC]);
  assert.deepEqual(openAi.keys, [Redacted.value(LUKE.openAi ?? Redacted.make(""))]);
});

test("an account's key the ring cannot open, or one on a deployment holding no ring, refuses the step and never runs it on Luke's key", async () => {
  const userId = await accountWithKeys({ [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI });
  const reached = provider([jsonResponse({}, 200)]);

  const otherRing = await stepModel(userId, PROVIDER_KEY_PROVIDER.OPENAI, reached.fetch, {
    ring: RING.OTHER,
  });
  const noRing = await stepModel(userId, PROVIDER_KEY_PROVIDER.OPENAI, reached.fetch, {
    ring: undefined,
  });

  assert.deepEqual(otherRing, Result.fail(CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE));
  assert.deepEqual(noRing, Result.fail(CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE));
  assert.deepEqual(reached.keys, [], "no provider was reached on any key");
});

test("a provider refusing the account's key fails the step in words naming that key and marks the row invalid", async () => {
  const userId = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const refusing = provider([
    jsonResponse(
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      401,
    ),
  ]);

  const failed = await step(
    await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, refusing.fetch),
  );

  assert.equal(failed, CODER_REFUSAL.ACCOUNT_KEY_REFUSED);
  assert.equal(
    await statusOf(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC),
    PROVIDER_KEY_STATUS.INVALID,
  );
});

test("a provider refusing the work for the account's billing marks the row quota exceeded, and the next step that goes through marks it verified", async () => {
  const userId = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
    [PROVIDER_KEY_PROVIDER.OPENAI]: ACCOUNT_KEY.OPENAI,
  });
  const broke = provider([
    jsonResponse(
      {
        error: {
          type: "insufficient_quota",
          code: "insufficient_quota",
          message: "You exceeded your current quota.",
        },
      },
      429,
    ),
  ]);
  const anthropic = provider([
    jsonResponse(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API.",
        },
      },
      400,
    ),
    jsonResponse(ANTHROPIC_MESSAGE, 200),
  ]);

  const openAiFailed = await step(
    await stepModel(userId, PROVIDER_KEY_PROVIDER.OPENAI, broke.fetch),
  );
  const anthropicFailed = await step(
    await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, anthropic.fetch),
  );
  const anthropicStatusWhileBroke = await statusOf(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC);
  const anthropicDone = await step(
    await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, anthropic.fetch),
  );

  assert.equal(openAiFailed, CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA);
  assert.equal(
    await statusOf(userId, PROVIDER_KEY_PROVIDER.OPENAI),
    PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
  );
  assert.equal(anthropicFailed, CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA);
  assert.equal(anthropicStatusWhileBroke, PROVIDER_KEY_STATUS.QUOTA_EXCEEDED);
  assert.equal(anthropicDone, "Done.");
  assert.equal(
    await statusOf(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC),
    PROVIDER_KEY_STATUS.VERIFIED,
  );
});

test("a step on Luke's key that the provider refuses fails as the provider said, and names no account key", async () => {
  const userId = await accountWithKeys({});
  const refusing = provider([
    jsonResponse(
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      401,
    ),
  ]);

  const failed = await step(
    await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, refusing.fetch),
  );

  assert.notEqual(failed, CODER_REFUSAL.ACCOUNT_KEY_REFUSED);
  assert.match(failed, /invalid x-api-key/u);
  assert.deepEqual(await database.run(listProviderKeyRows(userId)), []);
});

test("a status written for a key since replaced marks nothing of its successor", async () => {
  const userId = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const refusing = provider([
    jsonResponse(
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      401,
    ),
  ]);
  const selected = await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, refusing.fetch);
  // The key is replaced between the step's read and its call.
  const ring = parseKeyRing(Redacted.make(RING.HELD));
  if (Result.isFailure(ring)) return assert.fail("not a ring");
  const owner = { userId, provider: PROVIDER_KEY_PROVIDER.ANTHROPIC };
  const replacement = sealProviderKey(
    ring.success,
    owner,
    Redacted.make("sk-ant-replacement-2222"),
  );
  await database.run(
    saveProviderKey(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, replacement, "sk-…2222", new Date(1)),
  );

  await step(selected);

  assert.equal(
    await statusOf(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC),
    PROVIDER_KEY_STATUS.VERIFIED,
  );
});
