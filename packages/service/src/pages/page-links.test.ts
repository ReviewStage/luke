import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { REDACTED, scrubbedUrl } from "@repo/features/sentry-addresses";
import { Effect, Logger, Redacted } from "effect";
import { afterEach, vi } from "vitest";
import {
  AUTH_DEPLOYMENT_ENVIRONMENT,
  AUTH_SECRET_ENVIRONMENT,
  DEPLOYMENT_ENVIRONMENT,
} from "../auth/auth-deployment.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";
import {
  AGENT_PAGES_ENVIRONMENT,
  mintPageLink,
  PAGE_LINK_ROUTE,
  PageLinks,
  type PageSandbox,
  pageLinksFromEnvironment,
  readPageLink,
} from "./page-links.js";

const KEY = "synthetic-page-link-key-for-tests-only-0000";

const SANDBOX: PageSandbox = {
  origin: PAGE_SANDBOX_ORIGIN,
  key: Redacted.make(KEY),
  appOrigins: ["https://tryluke.dev"],
};

const PAGE = {
  userId: "user-1",
  owner: { kind: PAGE_OWNER.TASK, taskId: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b" },
  pageId: "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01",
  version: 2,
} as const;

const MINTED_AT = Date.parse("2026-11-02T03:00:00Z");

const PRODUCTION = {
  [AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT]: DEPLOYMENT_ENVIRONMENT.PRODUCTION,
  [AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL]: "https://tryluke.dev",
} as const;

const NAMED = {
  ...PRODUCTION,
  [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY,
  [AGENT_PAGES_ENVIRONMENT.ORIGIN]: PAGE_SANDBOX_ORIGIN,
} as const;

const READ = [
  AGENT_PAGES_ENVIRONMENT.SECRET,
  AGENT_PAGES_ENVIRONMENT.ORIGIN,
  ...Object.values(AUTH_DEPLOYMENT_ENVIRONMENT),
  AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
  CRON_ENVIRONMENT.CRON_SECRET,
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

const linksOver = (variables: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      for (const name of READ) vi.stubEnv(name, variables[name]);
    });
    const logged: string[] = [];
    const recorder = Logger.make(({ message }) => {
      logged.push(JSON.stringify(message));
    });
    const { sandbox } = yield* Effect.provide(PageLinks, pageLinksFromEnvironment).pipe(
      Effect.provide(Logger.layer([recorder])),
    );
    return { sandbox, logged };
  });

const tokenOf = (link: string) => new URL(link).pathname.slice(`/${PAGE_LINK_ROUTE.STEP}/`.length);

it("a link whose claims were changed, that another key signed, or that was minted for another sandbox admits nothing", () => {
  const token = tokenOf(mintPageLink(SANDBOX, PAGE, MINTED_AT));
  const [, signature] = token.split(".");
  const [anotherPage] = tokenOf(
    mintPageLink(SANDBOX, { ...PAGE, pageId: "9d1e2c3b-4a5f-4e6d-8c7b-0a1f2e3d4c5b" }, MINTED_AT),
  ).split(".");
  const anotherKey = { ...SANDBOX, key: Redacted.make(`${KEY}-another`) };
  const anotherSandbox = { ...SANDBOX, origin: "https://elsewhere.example" };

  assert.deepEqual(readPageLink(SANDBOX, token, MINTED_AT), PAGE);
  for (const forged of [
    `${anotherPage}.${signature}`,
    tokenOf(mintPageLink(anotherKey, PAGE, MINTED_AT)),
    tokenOf(mintPageLink(anotherSandbox, PAGE, MINTED_AT)),
    `${token}.${signature}`,
    "",
  ]) {
    assert.equal(readPageLink(SANDBOX, forged, MINTED_AT), undefined, forged);
  }
});

it("a link's address reaches Sentry with its host kept and its token redacted", () => {
  assert.equal(
    scrubbedUrl(mintPageLink(SANDBOX, PAGE, MINTED_AT)),
    `${PAGE_SANDBOX_ORIGIN}/${PAGE_LINK_ROUTE.STEP}/${REDACTED}`,
  );
});

it.effect(
  "production's environment names a sandbox on the routing's own origin, signed with the key it names, framed by the deployment's own origins, and its build says nothing",
  () =>
    Effect.gen(function* () {
      const { sandbox, logged } = yield* linksOver({
        ...NAMED,
        [AGENT_PAGES_ENVIRONMENT.ORIGIN]: `${PAGE_SANDBOX_ORIGIN}/`,
      });

      assert.ok(sandbox !== undefined);
      assert.deepEqual(
        {
          origin: sandbox.origin,
          key: Redacted.value(sandbox.key),
          appOrigins: sandbox.appOrigins,
        },
        { origin: PAGE_SANDBOX_ORIGIN, key: KEY, appOrigins: ["https://tryluke.dev"] },
      );
      assert.deepEqual(logged, []);
    }),
);

it.effect.each([
  { names: "neither variable", variables: PRODUCTION, said: false },
  {
    names: "both on a Preview",
    variables: {
      ...NAMED,
      [AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT]: DEPLOYMENT_ENVIRONMENT.PREVIEW,
    },
    said: true,
  },
  {
    names: "the key without the origin",
    variables: { ...PRODUCTION, [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY },
    said: true,
  },
  {
    names: "a key of 31 characters",
    variables: { ...NAMED, [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY.slice(0, 31) },
    said: true,
  },
  {
    names: "a key the cron's secret holds too",
    variables: { ...NAMED, [CRON_ENVIRONMENT.CRON_SECRET]: KEY },
    said: true,
  },
  {
    names: "an origin the routing does not lock",
    variables: { ...NAMED, [AGENT_PAGES_ENVIRONMENT.ORIGIN]: "https://pages.tryluke.dev" },
    said: true,
  },
])("an environment naming $names names no sandbox", ({ variables, said }) =>
  Effect.gen(function* () {
    const { sandbox, logged } = yield* linksOver(variables);

    assert.equal(sandbox, undefined);
    assert.equal(logged.length, said ? 1 : 0);
    assert.ok(logged.every((line) => !line.includes(KEY.slice(0, 31))));
  }),
);
