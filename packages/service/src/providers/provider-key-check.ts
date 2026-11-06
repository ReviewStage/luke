import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { Duration, Effect, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const PROVIDER_CHECK = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    URL: "https://api.anthropic.com/v1/models?limit=1",
    VERSION: "2023-06-01",
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    URL: "https://api.openai.com/v1/models",
  },
} as const;

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

const FAST_LIMIT_ZERO = /rate limit of 0 fast mode/iu;

const FAST_CHECK_TIMEOUT = Duration.seconds(8);

const CHECK_TIMEOUT = Duration.seconds(10);

const ANTHROPIC_KEY_PREFIX = "sk-ant-";
const OPENAI_KEY_PREFIX = "sk-";

const HINT_PREFIX = /^sk-(?:[a-z]+-)?/u;
const HINT_TAIL_CHARS = 4;

export const PROVIDER_KEY_CHECK = {
  ACCEPTED: "accepted",
  INVALID: PROVIDER_KEY_REJECTION.INVALID,
  WRONG_PROVIDER: PROVIDER_KEY_REJECTION.WRONG_PROVIDER,
  UNREACHABLE: PROVIDER_KEY_REJECTION.UNREACHABLE,
} as const;

export type ProviderKeyCheck = (typeof PROVIDER_KEY_CHECK)[keyof typeof PROVIDER_KEY_CHECK];

const HTTP_STATUS = { OK: 200, UNAUTHORIZED: 401, FORBIDDEN: 403, TOO_MANY_REQUESTS: 429 } as const;

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

export function providerKeyHint(key: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(key);
  const prefix = HINT_PREFIX.exec(revealed)?.[0] ?? "";
  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

export const checkProviderKey = /* @__PURE__ */ Effect.fnUntraced(function* (
  provider: ProviderKeyProvider,
  key: Redacted.Redacted<string>,
): Effect.fn.Return<ProviderKeyCheck, never, HttpClient.HttpClient> {
  if (spelledForOther(provider, Redacted.value(key))) return PROVIDER_KEY_CHECK.WRONG_PROVIDER;
  const client = yield* HttpClient.HttpClient;
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

export const checkFastAccess = /* @__PURE__ */ Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
): Effect.fn.Return<FastAccess | undefined, never, HttpClient.HttpClient> {
  if (spelledForOther(PROVIDER_KEY_PROVIDER.ANTHROPIC, Redacted.value(key))) return undefined;
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(FAST_CHECK.URL).pipe(
    HttpClientRequest.setHeaders({
      "x-api-key": Redacted.value(key),
      "anthropic-version": PROVIDER_CHECK[PROVIDER_KEY_PROVIDER.ANTHROPIC].VERSION,
      "anthropic-beta": FAST_CHECK.BETA,
    }),
    HttpClientRequest.bodyJsonUnsafe(FAST_CHECK.BODY),
  );
  const answered = yield* client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.status === HTTP_STATUS.TOO_MANY_REQUESTS
        ? Effect.map(response.text, (text) =>
            FAST_LIMIT_ZERO.test(text) ? FAST_ACCESS.NOT_ENABLED : undefined,
          )
        : Effect.succeed(response.status === HTTP_STATUS.OK ? FAST_ACCESS.ENABLED : undefined),
    ),
    Effect.scoped,
    Effect.timeout(FAST_CHECK_TIMEOUT),
    Effect.option,
  );
  return Option.getOrUndefined(answered);
});
