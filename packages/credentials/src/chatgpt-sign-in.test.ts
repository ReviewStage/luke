/**
 * chatgpt-sign-in.test.ts -- the desktop's Sign in with ChatGPT against a fake of OpenAI's authorization server, over the real loopback, with the test as the browser.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { it } from "@effect/vitest";
import type { ChatGptCredentialsSaveRequest } from "@luke/features/provider-key-wire";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { CHATGPT_SIGN_IN, CHATGPT_SIGN_IN_REASON, chatGptSignIn } from "./chatgpt-sign-in.js";
import { loopbackConsent } from "./loopback-consent.js";
import {
  CHATGPT_FAKE,
  type FakeChatGptAnswers,
  fakeChatGptAuthorizationServer,
  grantedCallback,
  returnToLoopback,
} from "./testing/index.js";

const HOST_ID = "urn:uuid:00000000-0000-4000-8000-000000000001";

interface Saved {
  readonly saved: true;
}

/** The sign-in under test: the real loopback, the fake server, and the service's save recorded. */
function harness(answers: FakeChatGptAnswers = {}) {
  const server = fakeChatGptAuthorizationServer(answers);
  const saves: ChatGptCredentialsSaveRequest[] = [];
  const opened = Deferred.makeUnsafe<URL>();
  const signIn = chatGptSignIn<Saved>({
    openConsent: loopbackConsent,
    openExternal: (url) => {
      Deferred.doneUnsafe(opened, Exit.succeed(server.authorize(url)));
    },
    http: server.http,
    save: (credentials) =>
      Effect.sync(() => {
        saves.push(credentials);
        return { saved: true } as const;
      }),
  });
  return { signIn, server, saves, opened };
}

/** Runs one sign-in through the browser's consent, answering the loopback with what the callback carries. */
const consentWith = (
  setup: ReturnType<typeof harness>,
  callback: (page: URL) => Record<string, string>,
) =>
  Effect.gen(function* () {
    const running = yield* Effect.forkChild(setup.signIn.signIn(HOST_ID));
    const page = yield* Deferred.await(setup.opened);
    yield* Effect.promise(() => returnToLoopback(page, callback(page)));
    return { outcome: yield* Fiber.join(running), page };
  });

it.effect(
  "a first registration opens OpenAI's page as the open-source flow asks, and hands the service the validated credentials under the issued client",
  () =>
    Effect.gen(function* () {
      const setup = harness();
      const { outcome, page } = yield* consentWith(setup, grantedCallback);

      assert.deepEqual(outcome, { saved: true });
      assert.equal(`${page.origin}${page.pathname}`, CHATGPT_FAKE.AUTHORIZE_URL);
      const query = page.searchParams;
      assert.equal(query.get("client_id"), "dynamic_agent_client");
      assert.equal(query.get("agent_name_hint"), "Luke");
      assert.equal(query.get("ext_agent_host_id"), HOST_ID);
      assert.equal(query.get("response_type"), "code");
      assert.equal(query.get("scope"), CHATGPT_FAKE.GRANTED);
      assert.equal(query.get("resource"), "https://api.openai.com/v1");
      assert.equal(query.get("code_challenge_method"), "S256");
      assert.match(query.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/u);
      assert.ok((query.get("nonce") ?? "").length > 0);
      // The ID token kept is the one OpenAI signed, retained for a later sign-in's hint.
      const idToken = setup.saves[0]?.idToken ?? "";
      assert.equal(idToken.split(".").length, 3);
      assert.deepEqual(setup.saves, [
        {
          clientId: CHATGPT_FAKE.ISSUED_CLIENT,
          accountId: CHATGPT_FAKE.SUBJECT,
          accessToken: CHATGPT_FAKE.ACCESS_TOKEN,
          refreshToken: CHATGPT_FAKE.REFRESH_TOKEN,
          idToken,
          expiresInSeconds: 3600,
          scopes: [...CHATGPT_SIGN_IN.SCOPES],
        },
      ]);
    }),
);

it.effect("a grant without ChatGPT plan use keeps nothing and says so", () =>
  Effect.gen(function* () {
    const setup = harness({ scope: "openid profile email offline_access" });
    const { outcome } = yield* consentWith(setup, grantedCallback);
    assert.deepEqual(outcome, { reason: CHATGPT_SIGN_IN_REASON.PLAN_NOT_ENABLED });
    assert.deepEqual(setup.saves, []);
  }),
);

for (const [named, answers] of [
  ["minted for another attempt's nonce", { nonce: "another-attempts-nonce" }],
  ["minted for another client", { audience: "oaiapp_someone_else" }],
  ["already expired", { expiresAt: -1 }],
] as const) {
  it.effect(`an ID token ${named} is refused and nothing is kept`, () =>
    Effect.gen(function* () {
      const setup = harness(answers);
      const { outcome } = yield* consentWith(setup, grantedCallback);
      assert.deepEqual(outcome, { reason: CHATGPT_SIGN_IN_REASON.NOT_VERIFIED });
      assert.deepEqual(setup.saves, []);
    }),
  );
}

it.effect("a callback naming no issued client is an incomplete registration, never exchanged", () =>
  Effect.gen(function* () {
    const setup = harness();
    const { outcome } = yield* consentWith(setup, (page) => ({
      code: "auth-code",
      state: page.searchParams.get("state") ?? "",
    }));
    assert.deepEqual(outcome, { reason: CHATGPT_SIGN_IN_REASON.NOT_REGISTERED });
    assert.ok(setup.server.requests.every((request) => request.url !== CHATGPT_FAKE.TOKEN_URL));
    assert.deepEqual(setup.saves, []);
  }),
);

it.effect("with OpenAI's example port taken, the loopback listens on another and names it", () =>
  Effect.gen(function* () {
    const holder = http.createServer();
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          holder.once("error", () => resolve());
          holder.listen(CHATGPT_SIGN_IN.PREFERRED_PORT, "127.0.0.1", () => resolve());
        }),
    );
    try {
      const setup = harness();
      const { outcome, page } = yield* consentWith(setup, grantedCallback);
      assert.deepEqual(outcome, { saved: true });
      const port = new URL(page.searchParams.get("redirect_uri") ?? "").port;
      assert.notEqual(port, String(CHATGPT_SIGN_IN.PREFERRED_PORT));
    } finally {
      holder.close();
    }
  }),
);
