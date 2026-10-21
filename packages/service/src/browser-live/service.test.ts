import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_LIVE } from "@luke/features/browser-live-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { test } from "vitest";
import { RELAY_UPGRADE_STATUS } from "../terminal/service.js";
import {
  admitBrowserLiveAccount,
  admitBrowserLiveUpgrade,
  type BrowserLiveAdmission,
  type BrowserLiveCredential,
} from "./service.js";

/**
 * Which upgrades the live view takes, before any socket stands: only its
 * own path naming a task and a tab; from the desktop, which names no
 * origin, only under a bearer; from a page, only from one of the
 * deployment's own, under its session cookie; and only for an account that
 * resolves and reaches the tab. Anything else is refused with a status and
 * never upgraded.
 */

const TASK = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const TAB = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const OWN_ORIGIN = "https://luke.example.test";
const OWN = new Set([OWN_ORIGIN]);
const BEARER = { authorization: "Bearer token-1" };
const COOKIE = { origin: OWN_ORIGIN, cookie: "__Secure-better-auth.session_token=session-1" };

function address(query: Record<string, string>, path: string = BROWSER_LIVE.PATH): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

const ASKED = { task: TASK, tab: TAB };

test("the desktop's bearer with no origin, and a page of the deployment's own with its cookie, are each taken", () => {
  assert.deepEqual(admitBrowserLiveUpgrade(address(ASKED), BEARER, OWN), {
    credential: { bearer: "Bearer token-1" },
    ask: { taskId: TASK, tabId: TAB },
  });
  const page = admitBrowserLiveUpgrade(address(ASKED), COOKIE, OWN);
  assert.ok("credential" in page && "page" in page.credential);
  assert.equal(page.credential.page.get("cookie"), COOKIE.cookie);
  assert.deepEqual(page.ask, { taskId: TASK, tabId: TAB });
});

test("no credential, another site's origin, and a page's bearer without a cookie are refused before any socket stands", () => {
  const refused = (headers: Record<string, string>) =>
    admitBrowserLiveUpgrade(address(ASKED), headers, OWN);
  assert.deepEqual(refused({}), { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED });
  assert.deepEqual(refused({ authorization: "Bearer " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  assert.deepEqual(
    refused({ cookie: COOKIE.cookie }),
    {
      status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
    },
    "a cookie with no page's origin is no desktop's credential",
  );
  assert.deepEqual(refused({ ...COOKIE, origin: "https://evil.test" }), {
    status: RELAY_UPGRADE_STATUS.FORBIDDEN,
  });
  assert.deepEqual(refused({ ...BEARER, origin: "https://evil.test" }), {
    status: RELAY_UPGRADE_STATUS.FORBIDDEN,
  });
  assert.deepEqual(refused({ ...BEARER, origin: OWN_ORIGIN }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  assert.deepEqual(
    admitBrowserLiveUpgrade(address(ASKED), COOKIE, new Set()),
    {
      status: RELAY_UPGRADE_STATUS.FORBIDDEN,
    },
    "a deployment that owns no origin takes no page's socket",
  );
});

test("another path and an unreadable task or tab are refused", () => {
  assert.deepEqual(admitBrowserLiveUpgrade(address(ASKED, "/api/terminal/sessions"), BEARER, OWN), {
    status: RELAY_UPGRADE_STATUS.NOT_FOUND,
  });
  for (const unreadable of [{ ...ASKED, tab: "not-an-id" }, { task: TASK }]) {
    assert.deepEqual(admitBrowserLiveUpgrade(address(unreadable), BEARER, OWN), {
      status: RELAY_UPGRADE_STATUS.BAD_REQUEST,
    });
  }
});

const REACHED: ReachedBrowserTab = {
  tab: {
    id: TAB,
    conversationId: "conversation-1",
    taskId: TASK,
    targetId: "page-1",
    address: "https://example.test/",
    title: "Example",
    openedBy: AGENT_BROWSER_TAB_OPENER.AGENT,
    openedByUserId: null,
    driverUserId: null,
    heldUntil: null,
    createdAt: new Date(0),
    lastActedAt: new Date(0),
  },
  agent: { id: "agent-1", userId: "starter-1", githubAccess: GITHUB_ACCESS.APP },
};

/** An account store that answers the bearer and cookie given for their members, and a tab store reached by one member alone. */
const admission: BrowserLiveAdmission = {
  resolveUserId: (credential: BrowserLiveCredential) =>
    Effect.succeed(
      "bearer" in credential
        ? Option.some("member-1").pipe(
            Option.filter(() => credential.bearer === BEARER.authorization),
          )
        : Option.some("member-2").pipe(
            Option.filter(() => credential.page.get("cookie") === COOKIE.cookie),
          ),
    ),
  readTab: (userId, taskId, tabId) =>
    Effect.succeed(
      userId === "member-1" && taskId === TASK && tabId === TAB
        ? Option.some(REACHED)
        : Option.none(),
    ),
};

const ASK = { taskId: TASK, tabId: TAB };

it.effect(
  "only an account that resolves and reaches the tab is admitted; any other is refused before any socket stands",
  () =>
    Effect.gen(function* () {
      const admitted = yield* admitBrowserLiveAccount(
        { credential: { bearer: BEARER.authorization }, ask: ASK },
        admission,
      );
      assert.deepEqual(admitted, { ask: { ...ASK, userId: "member-1" }, reached: REACHED });

      const unknown = yield* admitBrowserLiveAccount(
        { credential: { bearer: "Bearer other" }, ask: ASK },
        admission,
      );
      assert.deepEqual(unknown, { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED });

      const page = new Headers({ cookie: COOKIE.cookie });
      const unreached = yield* admitBrowserLiveAccount(
        { credential: { page }, ask: ASK },
        admission,
      );
      assert.deepEqual(
        unreached,
        { status: RELAY_UPGRADE_STATUS.NOT_FOUND },
        "a tab the member cannot read is not found",
      );

      const outage = yield* admitBrowserLiveAccount(
        { credential: { bearer: BEARER.authorization }, ask: ASK },
        { ...admission, readTab: () => Effect.fail("store down") },
      );
      assert.deepEqual(outage, { status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE });
    }),
);
