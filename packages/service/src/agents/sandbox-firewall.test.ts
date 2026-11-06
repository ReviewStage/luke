import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readFirewallLaunch } from "@repo/database/models/sandbox-firewall-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openTaskAgent, openWorkspace } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Layer, Redacted } from "effect";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import {
  fixtureToken,
  sandboxFetchOver,
  sandboxFound,
  sessionAnswered,
} from "../testing/vercel-sandbox-fake.js";
import {
  composePolicy,
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
 * end and a clear take the swaps off, a renewal's token is what every later
 * write sends, and a placeholder swap matches its header at the placeholder.
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

/** A launch of the agent given holding the runner's bearer alone. */
const bearerLaunch = (agentId: string) => ({
  agentId,
  swaps: new Map([
    [LAUNCH_SWAP.RUNNER, swapOf(SERVICE_HOST, "Bearer runner-placeholder-fixture", BEARER)],
  ]),
});

/** A sandbox session of its own, in a sandbox of its own, of an agent of an account of its own. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const agentId = yield* openTaskAgent(userId, yield* openWorkspace(userId), null);
  return {
    userId,
    agentId,
    name: `sandbox-${randomUUID()}`,
    sandboxSessionId: `sbs_${randomUUID()}`,
  };
});

/** Vercel as the scenario has it: the session's sandbox found running it, and each policy kept as it lands, in that order. */
function vercel(session: Effect.Success<typeof ownSession>) {
  const landed: unknown[] = [];
  const layer = sandboxFetchOver(async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === `/api/v2/sandboxes/${session.name}`) {
      return Response.json(
        sandboxFound({
          name: session.name,
          status: "running",
          currentSessionId: session.sandboxSessionId,
          createdAt: 0,
        }),
      );
    }
    assert.equal(
      pathname,
      `/api/v2/sandboxes/sessions/${session.sandboxSessionId}/network-policy`,
      `an unexpected call: ${url}`,
    );
    landed.push(JSON.parse(await new Response(init.body).text()));
    return Response.json(sessionAnswered({ id: session.sandboxSessionId, status: "running" }));
  });
  return { layer, landed };
}

/** The firewall over the scripted Vercel, and its services: the scripted Vercel, and the suite's key ring. */
const firewallOver = (layer: Layer.Layer<never>) =>
  Effect.map(vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(layer)), (api) => ({
    firewall: sandboxFirewall(api),
    services: Effect.provide(Layer.merge(layer, LOCAL_AGENT_ENVIRONMENT)),
  }));

it.layer(getTestDB())("a sandbox session's firewall", (it) => {
  it.effect(
    "each write carries what its writer names beside the launch's swaps, the kept launch holds no value in the clear, and a clear deletes it and sends nothing",
    () =>
      Effect.gen(function* () {
        const session = yield* ownSession;
        const api = vercel(session);
        const { firewall, services } = yield* firewallOver(api.layer);

        const kept = yield* Effect.gen(function* () {
          yield* firewall.keepLaunch(session, bearerLaunch(session.agentId));
          yield* firewall.write(session, { github: write });
          yield* firewall.write(session, { github: write, clone: read });
          const row = yield* readFirewallLaunch(session);
          yield* firewall.clear({ name: session.name, sessionId: session.sandboxSessionId });
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
        ]);
        assert.ok(kept !== undefined);
        assert.equal(kept.agentId, session.agentId);
        for (const value of [BEARER, "runner-placeholder-fixture"]) {
          assert.equal(kept.sealedEntries.includes(value), false);
        }
        assert.equal(yield* readFirewallLaunch(session), undefined);
      }),
  );

  it.effect(
    "a renewal sets the plan's new token behind the launch's placeholder, which every write after sends",
    () =>
      Effect.gen(function* () {
        const session = yield* ownSession;
        const api = vercel(session);
        const { firewall, services } = yield* firewallOver(api.layer);
        const placeholder = "Bearer plan-placeholder-fixture";

        yield* Effect.gen(function* () {
          yield* firewall.keepLaunch(session, {
            agentId: session.agentId,
            swaps: new Map([
              [LAUNCH_SWAP.OPENAI_PLAN, swapOf("api.openai.test", placeholder, "Bearer one")],
            ]),
          });
          const launch = yield* firewall.launchOf(session);
          assert.ok(launch !== undefined);
          yield* firewall.renew(
            session,
            launch,
            LAUNCH_SWAP.OPENAI_PLAN,
            swapOf("api.openai.test", placeholder, "Bearer two"),
            {},
          );
          yield* firewall.write(session, {});
        }).pipe(services);

        const renewed = {
          allow: {
            "*": [],
            "api.openai.test": [
              {
                match: {
                  headers: [{ key: { exact: "authorization" }, value: { exact: placeholder } }],
                },
                transform: [{ headers: { authorization: "Bearer two" } }],
              },
            ],
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
