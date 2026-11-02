import assert from "node:assert/strict";
import { PAGE_SANDBOX_ORIGIN } from "@luke/features/page-frame";
import { PAGE_OWNER } from "@luke/features/page-wire";
import { REDACTED, scrubbedUrl } from "@luke/features/sentry-addresses";
import { Redacted } from "effect";
import { it } from "vitest";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";
import {
  AGENT_PAGES_ENVIRONMENT,
  mintPageLink,
  PAGE_LINK_ROUTE,
  type PageSandbox,
  pageSandboxIn,
  readPageLink,
} from "./page-links.js";

/**
 * A page's link on the sandbox's own site: a link whose claims were changed,
 * that another key signed, or that was minted for another sandbox admits
 * nothing; a link's address reaches Sentry with its token redacted; and the
 * environment names a sandbox only where it names both variables, a key of
 * its own of 32 characters or more, and the one origin the routing locks,
 * saying why by the variables' names where it does not. A link's lifetime
 * and its reach are `page-sandbox.test.ts`'s.
 *
 * Synthetic keys, accounts, and pages throughout.
 */

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

/** A production deployment's own address, which its app is served from. */
const PRODUCTION = { VERCEL_ENV: "production", BETTER_AUTH_URL: "https://tryluke.dev" } as const;

/** A link's token, as the sandbox's routing hands it to the page route. */
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

it("the environment's sandbox is the routing's own origin, signed with the key it names, framed by the deployment's own origins", () => {
  const { sandbox, unset } = pageSandboxIn({
    ...PRODUCTION,
    [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY,
    [AGENT_PAGES_ENVIRONMENT.ORIGIN]: `${PAGE_SANDBOX_ORIGIN}/`,
  });

  assert.equal(unset, undefined);
  assert.ok(sandbox !== undefined);
  assert.deepEqual(
    { origin: sandbox.origin, key: Redacted.value(sandbox.key), appOrigins: sandbox.appOrigins },
    { origin: PAGE_SANDBOX_ORIGIN, key: KEY, appOrigins: ["https://tryluke.dev"] },
  );
});

it.each([
  ["neither variable", {}, false],
  ["the key alone", { [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY }, true],
  ["the origin alone", { [AGENT_PAGES_ENVIRONMENT.ORIGIN]: PAGE_SANDBOX_ORIGIN }, true],
  [
    "a key of 31 characters",
    {
      [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY.slice(0, 31),
      [AGENT_PAGES_ENVIRONMENT.ORIGIN]: PAGE_SANDBOX_ORIGIN,
    },
    true,
  ],
  [
    "a key the cron's secret holds too",
    {
      [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY,
      [AGENT_PAGES_ENVIRONMENT.ORIGIN]: PAGE_SANDBOX_ORIGIN,
      [CRON_ENVIRONMENT.CRON_SECRET]: KEY,
    },
    true,
  ],
  [
    "an origin the routing does not lock",
    {
      [AGENT_PAGES_ENVIRONMENT.SECRET]: KEY,
      [AGENT_PAGES_ENVIRONMENT.ORIGIN]: "https://pages.tryluke.dev",
    },
    true,
  ],
] as const)("an environment naming %s names no sandbox", (_, variables, said) => {
  const { sandbox, unset } = pageSandboxIn({ ...PRODUCTION, ...variables });

  assert.equal(sandbox, undefined);
  assert.equal(unset !== undefined, said);
  // A warning names the variables, never a value.
  assert.ok(!(unset ?? "").includes(KEY.slice(0, 31)));
});
