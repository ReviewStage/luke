import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  type ProviderKeyProvider,
} from "@sidecar/hosted/provider-key-wire";
import { Duration, Effect, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * provider-key-check.ts -- whether a provider accepts a key, asked before an account's own key is kept.
 *
 * One authenticated read that bills nothing: each provider's list of
 * models. A 200 is a key the provider accepts; a 401 or a 403 is one it
 * refuses; anything else, a failure to connect, or no answer inside the
 * deadline is a provider that could not be asked, which keeps nothing and
 * may be tried again. The provider's body is never read and nothing of the
 * exchange is logged, since a provider's refusal can echo part of the key.
 *
 * A key spelled as the other provider's is refused before it is sent
 * anywhere, so an Anthropic key pasted into OpenAI's row never reaches
 * OpenAI.
 *
 * An Anthropic key the provider accepts is also asked whether its
 * organization may run fast mode, which Anthropic grants organization by
 * organization and offers no read of: one fast request for one output
 * token, a fraction of a cent on the key. A 200 is an organization granted
 * fast mode, and Anthropic's 429 against a fast limit of 0 is one never
 * granted it; anything else says neither, and the key is kept without an
 * answer. That 429's body is read for its words and for nothing else.
 */

const PROVIDER_CHECK = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    URL: "https://api.anthropic.com/v1/models?limit=1",
    VERSION: "2023-06-01",
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    URL: "https://api.openai.com/v1/models",
  },
} as const;

/** The one fast request a fast check sends: the model Luke's fast versions lead with, at its least effort, for one token. */
const FAST_CHECK = {
  URL: "https://api.anthropic.com/v1/messages",
  BETA: "fast-mode-2026-02-01",
  BODY: {
    model: "claude-opus-5-5",
    max_tokens: 1,
    speed: "fast",
    output_config: { effort: "low" },
    messages: [{ role: "user", content: "Hi" }],
  },
} as const;

/** Anthropic's words, in a 429's body, for an organization fast mode was never enabled for: a fast limit of 0. */
const FAST_LIMIT_ZERO = /rate limit of 0 fast mode/iu;

/** How long the provider is given to answer before the save is answered unreachable. */
const CHECK_TIMEOUT = Duration.seconds(10);

/** Every Anthropic key's own prefix; an OpenAI key begins `sk-` without it. */
const ANTHROPIC_KEY_PREFIX = "sk-ant-";
const OPENAI_KEY_PREFIX = "sk-";

/** The prefix a hint keeps: `sk-` and the one lowercase word after it that names the key's kind, as `sk-ant-` or `sk-proj-`. */
const HINT_PREFIX = /^sk-(?:[a-z]+-)?/u;
const HINT_TAIL_CHARS = 4;

/** What a check answers: the key accepted, or why it is not kept. */
export const PROVIDER_KEY_CHECK = {
  ACCEPTED: "accepted",
  INVALID: PROVIDER_KEY_REJECTION.INVALID,
  WRONG_PROVIDER: PROVIDER_KEY_REJECTION.WRONG_PROVIDER,
  UNREACHABLE: PROVIDER_KEY_REJECTION.UNREACHABLE,
} as const;

export type ProviderKeyCheck = (typeof PROVIDER_KEY_CHECK)[keyof typeof PROVIDER_KEY_CHECK];

const HTTP_STATUS = { OK: 200, UNAUTHORIZED: 401, FORBIDDEN: 403, TOO_MANY_REQUESTS: 429 } as const;

/** Whether the key is spelled as the other provider's. */
function spelledForOther(provider: ProviderKeyProvider, key: string): boolean {
  const anthropic = key.startsWith(ANTHROPIC_KEY_PREFIX);
  return provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
    ? !anthropic && key.startsWith(OPENAI_KEY_PREFIX)
    : anthropic;
}

function checkRequest(
  provider: ProviderKeyProvider,
  key: Redacted.Redacted<string>,
): HttpClientRequest.HttpClientRequest {
  switch (provider) {
    case PROVIDER_KEY_PROVIDER.ANTHROPIC: {
      const check = PROVIDER_CHECK[PROVIDER_KEY_PROVIDER.ANTHROPIC];
      // The key is revealed here alone, into the one header the provider reads it from.
      return HttpClientRequest.get(check.URL).pipe(
        HttpClientRequest.setHeaders({
          "x-api-key": Redacted.value(key),
          "anthropic-version": check.VERSION,
        }),
      );
    }
    case PROVIDER_KEY_PROVIDER.OPENAI:
      return HttpClientRequest.get(PROVIDER_CHECK[PROVIDER_KEY_PROVIDER.OPENAI].URL).pipe(
        HttpClientRequest.bearerToken(Redacted.value(key)),
      );
  }
}

/** The hint an account is shown of a key: its prefix and its last four characters, as `sk-ant-…abcd`. */
export function providerKeyHint(key: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(key);
  const prefix = HINT_PREFIX.exec(revealed)?.[0] ?? "";
  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

/** Asks the provider whether it accepts the key, over the ambient client; never fails, since every outcome is an answer. */
export const checkProviderKey = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: ProviderKeyProvider,
  key: Redacted.Redacted<string>,
): Effect.fn.Return<ProviderKeyCheck, never, HttpClient.HttpClient> {
  if (spelledForOther(provider, Redacted.value(key))) return PROVIDER_KEY_CHECK.WRONG_PROVIDER;
  const client = yield* HttpClient.HttpClient;
  // A request that failed or timed out is no answer, and its cause is dropped unread.
  const answered = Option.getOrUndefined(
    yield* client.execute(checkRequest(provider, key)).pipe(
      Effect.map((response) => response.status),
      Effect.scoped,
      Effect.timeout(CHECK_TIMEOUT),
      Effect.option,
    ),
  );
  if (answered === HTTP_STATUS.OK) return PROVIDER_KEY_CHECK.ACCEPTED;
  if (answered === HTTP_STATUS.UNAUTHORIZED || answered === HTTP_STATUS.FORBIDDEN) {
    return PROVIDER_KEY_CHECK.INVALID;
  }
  return PROVIDER_KEY_CHECK.UNREACHABLE;
});

/**
 * Asks Anthropic whether the key's organization may run fast mode, over the
 * ambient client: enabled, not enabled, or nothing where the answer says
 * neither or never came. Never fails, since a key is kept either way.
 */
export const checkFastAccess = /* @__PURE__ */ Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
): Effect.fn.Return<FastAccess | undefined, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  // The key is revealed here alone, into the one header the provider reads it from.
  const request = HttpClientRequest.post(FAST_CHECK.URL).pipe(
    HttpClientRequest.setHeaders({
      "x-api-key": Redacted.value(key),
      "anthropic-version": PROVIDER_CHECK[PROVIDER_KEY_PROVIDER.ANTHROPIC].VERSION,
      "anthropic-beta": FAST_CHECK.BETA,
    }),
    HttpClientRequest.bodyJsonUnsafe(FAST_CHECK.BODY),
  );
  // Note that only a 429's body is read, and only for the limit's words, because a refusal can echo part of the key.
  const answered = yield* client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.status === HTTP_STATUS.TOO_MANY_REQUESTS
        ? Effect.map(response.text, (text) =>
            FAST_LIMIT_ZERO.test(text) ? FAST_ACCESS.NOT_ENABLED : undefined,
          )
        : Effect.succeed(response.status === HTTP_STATUS.OK ? FAST_ACCESS.ENABLED : undefined),
    ),
    Effect.scoped,
    Effect.timeout(CHECK_TIMEOUT),
    Effect.option,
  );
  return Option.getOrUndefined(answered);
});
