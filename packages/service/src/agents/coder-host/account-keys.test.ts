import assert from "node:assert/strict";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@luke/database/models/provider-key-store";
import { openHostedStoreTestDatabase } from "@luke/database/testing";
import type { ModelChoice } from "@luke/features/models-wire";
import {
  FAST_ACCESS,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { jsonResponse } from "@luke/wire/testing";
import { generateText } from "ai";
import { Redacted, Result } from "effect";
import { afterAll, test } from "vitest";
import { accountProviderKeys } from "./account-keys.js";
import { CODER_REFUSAL } from "./bounds.js";
import { coderModel, type LukeKeys } from "./model.js";

/**
 * The key a coding agent's step runs on, read from the account's rows over a
 * real dialect and spent against a provider faked at its fetch: the
 * account's own key where it saved one and Luke's where it did not, a step
 * refused rather than moved onto Luke's key where the account's cannot be
 * read, the row's status kept as the provider answers the account's key,
 * a fast step run on the account's key with what it showed of the key's
 * organization kept on the row, and every step on Luke's key counted on
 * the account's meter.
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

/** The accounts the meter counted a use for, one entry per use. */
const counted: string[] = [];

/** The meter as the deployment's counts a use, recorded here. */
const meter = (userId: string) => ({
  spend: async () => {
    counted.push(userId);
  },
  report: () => undefined,
});

/** One step's model for the account, as the host would select it, over the provider given, on the provider's choice above or the one named. */
async function stepModel(
  userId: string,
  providerId: ProviderKeyProvider,
  fetch: typeof globalThis.fetch,
  held: { readonly ring: string | undefined } = { ring: RING.HELD },
  choice: ModelChoice = CHOICE[providerId],
) {
  const { ring } = held;
  const keys = await database.run(
    accountProviderKeys(userId, {
      luke: LUKE,
      meter,
      ring: ring === undefined ? undefined : Redacted.make(ring),
      run: database.run,
    }),
  );
  return coderModel(choice, { ...keys, fetch }, WINDOW, async () => undefined);
}

/** Runs one step on the model, answering its text or the failure's message. */
async function step(selected: Awaited<ReturnType<typeof stepModel>>): Promise<string> {
  if (Result.isFailure(selected)) return assert.fail(`no model: ${selected.failure}`);
  const { providerOptions } = selected.success.modelOptions;
  try {
    const answer = await generateText({
      model: selected.success.model,
      prompt: "Go.",
      maxRetries: 0,
      ...(providerOptions === undefined ? undefined : { providerOptions }),
    });
    return answer.text;
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
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

test("a Claude setup-token is no key a step runs on: an account holding only one runs on Luke's key", async () => {
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
  const anthropic = provider([jsonResponse(ANTHROPIC_MESSAGE, 200)]);

  await step(await stepModel(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, anthropic.fetch));

  assert.deepEqual(anthropic.keys, [Redacted.value(LUKE.anthropic ?? Redacted.make(""))]);
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

/** Anthropic's refusal of a fast request for an organization fast mode was never enabled for, as production met it. */
const FAST_LIMIT_ZERO = {
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "This request would exceed your organization's rate limit of 0 fast mode input tokens per minute (model: claude-opus-5-5).",
  },
};

const FAST_CHOICE = { model: "anthropic/claude-opus-5.5-fast", effort: "high" } as const;

/** The fast access the account's Anthropic row now says. */
async function rowFastAccess(userId: string) {
  const rows = await database.run(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY));
  return rows.find((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC)?.fastAccess;
}

test("a fast step runs on the account's own key, and the key's row keeps what it showed: enabled where the fast call ran, not enabled where Anthropic refused it at a fast limit of 0 and the step answered at standard speed", async () => {
  const granted = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const refused = await accountWithKeys({
    [PROVIDER_KEY_PROVIDER.ANTHROPIC]: ACCOUNT_KEY.ANTHROPIC,
  });
  const fast = provider([jsonResponse(ANTHROPIC_MESSAGE, 200)]);
  const limitZero = provider([
    jsonResponse(FAST_LIMIT_ZERO, 429),
    jsonResponse(ANTHROPIC_MESSAGE, 200),
  ]);

  const ran = await step(
    await stepModel(granted, PROVIDER_KEY_PROVIDER.ANTHROPIC, fast.fetch, undefined, FAST_CHOICE),
  );
  const fellBack = await step(
    await stepModel(
      refused,
      PROVIDER_KEY_PROVIDER.ANTHROPIC,
      limitZero.fetch,
      undefined,
      FAST_CHOICE,
    ),
  );

  assert.equal(ran, "Done.");
  assert.equal(fellBack, "Done.");
  assert.deepEqual(fast.keys, [ACCOUNT_KEY.ANTHROPIC]);
  assert.deepEqual(limitZero.keys, [ACCOUNT_KEY.ANTHROPIC, ACCOUNT_KEY.ANTHROPIC]);
  assert.equal(await rowFastAccess(granted), FAST_ACCESS.ENABLED);
  assert.equal(await rowFastAccess(refused), FAST_ACCESS.NOT_ENABLED);
});
