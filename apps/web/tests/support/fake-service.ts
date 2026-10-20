/**
 * fake-service.ts -- the hosted service as a web client's test meets it: a cookie session the test signs in and out, a task list, a Slack sign-in under way, Notion's sign-in and a workspace's GitHub installation addresses, an empty issue list, the repositories the Luke GitHub App reaches, the account's link choice, and nothing else, answered over a fake `HttpClient`.
 *
 * The Slack sign-in is settled only by the settling POST, as the service
 * answers a cookie caller. The web client's host calls the origin that
 * served it, which jsdom names `http://localhost:3000`. A route the fake does not hold answers 404, which
 * every client reads as unanswered, so a test states only what it reads.
 * The session is the browser's cookie in a real tab: here it is whatever the
 * test last set, read on every `get-session`, so "the cookie changed" is
 * one call.
 */

import type { LinkOpen } from "@luke/features/link-open";
import type { WireValue } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import type { Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";

/** Who a signed-in session names. */
const SIGNED_IN_USER = {
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada Lovelace",
  // How Better Auth names the way they last signed in, as the wire spells it.
  lastLoginMethod: "github",
} as const;

/** One task the fake lists, as the plan list summarises it. */
export const LISTED_TASK = {
  id: "4f0b6a0e-6f3c-4a43-9d0f-0d6a4e0b1c21",
  workspaceId: "workspace-ada",
  name: "Draw the analytical engine",
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  repository: null,
} as const;

/** Where the fake sends a browser to sign in to Notion. */
export const NOTION_SIGN_IN = "https://notion.example/oauth/authorize";

/** Where the fake sends a browser to install the GitHub App on a workspace. */
export const GITHUB_INSTALL = "https://github.com/apps/luke/installations/new";

/** One request the fake answered: its method and path, never a header. */
interface SeenRequest {
  readonly method: string;
  readonly path: string;
}

export interface FakeService {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  /** What the cookie names from now on: the signed-in user, or nobody. */
  readonly setSession: (signedIn: boolean) => void;
  /** Each request the fake answered, in order. */
  readonly seen: () => readonly SeenRequest[];
}

/** An answer as the service writes one: JSON, with the status given. */
function json(body: WireValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The one member of every workspace the fake service reads. */
export const WORKSPACE_MEMBER = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "owner",
} as const;

/** The repositories the account reaches through the Luke GitHub App: the App installed, reaching none yet. */
export const GITHUB_REPOSITORIES = {
  installed: true,
  repositories: [],
  installationUrl: "https://github.com/apps/luke/installations/new",
} as const;

/** How the fake starts: signed in or not, and where the account chose its Luke links open, if it chose. */
interface FakeServiceOptions {
  readonly signedIn: boolean;
  readonly linkOpen?: LinkOpen;
}

/** The fake service, signed in or not as it starts. */
export function fakeService(options: FakeServiceOptions): FakeService {
  let signedIn = options.signedIn;
  const seen: SeenRequest[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    seen.push({ method, path: pathname });
    if (pathname === "/api/auth/get-session") {
      return json(signedIn ? { user: SIGNED_IN_USER } : null);
    }
    if (pathname === "/api/auth/sign-out" && method === "POST") {
      signedIn = false;
      return json({ success: true });
    }
    // A sign-in to Slack under way: the cookie's GET reads it as stored, and only the POST settles it.
    if (pathname === "/api/account/integrations" && method === "GET" && signedIn) {
      return json({ integrations: { slack: "pending" } });
    }
    if (pathname === "/api/account/integrations/settle" && method === "POST" && signedIn) {
      return json({ integrations: { slack: "connected" } });
    }
    if (pathname === "/api/account/integrations/notion/connect" && method === "POST" && signedIn) {
      return json({ url: NOTION_SIGN_IN });
    }
    if (pathname === "/api/workspaces/github/connect" && method === "POST" && signedIn) {
      return json({ url: GITHUB_INSTALL });
    }
    if (pathname === "/api/issues" && method === "GET" && signedIn) {
      return json({ issues: [] });
    }
    if (pathname === "/api/workspaces/members" && method === "GET" && signedIn) {
      return json({ members: [WORKSPACE_MEMBER] });
    }
    if (pathname === "/api/github/repositories" && method === "GET" && signedIn) {
      return json(GITHUB_REPOSITORIES);
    }
    // The account's preferences snapshot, as a cookie caller reads it: no stored settings, and the link choice where one was made.
    if (pathname === "/api/account/preferences" && method === "GET") {
      if (!signedIn) return json({ error: "unauthorized" }, 401);
      const linkOpen = options.linkOpen === undefined ? undefined : { linkOpen: options.linkOpen };
      return json({ preferences: {}, ...linkOpen });
    }
    if (pathname === "/api/plans" && method === "GET") {
      return signedIn ? json({ plans: [LISTED_TASK] }) : json({ error: "unauthorized" }, 401);
    }
    return json({ error: "not_found" }, 404);
  });
  return {
    layer,
    setSession: (next) => {
      signedIn = next;
    },
    seen: () => seen,
  };
}
