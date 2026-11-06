import type { LinkOpen } from "@repo/features/link-open";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WireValue } from "@repo/wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import type { Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";

const SIGNED_IN_USER = {
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada Lovelace",
  lastLoginMethod: "github",
} as const;

export const LISTED_TASK = {
  id: "4f0b6a0e-6f3c-4a43-9d0f-0d6a4e0b1c21",
  workspaceId: "workspace-ada",
  name: "Draw the analytical engine",
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  repository: null,
} as const;

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

function slackRow(settled: boolean): WireValue {
  return {
    id: "integration-slack",
    connection: "slack",
    provider: "slack",
    label: null,
    status: settled ? "connected" : "pending",
  };
}

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

const LIVE_DIGEST = "1,1,1";

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

export const NOTION_SIGN_IN = "https://notion.example/oauth/authorize";

export const GITHUB_INSTALL = "https://github.com/apps/vespin-agent/installations/new";

interface SeenRequest {
  readonly method: string;
  readonly path: string;
}

export interface FakeService {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  readonly setSession: (signedIn: boolean) => void;
  readonly seen: () => readonly SeenRequest[];
  readonly settled: () => boolean;
}

function json(body: WireValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const WORKSPACE_MEMBER = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "owner",
} as const;

export const GITHUB_REPOSITORIES = {
  installed: true,
  repositories: [],
  installationUrl: "https://github.com/apps/vespin-agent/installations/new",
} as const;

interface FakeServiceOptions {
  readonly signedIn: boolean;
  readonly linkOpen?: LinkOpen;
  readonly sessionHeld?: Promise<void>;
}

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
    if (pathname === "/api/workspaces/members/remove" && method === "POST" && signedIn) {
      return json({ members: [WORKSPACE_MEMBER] });
    }
    if (pathname === "/api/github/repositories" && method === "GET" && signedIn) {
      return json(GITHUB_REPOSITORIES);
    }
    if (pathname === "/api/account/preferences" && method === "GET") {
      if (!signedIn) return json({ error: "unauthorized" }, 401);
      const linkOpen = options.linkOpen === undefined ? undefined : { linkOpen: options.linkOpen };
      return json({ preferences: {}, ...linkOpen });
    }
    if (pathname === "/api/live/tasks" && method === "GET") {
      if (!signedIn) return json({ error: "unauthorized" }, 401);
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
