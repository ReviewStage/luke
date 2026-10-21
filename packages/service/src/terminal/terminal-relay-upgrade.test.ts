import assert from "node:assert/strict";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import { test } from "vitest";
import { RELAY_UPGRADE_STATUS } from "../http/relay-upgrade.js";
import { admitRelayUpgrade } from "./service.js";

/**
 * Which upgrades the terminal relay takes, before any socket stands: only
 * its own path; from the desktop, which names no origin, only under a
 * bearer, as it always was; from a page, only from one of the deployment's
 * own origins and under its session cookie, read alone, so another site's
 * page carrying the member's cookie is refused whatever else it carries;
 * and only one naming an agent, a shell, and a size it can read.
 */

const AGENT = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const OWN_ORIGIN = "https://luke.example.test";
const OWN = new Set([OWN_ORIGIN]);
const BEARER = { authorization: "Bearer token-1" };
const COOKIE = "__Secure-better-auth.session_token=session-1";
const PAGE = { origin: OWN_ORIGIN, cookie: COOKIE };

function address(query: Record<string, string>, path: string = TERMINAL_RELAY.PATH): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

const ASKED = { agent: AGENT, terminal: SHELL, cols: "120", rows: "32" };
const ASK = { agentId: AGENT, terminalId: SHELL, cols: 120, rows: 32 };

test("the desktop's bearer with no origin is taken as it always was", () => {
  assert.deepEqual(admitRelayUpgrade(address(ASKED), BEARER, OWN), {
    credential: { bearer: "Bearer token-1" },
    ask: ASK,
  });
  assert.deepEqual(
    admitRelayUpgrade(address(ASKED), BEARER, new Set()),
    { credential: { bearer: "Bearer token-1" }, ask: ASK },
    "a deployment that owns no origin still takes the desktop",
  );
});

test("a page of the deployment's own origin is taken by its session cookie alone", () => {
  for (const headers of [PAGE, { ...PAGE, ...BEARER }]) {
    const admitted = admitRelayUpgrade(address(ASKED), headers, OWN);
    assert.ok("credential" in admitted && "page" in admitted.credential, JSON.stringify(headers));
    assert.deepEqual(
      [...admitted.credential.page.entries()],
      [["cookie", COOKIE]],
      "nothing but the cookie names the page's account, an Authorization beside it least of all",
    );
    assert.deepEqual(admitted.ask, ASK);
  }
});

test("another site's page is refused before any socket stands, whatever it carries", () => {
  for (const headers of [
    { ...PAGE, origin: "https://evil.test" },
    { ...BEARER, origin: "https://evil.test" },
    { ...PAGE, ...BEARER, origin: "https://evil.test" },
    { ...PAGE, origin: "null" },
    { ...PAGE, origin: "http://luke.example.test" },
    { ...PAGE, origin: "https://luke.example.test.evil.test" },
  ]) {
    assert.deepEqual(
      admitRelayUpgrade(address(ASKED), headers, OWN),
      { status: RELAY_UPGRADE_STATUS.FORBIDDEN },
      headers.origin,
    );
  }
  assert.deepEqual(
    admitRelayUpgrade(address(ASKED), PAGE, new Set()),
    { status: RELAY_UPGRADE_STATUS.FORBIDDEN },
    "a deployment that owns no origin takes no page's socket",
  );
});

test("a page with no cookie, a cookie with no page's origin, and a missing or blank bearer are refused", () => {
  const refused = (headers: Record<string, string>) =>
    admitRelayUpgrade(address(ASKED), headers, OWN);
  assert.deepEqual(refused({}), { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED });
  assert.deepEqual(refused({ authorization: "Bearer " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  assert.deepEqual(
    refused({ cookie: COOKIE }),
    { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED },
    "a cookie with no page's origin is no desktop's credential",
  );
  assert.deepEqual(
    refused({ ...BEARER, origin: OWN_ORIGIN }),
    { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED },
    "a page's bearer is never read",
  );
  assert.deepEqual(refused({ origin: OWN_ORIGIN, cookie: "  " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
});

test("another path and an unreadable ask are refused before any socket stands", () => {
  assert.deepEqual(admitRelayUpgrade(address(ASKED, "/api/voice/sessions"), BEARER, OWN), {
    status: RELAY_UPGRADE_STATUS.NOT_FOUND,
  });
  for (const unreadable of [
    { ...ASKED, agent: "not-an-id" },
    { ...ASKED, cols: "0" },
    { ...ASKED, rows: "100000" },
    { agent: AGENT, terminal: SHELL },
  ]) {
    for (const headers of [BEARER, PAGE]) {
      assert.deepEqual(admitRelayUpgrade(address(unreadable), headers, OWN), {
        status: RELAY_UPGRADE_STATUS.BAD_REQUEST,
      });
    }
  }
});
