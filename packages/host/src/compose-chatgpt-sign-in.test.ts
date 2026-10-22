/**
 * compose-chatgpt-sign-in.test.ts -- the host's Sign in with ChatGPT, from the window's press to the service's save, over the real loopback and a fake of OpenAI and of the service.
 */
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { loopbackConsent } from "@luke/credentials/node";
import {
  CHATGPT_FAKE,
  fakeChatGptAuthorizationServer,
  grantedCallback,
  returnToLoopback,
} from "@luke/credentials/testing";
import { fixedBearer, HostedCodingAgentClient } from "@luke/features";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@luke/gateway";
import { HTTP_STATUS, jsonResponse, type RecordedRequest } from "@luke/wire/testing";
import { Effect } from "effect";
import { composeChatGptSignIn } from "./compose-chatgpt-sign-in.js";

const SERVICE = "https://luke.test";
const CONTEXT = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const HOST_ID = "urn:uuid:00000000-0000-4000-8000-000000000002";

/** The account's keys once the service kept the sign-in: a hint and a status, and nothing of the credentials. */
const KEPT: ProviderKeysAnswer = {
  keys: [],
  subscriptions: [
    {
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      hint: "ChatGPT",
      status: PROVIDER_KEY_STATUS.UNVERIFIED,
      addedAt: 1,
      statusAt: 1,
    },
  ],
};

/**
 * The composer over a fake OpenAI and a fake service on the one `HttpClient`
 * the host hands it, with the test as the browser: the page the host opens is
 * answered at once as the developer consenting would answer it.
 */
function harness(
  options: {
    gateOpen?: boolean;
    saved?: ProviderKeysAnswer;
    /** What happens while the browser is open, before the developer consents. */
    whileBrowsing?: (signedIn: { key: string | undefined }) => void;
    /** What happens while the service is asked for the host. */
    whileAskingHost?: () => void;
    /** Whether the service fails the host read. */
    hostFails?: boolean;
  } = {},
) {
  const saves: string[] = [];
  const opened: URL[] = [];
  const signedIn = { key: "ada@luke.test" as string | undefined };
  const service = async (request: RecordedRequest) => {
    if (request.pathname === "/api/account/chatgpt/host") {
      options.whileAskingHost?.();
      if (options.hostFails === true) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      return jsonResponse({ extAgentHostId: HOST_ID });
    }
    assert.equal(request.pathname, "/api/account/chatgpt/credentials");
    saves.push(await new Response(request.init.body).text());
    return jsonResponse(options.saved ?? KEPT);
  };
  const server = fakeChatGptAuthorizationServer({ elsewhere: service });
  const composer = composeChatGptSignIn({
    kernel: {
      runMode: { sendsNetwork: true },
      openExternalThroughNode: async (url) => {
        const page = server.authorize(url);
        opened.push(page);
        options.whileBrowsing?.(signedIn);
        await Effect.runPromise(returnToLoopback(page, grantedCallback(page)));
      },
    },
    account: {
      capabilitiesActive: () => options.gateOpen ?? true,
      token: {
        readAccessToken: () => Effect.succeed("account-bearer"),
        refreshAccount: () => Effect.void,
        readAccountKey: () => Effect.sync(() => signedIn.key),
      },
    },
    client: new HostedCodingAgentClient({
      serviceBaseUrl: SERVICE,
      credential: fixedBearer("account-bearer"),
    }),
    openConsent: loopbackConsent,
  });
  return { composer, server, saves, opened };
}

/** One press, as the window's act reaches the host: what crosses back to the renderer, as it crosses. */
const press = (setup: ReturnType<typeof harness>) =>
  Effect.gen(function* () {
    const composer = yield* setup.composer;
    const signIn = composer.methods[GATEWAY_METHOD.CHATGPT_SIGN_IN];
    assert.ok(signIn);
    return JSON.stringify(yield* signIn({}, CONTEXT));
  }).pipe(Effect.scoped, Effect.provide(setup.server.http));

it.effect(
  "a sign-in hands the tokens to the service alone, and the window hears the keys without one",
  () =>
    Effect.gen(function* () {
      const setup = harness();
      const answered = yield* press(setup);

      assert.equal(setup.opened[0]?.searchParams.get("ext_agent_host_id"), HOST_ID);
      assert.equal(setup.saves.length, 1);
      const saved = JSON.parse(setup.saves[0] ?? "{}");
      assert.equal(saved.accessToken, CHATGPT_FAKE.ACCESS_TOKEN);
      assert.equal(saved.refreshToken, CHATGPT_FAKE.REFRESH_TOKEN);
      assert.deepEqual(JSON.parse(answered), KEPT);
      for (const secret of [
        CHATGPT_FAKE.ACCESS_TOKEN,
        CHATGPT_FAKE.REFRESH_TOKEN,
        saved.idToken,
        "auth-code",
      ]) {
        assert.equal(answered.includes(secret), false, "no credential crosses to the window");
      }
    }),
);

it.effect("a sign-in the service refuses is a sentence for the row, and no keys", () =>
  Effect.gen(function* () {
    const setup = harness({
      saved: { keys: [], rejected: PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN },
    });
    const answered = JSON.parse(yield* press(setup));
    assert.deepEqual(answered, {
      refused: "Luke couldn't verify the ChatGPT sign-in. Try again.",
    });
  }),
);

it.effect("behind a closed account gate a press opens no browser and answers unanswered", () =>
  Effect.gen(function* () {
    const setup = harness({ gateOpen: false });
    const answered = JSON.parse(yield* press(setup));
    assert.deepEqual(answered, { failure: "unanswered" });
    assert.deepEqual(setup.opened, []);
    assert.deepEqual(setup.server.requests, []);
  }),
);

it.effect("a service that does not answer the host id opens no browser", () =>
  Effect.gen(function* () {
    const setup = harness();
    const broken = fakeChatGptAuthorizationServer({
      elsewhere: () => jsonResponse({}, HTTP_STATUS.SERVER_ERROR),
    });
    const answered = yield* press({ ...setup, server: broken });
    assert.equal("failure" in JSON.parse(answered), true);
    assert.deepEqual(setup.opened, []);
  }),
);

it.effect(
  "a sign-in finished after the Luke account changed is saved for no one, the new account included",
  () =>
    Effect.gen(function* () {
      const setup = harness({
        whileBrowsing: (signedIn) => {
          signedIn.key = "grace@luke.test";
        },
      });
      const answered = JSON.parse(yield* press(setup));
      assert.deepEqual(answered, {
        refused:
          "You signed in to Luke as someone else while ChatGPT was open, so nothing was saved. Try again.",
      });
      assert.deepEqual(setup.saves, []);
    }),
);

for (const hostFails of [false, true]) {
  it.effect(
    `a Cancel pressed while the service is asked for the host opens no browser and reads as cancelled${hostFails ? ", the read failing too" : ""}`,
    () =>
      Effect.gen(function* () {
        const composer = { cancel: () => undefined as unknown };
        const setup = harness({ whileAskingHost: () => composer.cancel(), hostFails });
        const answered = yield* Effect.gen(function* () {
          const built = yield* setup.composer;
          const cancel = built.methods[GATEWAY_METHOD.CHATGPT_SIGN_IN_CANCEL];
          const signIn = built.methods[GATEWAY_METHOD.CHATGPT_SIGN_IN];
          assert.ok(cancel && signIn);
          composer.cancel = () => Effect.runSync(cancel({}, CONTEXT));
          return JSON.stringify(yield* signIn({}, CONTEXT));
        }).pipe(Effect.scoped, Effect.provide(setup.server.http));
        assert.deepEqual(JSON.parse(answered), { cancelled: true });
        assert.deepEqual(setup.opened, []);
      }),
  );
}
