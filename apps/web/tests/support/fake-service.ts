/**
 * fake-service.ts -- the hosted service as a web client's test meets it: a cookie session the test signs in and out, a task list, a Slack sign-in under way, Notion's sign-in and a workspace's GitHub installation addresses, the workspace's members, the repositories our GitHub App reaches, the account's link choice, and nothing else, answered over a fake `HttpClient`.
 *
 * The Slack sign-in is settled only by the settling POST, as the service
 * answers a cookie caller, and the account's integration rows, followed as
 * the tab follows them, polled, say so once it has. The web client's host calls the origin that
 * served it, which jsdom names `http://localhost:3000`. A route the fake does not hold answers 404, which
 * every client reads as unanswered, so a test states only what it reads.
 * The session is the browser's cookie in a real tab: here it is whatever the
 * test last set, read on every `get-session`, so "the cookie changed" is
 * one call; a test that holds the session read answers it when it lets go. The task list is followed as
 * the tab follows it: polled, the listed task's row inline.
 */

import type { LinkOpen } from "@repo/features/link-open";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WireValue } from "@repo/wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
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

/** One task the fake lists, as the plan list summarizes it. */
export const LISTED_TASK = {
  id: "4f0b6a0e-6f3c-4a43-9d0f-0d6a4e0b1c21",
  workspaceId: "workspace-ada",
  name: "Draw the analytical engine",
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  repository: null,
} as const;

/** The rows each part of the task list delivers: the listed task, owned by the signed-in user, no agent, and no linked issue. */
const LIVE_ROWS: ReadonlyMap<string, readonly WireValue[]> = new Map<string, readonly WireValue[]>([
  [
    "plans",
    [
      {
        ...LISTED_TASK,
        ownerId: "user-ada",
        ownerName: "Ada Lovelace",
        pinnedAt: null,
        pinPosition: null,
        archivedAt: null,
        assigneeId: null,
        assigneeName: null,
        status: "todo",
        priority: "none",
        number: 1,
      },
    ],
  ],
  ["agents", []],
  ["issues", []],
]);

/** One integration row as the live read delivers it: the Slack account, pending until the settling POST connects it. */
function slackRow(settled: boolean): WireValue {
  return {
    id: "integration-slack",
    connection: "slack",
    provider: "slack",
    label: null,
    status: settled ? "connected" : "pending",
  };
}

/** The account's integrations as a polled read answers them: the Slack row inline at the poll address, or only where it stands where it has not moved, with Slack offered beside it. */
function polledIntegrations(settled: boolean, unchanged: boolean): WireValue {
  return {
    url: LIVE_POLL_URL,
    queries: {
      connections: {
        capability: "connections",
        queryFingerprint: "connections",
        expiresAt: 4_000_000_000_000,
        digest: settled ? "2" : "1",
        ...(unchanged ? undefined : { rows: JSON.stringify([slackRow(settled)]) }),
      },
    },
    offered: ["slack"],
    multiple: [],
  };
}

/** Where the task list's rows stand, which never moves in the fake: each part's digest, in the parts' name order. */
const LIVE_DIGEST = "1,1,1";

/** The task list as a polled read answers it: each part's rows inline at the poll address, or only where they stand where they have not moved. */
function polledTaskList(unchanged: boolean): WireValue {
  const part = (name: string) => ({
    capability: name,
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: "1",
    ...(unchanged ? undefined : { rows: JSON.stringify(LIVE_ROWS.get(name) ?? []) }),
  });
  return {
    url: LIVE_POLL_URL,
    queries: { plans: part("plans"), agents: part("agents"), issues: part("issues") },
  };
}

/** Where the fake sends a browser to sign in to Notion. */
export const NOTION_SIGN_IN = "https://notion.example/oauth/authorize";

/** Where the fake sends a browser to install the GitHub App on a workspace. */
export const GITHUB_INSTALL = "https://github.com/apps/vespin-agent/installations/new";

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
  /** Whether the settling POST has connected the Slack sign-in. */
  readonly settled: () => boolean;
}

/** An answer as the service writes one: JSON, with the status given. */
function json(body: WireValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The one member every workspace the fake service answers keeps. */
export const WORKSPACE_MEMBER = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "owner",
} as const;

/** The repositories the account reaches through our GitHub App: the App installed, reaching none yet. */
export const GITHUB_REPOSITORIES = {
  installed: true,
  repositories: [],
  installationUrl: "https://github.com/apps/vespin-agent/installations/new",
} as const;

/** How the fake starts: signed in or not, and where the account chose its app links open, if it chose. */
interface FakeServiceOptions {
  readonly signedIn: boolean;
  readonly linkOpen?: LinkOpen;
  /** What every session read waits on before it answers, as a slow service keeps the tab waiting; answered at once where none is given. */
  readonly sessionHeld?: Promise<void>;
}

/** The fake service, signed in or not as it starts. */
export function fakeService(options: FakeServiceOptions): FakeService {
  let signedIn = options.signedIn;
  let settled = false;
  const seen: SeenRequest[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    seen.push({ method, path: pathname });
    if (pathname === "/api/auth/get-session") {
      await options.sessionHeld;
      return json(signedIn ? { user: SIGNED_IN_USER } : null);
    }
    if (pathname === "/api/auth/sign-out" && method === "POST") {
      signedIn = false;
      return json({ success: true });
    }
    // A sign-in to Slack under way: the rows read it as stored, and only the POST settles it.
    if (pathname === "/api/live/integration-statuses" && method === "GET") {
      if (!signedIn) return json({ error: "unauthorized" }, 401);
      const after = new URL(url).searchParams.get(LIVE_POLL.AFTER);
      return json(polledIntegrations(settled, after === (settled ? "2" : "1")));
    }
    if (pathname === "/api/account/integrations/github" && method === "GET" && signedIn) {
      return json({ status: "disconnected" });
    }
    if (pathname === "/api/account/integrations/settle" && method === "POST" && signedIn) {
      settled = true;
      return json({ integrations: { slack: "connected" } });
    }
    if (pathname === "/api/account/integrations/notion/connect" && method === "POST" && signedIn) {
      return json({ url: NOTION_SIGN_IN });
    }
    if (pathname === "/api/workspaces/github/connect" && method === "POST" && signedIn) {
      return json({ url: GITHUB_INSTALL });
    }
    // A member removed answers those who remain.
    if (pathname === "/api/workspaces/members/remove" && method === "POST" && signedIn) {
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
    if (pathname === "/api/live/tasks" && method === "GET") {
      if (!signedIn) return json({ error: "unauthorized" }, 401);
      // The list is answered polled, its rows inline; a poll past where they stand answers them unchanged.
      const unchanged = new URL(url).searchParams.get(LIVE_POLL.AFTER) === LIVE_DIGEST;
      return json(polledTaskList(unchanged));
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
    settled: () => settled,
  };
}
