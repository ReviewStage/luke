import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readStandingFirewall } from "@repo/database/models/sandbox-firewall-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Fiber, Layer, Redacted } from "effect";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import { fixtureToken } from "../testing/runner-sandbox-fake.js";
import {
  cloneEntry,
  composePolicy,
  FIREWALL_SLOT,
  githubEntry,
  placeholderSwap,
  renewedSwap,
  sandboxFirewall,
} from "./sandbox-firewall.js";
import { vercelSandboxApi } from "./vercel-sandbox-api.js";

/**
 * A sandbox session's firewall as the service writes it, over Vercel's
 * network-policy write answering from a script and a database of the
 * test's own: each slot's write keeps what the others set, the record holds
 * no value in the clear, a clear leaves the open internet and no record, a
 * send that lands after a later write's is followed by what stands, and a
 * placeholder swap matches its header at the placeholder. Synthetic
 * accounts, sessions, and tokens throughout.
 */

const REPOSITORY = "Acme/Relay";
const WRITE_TOKEN = "ghs_write_fixture";
const READ_TOKEN = "ghs_read_fixture";
const APP = { kind: GITHUB_ACCESS.APP } as const;

/** Git's Basic credentials for an installation token, as GitHub takes them. */
const basic = (token: string) =>
  `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

/** The write token on GitHub's two hosts, every other host open. */
const WRITE_ONLY = {
  allow: {
    "*": [],
    "github.com": [{ transform: [{ headers: { authorization: basic(WRITE_TOKEN) } }] }],
    "api.github.com": [{ transform: [{ headers: { authorization: basic(WRITE_TOKEN) } }] }],
  },
};

/** The write token as above, and beside it on git's host the clone's read token on the repository's git endpoint alone. */
const WRITE_AND_CLONE = {
  allow: {
    "*": [],
    "github.com": [
      { transform: [{ headers: { authorization: basic(WRITE_TOKEN) } }] },
      {
        match: { path: { startsWith: `/${REPOSITORY}.git/` } },
        transform: [{ headers: { authorization: basic(READ_TOKEN) } }],
      },
    ],
    "api.github.com": [{ transform: [{ headers: { authorization: basic(WRITE_TOKEN) } }] }],
  },
};

const writeEntry = githubEntry({
  token: Redacted.make(WRITE_TOKEN),
  fullName: REPOSITORY,
  access: APP,
});
const readEntry = cloneEntry(REPOSITORY, Redacted.make(READ_TOKEN), APP);

/** A sandbox session of its own, under an account of its own. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return { userId, sandboxSessionId: `sbs_${randomUUID()}` };
});

/**
 * Vercel's network-policy write as the scenario has it: each policy kept as
 * it lands, in that order; where `holdFirst`, the first write arrives and
 * waits until the test lets it land.
 */
function vercel(holdFirst = false) {
  const landed: unknown[] = [];
  let arrive = () => {};
  let release = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const layer = fakeHttpClientLayer(async (url, init) => {
    assert.ok(new URL(url).pathname.endsWith("/network-policy"), `an unexpected call: ${url}`);
    const policy = JSON.parse(await new Response(init.body).text());
    writes += 1;
    if (holdFirst && writes === 1) {
      arrive();
      await released;
    }
    landed.push(policy);
    return Response.json({});
  });
  return { layer, landed, arrived, release };
}

/** The firewall over the scripted Vercel, its record sealed under the suite's key ring. */
const firewallOver = (layer: ReturnType<typeof vercel>["layer"]) =>
  Effect.map(
    vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(layer)),
    sandboxFirewall,
  );

/** The firewall's services: the scripted Vercel, and the suite's key ring. */
const services = (layer: ReturnType<typeof vercel>["layer"]) =>
  Effect.provide(Layer.merge(layer, LOCAL_AGENT_ENVIRONMENT));

it.layer(getTestDB())("a sandbox session's firewall", (it) => {
  it.effect(
    "each slot's write keeps what the others set, the record holds no value in the clear, and a clear leaves the open internet and no record",
    () =>
      Effect.gen(function* () {
        const api = vercel();
        const session = yield* ownSession;
        const firewall = yield* firewallOver(api.layer);

        const record = yield* Effect.gen(function* () {
          yield* firewall.set(session, FIREWALL_SLOT.GITHUB, writeEntry);
          yield* firewall.set(session, FIREWALL_SLOT.GITHUB_CLONE, readEntry);
          yield* firewall.withdraw(session, FIREWALL_SLOT.GITHUB_CLONE);
          const kept = yield* readStandingFirewall(session);
          yield* firewall.clear(session.sandboxSessionId);
          return kept;
        }).pipe(services(api.layer));

        assert.deepEqual(api.landed, [
          WRITE_ONLY,
          WRITE_AND_CLONE,
          WRITE_ONLY,
          { mode: "allow-all" },
        ]);
        assert.ok(record !== undefined);
        for (const value of [WRITE_TOKEN, basic(WRITE_TOKEN)]) {
          assert.equal(record.sealedEntries.includes(value), false);
        }
        assert.equal(yield* readStandingFirewall(session), undefined);
      }),
  );

  it.effect(
    "a send that lands after a later write's is followed by what stands, so the later write's entry is not lost",
    () =>
      Effect.gen(function* () {
        const api = vercel(true);
        const session = yield* ownSession;
        const firewall = yield* firewallOver(api.layer);

        const first = yield* Effect.forkChild(
          firewall.set(session, FIREWALL_SLOT.GITHUB, writeEntry).pipe(services(api.layer)),
        );
        yield* Effect.promise(() => api.arrived);
        yield* firewall
          .set(session, FIREWALL_SLOT.GITHUB_CLONE, readEntry)
          .pipe(services(api.layer));
        api.release();
        yield* Fiber.join(first);

        // The later write landed first, the earlier one's stale policy after it, and then what stands.
        assert.deepEqual(api.landed, [WRITE_AND_CLONE, WRITE_ONLY, WRITE_AND_CLONE]);
      }),
  );

  it.effect(
    "a renewal sets a new value behind the same placeholder only where its slot stands, narrows a swap to the path it names, and writes nothing where it finds nothing new",
    () =>
      Effect.gen(function* () {
        const api = vercel();
        const session = yield* ownSession;
        const firewall = yield* firewallOver(api.layer);
        const path = { startsWith: "/v1/" };
        const swapOf = (value: string, under?: typeof path) =>
          placeholderSwap({
            domain: "api.provider.test",
            ...(under === undefined ? undefined : { path: under }),
            header: "authorization",
            placeholder: Redacted.make("Bearer placeholder-fixture"),
            value: Redacted.make(value),
          });
        const renewTo = (value: string, under?: typeof path) =>
          firewall.renew(session, FIREWALL_SLOT.OPENAI_PLAN, (standing) =>
            Effect.succeed(renewedSwap(standing, Redacted.make(value), under)),
          );

        const renewals = yield* Effect.gen(function* () {
          yield* firewall.set(session, FIREWALL_SLOT.OPENAI_PLAN, swapOf("Bearer first-fixture"));
          const changed = yield* renewTo("Bearer second-fixture");
          const unchanged = yield* renewTo("Bearer second-fixture");
          // The same value, held to a path the standing swap was set without.
          const narrowed = yield* renewTo("Bearer second-fixture", path);
          const narrowedAgain = yield* renewTo("Bearer second-fixture", path);
          yield* firewall.withdraw(session, FIREWALL_SLOT.OPENAI_PLAN);
          const afterWithdraw = yield* renewTo("Bearer third-fixture");
          return [changed, unchanged, narrowed, narrowedAgain, afterWithdraw];
        }).pipe(services(api.layer));

        assert.deepEqual(renewals, [true, false, true, false, false]);
        assert.deepEqual(api.landed, [
          composePolicy(new Map([[FIREWALL_SLOT.OPENAI_PLAN, swapOf("Bearer first-fixture")]])),
          composePolicy(new Map([[FIREWALL_SLOT.OPENAI_PLAN, swapOf("Bearer second-fixture")]])),
          composePolicy(
            new Map([[FIREWALL_SLOT.OPENAI_PLAN, swapOf("Bearer second-fixture", path)]]),
          ),
          { mode: "allow-all" },
        ]);
        assert.equal(yield* readStandingFirewall(session), undefined);
      }),
  );
});

it("a placeholder swap is a rule on its domain matching its header at the placeholder, which sets the real value", () => {
  // Note that any slot carries any entry; the swap's own slots come with the credentials that use it.
  const swap = placeholderSwap({
    domain: "api.provider.test",
    header: "x-api-key",
    placeholder: Redacted.make("placeholder-fixture"),
    value: Redacted.make("secret-fixture"),
  });

  assert.deepEqual(composePolicy(new Map([[FIREWALL_SLOT.GITHUB, swap]])), {
    allow: {
      "*": [],
      "api.provider.test": [
        {
          match: {
            headers: [{ key: { exact: "x-api-key" }, value: { exact: "placeholder-fixture" } }],
          },
          transform: [{ headers: { "x-api-key": "secret-fixture" } }],
        },
      ],
    },
  });
});
