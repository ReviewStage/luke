import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readFirewallLaunch } from "@repo/database/models/sandbox-firewall-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import { fixtureToken } from "../testing/runner-sandbox-fake.js";
import {
  composePolicy,
  type KeptLaunch,
  LAUNCH_SWAP,
  placeholderSwap,
  sandboxFirewall,
} from "./sandbox-firewall.js";
import { vercelSandboxApi } from "./vercel-sandbox-api.js";

/**
 * A sandbox session's firewall as the service writes it, over Vercel's
 * network-policy write answering from a script and a database of the
 * test's own: each write carries what its writer names beside the swaps the
 * session's launch keeps, the kept launch holds no value in the clear, its
 * end and a clear take the swaps off, a renewal lands only on the launch it
 * read, and a placeholder swap matches its header at the placeholder.
 * Synthetic accounts, sessions, agents, and tokens throughout.
 */

const REPOSITORY = "Acme/Relay";
const WRITE_TOKEN = "ghs_write_fixture";
const READ_TOKEN = "ghs_read_fixture";
const BEARER = "Bearer runner-bearer-fixture";
const APP = { kind: GITHUB_ACCESS.APP } as const;
const SERVICE_HOST = "app.service.test";

/** Git's Basic credentials for an installation token, as GitHub takes them. */
const basic = (token: string) =>
  `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

/** The runner's bearer swapped in on our host for the placeholder its launch holds. */
const BEARER_RULE = {
  match: {
    headers: [
      { key: { exact: "authorization" }, value: { exact: "Bearer runner-placeholder-fixture" } },
    ],
  },
  transform: [{ headers: { authorization: BEARER } }],
};

/** The write token on GitHub's two hosts. */
const WRITE_RULE = { transform: [{ headers: { authorization: basic(WRITE_TOKEN) } }] };

/** The clone's read token on the repository's git endpoint alone. */
const CLONE_RULE = {
  match: { path: { startsWith: `/${REPOSITORY}.git/` } },
  transform: [{ headers: { authorization: basic(READ_TOKEN) } }],
};

const write = { token: Redacted.make(WRITE_TOKEN), fullName: REPOSITORY, access: APP };
const read = { token: Redacted.make(READ_TOKEN), fullName: REPOSITORY, access: APP };

/** A swap on the host given, its placeholder and value as named. */
const swapOf = (domain: string, placeholder: string, value: string) =>
  placeholderSwap({
    domain,
    header: "authorization",
    placeholder: Redacted.make(placeholder),
    value: Redacted.make(value),
  });

/** A launch of the fixture agent holding the runner's bearer alone. */
const bearerLaunch = {
  agentId: "agent-fixture",
  swaps: new Map([
    [LAUNCH_SWAP.RUNNER, swapOf(SERVICE_HOST, "Bearer runner-placeholder-fixture", BEARER)],
  ]),
};

/** A sandbox session of its own, under an account of its own. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return { userId, sandboxSessionId: `sbs_${randomUUID()}` };
});

/** Vercel's network-policy write as the scenario has it: each policy kept as it lands, in that order. */
function vercel() {
  const landed: unknown[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    assert.ok(new URL(url).pathname.endsWith("/network-policy"), `an unexpected call: ${url}`);
    landed.push(JSON.parse(await new Response(init.body).text()));
    return Response.json({});
  });
  return { layer, landed };
}

/** The firewall over the scripted Vercel, and its services: the scripted Vercel, and the suite's key ring. */
const firewallOver = (layer: ReturnType<typeof vercel>["layer"]) =>
  Effect.map(vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(layer)), (api) => ({
    firewall: sandboxFirewall(api),
    services: Effect.provide(Layer.merge(layer, LOCAL_AGENT_ENVIRONMENT)),
  }));

it.layer(getTestDB())("a sandbox session's firewall", (it) => {
  it.effect(
    "each write carries what its writer names beside the launch's swaps, the kept launch holds no value in the clear, and its end and a clear take the swaps off",
    () =>
      Effect.gen(function* () {
        const api = vercel();
        const session = yield* ownSession;
        const { firewall, services } = yield* firewallOver(api.layer);

        const kept = yield* Effect.gen(function* () {
          yield* firewall.keepLaunch(session, bearerLaunch);
          yield* firewall.write(session, { github: write });
          yield* firewall.write(session, { github: write, clone: read });
          const row = yield* readFirewallLaunch(session);
          yield* firewall.endLaunch(session, { github: write });
          yield* firewall.write(session, {});
          yield* firewall.keepLaunch(session, bearerLaunch);
          yield* firewall.clear(session.sandboxSessionId);
          return row;
        }).pipe(services);

        assert.deepEqual(api.landed, [
          {
            allow: {
              "*": [],
              "github.com": [WRITE_RULE],
              "api.github.com": [WRITE_RULE],
              [SERVICE_HOST]: [BEARER_RULE],
            },
          },
          {
            allow: {
              "*": [],
              "github.com": [WRITE_RULE, CLONE_RULE],
              "api.github.com": [WRITE_RULE],
              [SERVICE_HOST]: [BEARER_RULE],
            },
          },
          { allow: { "*": [], "github.com": [WRITE_RULE], "api.github.com": [WRITE_RULE] } },
          { mode: "allow-all" },
          { mode: "allow-all" },
        ]);
        assert.ok(kept !== undefined);
        assert.equal(kept.agentId, "agent-fixture");
        for (const value of [BEARER, "runner-placeholder-fixture"]) {
          assert.equal(kept.sealedEntries.includes(value), false);
        }
        assert.equal(yield* readFirewallLaunch(session), undefined);
      }),
  );

  it.effect(
    "a renewal lands only on the launch it read, so one racing a relaunch leaves the new runner's swaps standing",
    () =>
      Effect.gen(function* () {
        const api = vercel();
        const session = yield* ownSession;
        const { firewall, services } = yield* firewallOver(api.layer);
        const planLaunch = (placeholder: string, token: string) => ({
          agentId: "agent-fixture",
          swaps: new Map([
            [LAUNCH_SWAP.OPENAI_PLAN, swapOf("api.openai.test", placeholder, token)],
          ]),
        });
        const planRule = (placeholder: string, token: string) => ({
          match: { headers: [{ key: { exact: "authorization" }, value: { exact: placeholder } }] },
          transform: [{ headers: { authorization: token } }],
        });

        const renewals = yield* Effect.gen(function* () {
          yield* firewall.keepLaunch(session, planLaunch("Bearer first-placeholder", "Bearer one"));
          const first = yield* firewall.launchOf(session);
          yield* firewall.keepLaunch(
            session,
            planLaunch("Bearer second-placeholder", "Bearer two"),
          );
          const second = yield* firewall.launchOf(session);
          assert.ok(first !== undefined && second !== undefined);
          const renew = (launch: KeptLaunch, placeholder: string) =>
            firewall.renew(
              session,
              launch,
              LAUNCH_SWAP.OPENAI_PLAN,
              swapOf("api.openai.test", placeholder, "Bearer three"),
              {},
            );
          const stale = yield* renew(first, "Bearer first-placeholder");
          const current = yield* renew(second, "Bearer second-placeholder");
          yield* firewall.write(session, {});
          return [stale, current];
        }).pipe(services);

        assert.deepEqual(renewals, [false, true]);
        const renewed = {
          allow: {
            "*": [],
            "api.openai.test": [planRule("Bearer second-placeholder", "Bearer three")],
          },
        };
        assert.deepEqual(api.landed, [renewed, renewed]);
      }),
  );
});

it("a placeholder swap is a rule on its domain matching its header at the placeholder, which sets the real value", () => {
  const swap = placeholderSwap({
    domain: "api.provider.test",
    header: "x-api-key",
    placeholder: Redacted.make("placeholder-fixture"),
    value: Redacted.make("secret-fixture"),
  });

  assert.deepEqual(composePolicy({}, new Map([[LAUNCH_SWAP.CLAUDE, swap]])), {
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
