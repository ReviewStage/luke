import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fixedBearer } from "@luke/features";
import { fakeHttpClientLayer, jsonResponse } from "@luke/wire/testing";
import { Effect } from "effect";
import { AccountAccessClient, accountAccessHolder } from "./account-access-client.js";
import type { AppAccessSlice } from "./app-state.js";

/**
 * The account's access as the host reads and holds it: an admin's read is
 * an admin for that account alone, a sign-out or another account is no
 * admin, and a read that fails, or answers what the wire does not declare,
 * is no admin. The service is a scripted fetch; the accounts are synthetic.
 */

interface RecordedRequest {
  url: string | URL | Request;
  init: RequestInit | undefined;
}

/** An answer the service gives, made fresh for each call that receives it. */
const json =
  (...answer: Parameters<typeof jsonResponse>) =>
  () =>
    jsonResponse(...answer);

/** A service answering each call in turn, holding at its last answer, and what each call asked. */
function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, client: client(fetchLike) };
}

function client(fetchLike: Parameters<typeof fakeHttpClientLayer>[0]) {
  return new AccountAccessClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: fixedBearer("token-1"),
    httpClient: fakeHttpClientLayer(fetchLike),
  });
}

/** A holder over the client, the account signed in as the test moves it, and every access it published. */
function holder(accessClient: AccountAccessClient, signedIn: string | undefined) {
  const account = { key: signedIn };
  const published: AppAccessSlice[] = [];
  const held = accountAccessHolder({
    client: accessClient,
    accountKey: () => account.key,
    publish: (access) => published.push(access),
  });
  return { held, account, published };
}

it.effect("asks the service for the signed-in account's access under its bearer", () =>
  Effect.gen(function* () {
    const { requests, client } = service([json({ admin: true })]);
    assert.equal(yield* client.readAdmin(), true);
    const [request] = requests;
    assert.equal(request?.url, "https://tryluke.dev/api/account/access");
    assert.equal(request?.init?.method, "GET");
    assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer token-1");
  }),
);

it.effect("an admin's read is an admin, and a sign-out leaves no admin standing", () =>
  Effect.gen(function* () {
    const { client } = service([json({ admin: true })]);
    const { held, account, published } = holder(client, "admin@luke.test");
    assert.deepEqual(held.current(), { admin: false });

    yield* held.refresh;
    assert.deepEqual(held.current(), { admin: true });
    assert.deepEqual(published, [{ admin: true }]);

    // The gate closes as the account signs out, and its change event follows.
    account.key = undefined;
    yield* held.forget;
    yield* held.accountChanged;
    assert.deepEqual(held.current(), { admin: false });
    assert.deepEqual(published.at(-1), { admin: false });

    // The same account back is no admin until it is read again.
    account.key = "admin@luke.test";
    yield* held.accountChanged;
    assert.deepEqual(held.current(), { admin: false });
  }),
);

it.effect("a sign-out the same account returned from before its change landed still forgets", () =>
  Effect.gen(function* () {
    const { client } = service([json({ admin: true })]);
    const { held, published } = holder(client, "admin@luke.test");
    yield* held.refresh;

    // The gate closed and opened again before either change event was taken: both read the account back.
    yield* held.forget;
    yield* held.accountChanged;
    yield* held.accountChanged;
    assert.deepEqual(held.current(), { admin: false });
    assert.deepEqual(published.at(-1), { admin: false });
  }),
);

it.effect("an admin's read is no answer for another account signed in after it", () =>
  Effect.gen(function* () {
    const { client } = service([json({ admin: true }), json({ admin: false })]);
    const { held, account, published } = holder(client, "admin@luke.test");
    yield* held.refresh;

    account.key = "member@luke.test";
    yield* held.accountChanged;
    assert.deepEqual(held.current(), { admin: false });
    assert.deepEqual(published.at(-1), { admin: false });

    yield* held.refresh;
    assert.deepEqual(held.current(), { admin: false });
  }),
);

it.effect("a read answered after the account changed is kept for nobody", () =>
  Effect.gen(function* () {
    // The account signs out while the service is still answering.
    let whileAnswering = () => undefined;
    const accessClient = client(async () => {
      whileAnswering();
      return jsonResponse({ admin: true });
    });
    const { held, account, published } = holder(accessClient, "admin@luke.test");
    whileAnswering = () => {
      account.key = undefined;
    };

    yield* held.refresh;
    assert.deepEqual(held.current(), { admin: false });
    assert.deepEqual(published, []);

    account.key = "admin@luke.test";
    assert.deepEqual(held.current(), { admin: false });
  }),
);

it.effect("a read still out across a sign-out and the same account's return is dropped", () =>
  Effect.gen(function* () {
    let whileAnswering = () => undefined;
    const accessClient = client(async () => {
      whileAnswering();
      return jsonResponse({ admin: true });
    });
    const { held, published } = holder(accessClient, "admin@luke.test");
    // The gate closes and the same account signs back in while the read is out.
    whileAnswering = () => {
      Effect.runSync(held.forget);
      return undefined;
    };

    yield* held.refresh;
    assert.deepEqual(held.current(), { admin: false });
    assert.deepEqual(published, [{ admin: false }]);
  }),
);

it.effect("a read that fails, or answers no flag, is no admin", () =>
  Effect.gen(function* () {
    const failures = [
      json({ error: "unavailable" }, 503),
      json({ error: "invalid_token" }, 401),
      json({ admin: "yes" }),
      json({}),
      () => new Response("not json", { status: 200 }),
    ];
    for (const failure of failures) {
      const { held } = holder(service([failure]).client, "admin@luke.test");
      yield* held.refresh;
      assert.deepEqual(held.current(), { admin: false });
    }
    const refused = client(async () => {
      throw new Error("offline");
    });
    assert.equal(yield* refused.readAdmin(), false);
  }),
);

it.effect("nobody signed in asks the service nothing", () =>
  Effect.gen(function* () {
    const { requests, client } = service([json({ admin: true })]);
    const { held, published } = holder(client, undefined);
    yield* held.refresh;
    assert.equal(requests.length, 0);
    assert.deepEqual(published, []);
    assert.deepEqual(held.current(), { admin: false });
  }),
);
