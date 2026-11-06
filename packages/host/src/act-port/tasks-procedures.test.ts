/**
 * tasks-procedures.test.ts -- the Tasks tab's holds, their Try again, and the addresses it opens, through the act port as a window calls them, and every declared task act's refusal.
 *
 * Only a panel of this build's own renderer asks; any other window, and a
 * frame this build does not trust, are refused in each kind's own words
 * before the host is asked; the browser opens only the addresses each kind
 * may open; and a hold follows at the host once for every stream of it. Each
 * declared act is refused to any other window in its own words, over the
 * host that answers it.
 */

import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ORPCError } from "@orpc/client";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ADMIN_QUERY, ADMIN_READ } from "@repo/features/admin-wire";
import { browserTabsPlaceId } from "@repo/features/agent-browser-tab-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_SCOPE,
} from "@repo/features/description-comment-wire";
import { pagePlaceId } from "@repo/features/page-wire";
import { READ_MARK } from "@repo/features/read-mark";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import { TASK_CALL_FAILURE, type TasksGitHubPageAnswer } from "@repo/features/tasks-view";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { vi } from "vitest";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
  TASKS_ACTS,
} from "../contract/index.js";
import { highlightSnippet } from "../task-code.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { type TasksProceduresDependencies, tasksProcedures } from "./tasks-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SERVICE = "https://app.test";
const CONNECT_PAGE = `${SERVICE}/connect-github.html?intent=intent-1`;

/** The account the host stands signed in to, so a declared act would reach the service. */
const SIGNED_IN = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-dana",
  email: "dana@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

/** Each hand-written kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY]:
    "Could not read your GitHub repositories again on this system.",
  [TASKS_ACT_KIND.GITHUB_OPEN]: "Could not open GitHub on this system.",
  [TASKS_ACT_KIND.WEB_OPEN]: "Could not open that link on this system.",
  [TASKS_ACT_KIND.GITHUB_CONNECT]: "Could not open GitHub's connection page on this system.",
  [TASKS_ACT_KIND.ADMIN_OPEN]: "Could not open the admin dashboard on this system.",
  [TASKS_ACT_KIND.TASKS_COLOR_CODE]: "Could not color that code on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENTS_RETRY]: "Could not read the task's comments again on this system.",
} as const;

type TasksKind = keyof typeof REFUSAL;

/** What any port kind takes, the union a test hands one kind or refuses on purpose. */
type AnyPayload = PortActPayload<PortActKind>;

const TASK = { taskId: TASK_ID };
const PLAN = { planId: "plan-1" };

/** One ask of every hand-written task kind, with a payload its schema admits. */
const ACTS: readonly { kind: TasksKind; payload: AnyPayload }[] = [
  { kind: TASKS_ACT_KIND.TASKS_REPOSITORIES_RETRY, payload: { workspaceId: "workspace-acme" } },
  { kind: TASKS_ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay" } },
  { kind: TASKS_ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
  { kind: TASKS_ACT_KIND.GITHUB_CONNECT, payload: undefined },
  { kind: TASKS_ACT_KIND.ADMIN_OPEN, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_COLOR_CODE, payload: { language: "ts", code: "const a = 1;" } },
  { kind: TASKS_ACT_KIND.TASKS_COMMENTS_RETRY, payload: TASK },
];

/** Every declared task act the relay answers, by its name, with a payload its schema admits, so only who asked can refuse it; Connect GitHub's, written by hand, is refused above. */
const DECLARED: readonly {
  readonly name: keyof typeof TASKS_ACTS;
  readonly payload: WireBoundaryInput;
}[] = [
  { name: "TASKS_REFRESH", payload: undefined },
  { name: "TASKS_SELECT", payload: TASK },
  { name: "TASKS_CLOSE", payload: undefined },
  { name: "TASKS_OFFLINE_REFUSED_CLEAR", payload: undefined },
  { name: "TASKS_START", payload: { name: "Invitations" } },
  { name: "TASKS_DELETE", payload: TASK },
  { name: "TASKS_RENAME", payload: { ...TASK, name: "Expiry" } },
  { name: "TASKS_PIN", payload: { ...TASK, pinned: true } },
  { name: "TASKS_MARK_READ", payload: { ...TASK, readMark: READ_MARK.READ } },
  { name: "TASKS_PIN_REPOSITORY", payload: { repository: "acme/relay", pinned: true } },
  {
    name: "TASKS_WRITE_SECTION",
    payload: { writes: [{ kind: TASK_SECTION_WRITE.PLACE, taskId: TASK_ID, sectionId: null }] },
  },
  { name: "TASKS_SET_REPOSITORY", payload: { ...TASK, repository: "acme/relay" } },
  { name: "TASKS_MOVE", payload: { ...TASK, workspaceId: "workspace-relay" } },
  {
    name: "TASKS_BLOCK",
    payload: { ...TASK, block: { taskId: "task-2", relation: "blocked-by", change: "add" } },
  },
  { name: "TASKS_SET_PARENT", payload: { ...TASK, parentTaskId: null } },
  {
    name: "TASKS_CHANGE_RELATION",
    payload: { ...TASK, relation: { taskId: "task-2", from: "blocked-by", to: "blocks" } },
  },
  { name: "TASKS_EDIT", payload: { ...TASK, edit: { document: { base: "", value: "Expire." } } } },
  {
    name: "ADMIN_READ",
    payload: { procedure: ADMIN_READ.USERS, query: { [ADMIN_QUERY.WINDOW]: "7" } },
  },
  { name: "ADMIN_FAVORITE", payload: { id: "user-ada", favorite: true } },
  { name: "GITHUB_DISCONNECT", payload: undefined },
  { name: "TASKS_SET_STANDING", payload: { ...TASK, status: "done" } },
  { name: "TASKS_FILE", payload: { ...TASK, path: "README.md", firstLine: 1, lastLine: 2 } },
  { name: "TASKS_TREE", payload: { ...PLAN, path: "src" } },
  { name: "TASKS_SKILLS", payload: PLAN },
  {
    name: "TASKS_BROWSER_TAB_OPEN",
    payload: { agentId: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a", address: "https://example.com" },
  },
  { name: "TASKS_FIND", payload: { workspace: "acme", number: 7 } },
  { name: "TASKS_REVISIONS", payload: TASK },
  { name: "TASKS_REVISION", payload: { ...TASK, seq: 3 } },
  { name: "TASKS_RESTORE", payload: { ...TASK, seq: 3 } },
  { name: "TASKS_PAGE_SOURCE", payload: { ...TASK, pageId: "page-funnel", version: 2 } },
  { name: "TASKS_PICTURE_READ", payload: { ...PLAN, attachmentId: "picture-1" } },
  {
    name: "TASKS_PICTURE_KEEP",
    payload: { ...PLAN, picture: "data:image/png;base64,iVBORw0KGgo=" },
  },
  {
    name: "TASKS_COMMENT_START",
    payload: {
      ...PLAN,
      start: {
        clientKey: "comment-1",
        scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
        quote: "Invites",
        anchor: { from: 0, to: 7 },
        text: "Invites expire.",
        words: "Shorter?",
      },
    },
  },
  {
    name: "TASKS_COMMENT_ACT",
    payload: {
      ...PLAN,
      threadId: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
      action: { action: DESCRIPTION_COMMENT_ACTION.RESOLVE },
    },
  },
];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/**
 * A window's act port serving the task procedures alone, opened as the bridge opens one, over a fake host:
 * the window standing as `actor`, trusted or not.
 */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; serviceBaseUrl?: string } = {},
) {
  const asked: string[] = [];
  const browsed: string[] = [];
  /** The page the host names to connect the account's own GitHub, or none. */
  const script: { connectPage: string | undefined } = { connectPage: CONNECT_PAGE };
  const ask = <A>(line: string, answer: () => A) =>
    Effect.sync(() => {
      asked.push(line);
      return answer();
    });
  const host: TasksProceduresDependencies["host"] = {
    tasksRepositoriesFollow: (params) => ask(`repositories:${params.workspaceId}`, () => undefined),
    tasksRepositoriesUnfollow: (params) =>
      ask(`repositories-let-go:${params.workspaceId}`, () => undefined),
    tasksRepositoriesRetry: (params) =>
      ask(`repositories-retry:${params.workspaceId}`, () => undefined),
    tasksLinkStandingFollow: (params) => ask(`link:${params.address}`, () => undefined),
    tasksLinkStandingUnfollow: (params) => ask(`link-let-go:${params.address}`, () => undefined),
    tasksCommentsFollow: (scope) => ask(`comments-follow:${scope.taskId}`, () => undefined),
    tasksCommentsUnfollow: (scope) => ask(`comments-unfollow:${scope.taskId}`, () => undefined),
    tasksCommentsRetry: (scope) => ask(`comments-retry:${scope.taskId}`, () => undefined),
    tasksPagesFollow: (scope) => ask(`pages-follow:${pagePlaceId(scope)}`, () => undefined),
    tasksPagesUnfollow: (scope) => ask(`pages-unfollow:${pagePlaceId(scope)}`, () => undefined),
    tasksDocumentFollow: (scope) => ask(`document-follow:${scope.taskId}`, () => undefined),
    tasksDocumentUnfollow: (scope) => ask(`document-unfollow:${scope.taskId}`, () => undefined),
    tasksDocumentRetry: (scope) => ask(`document-retry:${scope.taskId}`, () => undefined),
    tasksBrowserTabsFollow: (scope) =>
      ask(`tabs-follow:${browserTabsPlaceId(scope)}`, () => undefined),
    tasksBrowserTabsUnfollow: (scope) =>
      ask(`tabs-unfollow:${browserTabsPlaceId(scope)}`, () => undefined),
    tasksHistoryFollow: (scope) => ask(`history-follow:${scope.taskId}`, () => undefined),
    tasksHistoryUnfollow: (scope) => ask(`history-unfollow:${scope.taskId}`, () => undefined),
    tasksHistoryRetry: (scope) => ask(`history-retry:${scope.taskId}`, () => undefined),
  };
  const port = testActPort(
    tasksProcedures({
      host,
      acts: {
        GITHUB_CONNECT: () =>
          ask(
            "github-connect",
            (): TasksGitHubPageAnswer =>
              script.connectPage === undefined
                ? { failure: TASK_CALL_FAILURE.UNANSWERED }
                : { url: script.connectPage },
          ),
      },
      colorCode: highlightSnippet,
      openExternal: (url) => {
        browsed.push(url);
        return Promise.resolve();
      },
      serviceBaseUrl: options.serviceBaseUrl ?? SERVICE,
    }),
  );
  ports.push(port);
  const client = port.as(actor, options);
  return { client, asked, browsed, script };
}

/** Any port kind's procedure, erased to the union of what every one takes and answers. */
type PortCall = (payload: PortActPayload<PortActKind>) => Promise<PortActResult<PortActKind>>;

/** One act called on the port, settled to its answer or the sentence of its refusal. */
async function settled(client: ActPortClient, kind: TasksKind, payload: AnyPayload) {
  // SAFETY: each test pairs a kind with the payload its own procedure takes, or one it refuses on purpose.
  const call = client[kind] as PortCall;
  try {
    return { answer: await call(payload) };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}

it("a window that is not a panel is refused every hand-written task act in the kind's own words, and the host is not asked", async () => {
  const { client, asked, browsed } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
});

it("a frame this build does not trust is refused every hand-written task act, even as a panel, and the host is not asked", async () => {
  const { client, asked, browsed } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
});

it.effect.each(DECLARED)(
  "a window that is not a panel is refused the declared $name in its own words, over the host that answers it",
  ({ name, payload }) =>
    Effect.gen(function* () {
      const { port } = yield* hostActPort({ account: SIGNED_IN });
      const act = TASKS_ACTS[name];

      const refused = yield* port.perform({ kind: act.kind, payload }, OTHER_WINDOW);

      assert.deepEqual(refused, { refused: act.refusal });
    }),
);

it("a web link opens an http, https, or mail address outside the window, and no other scheme nor an address past the cap", async () => {
  const { client, browsed } = windowPort(PANEL);
  const refused = [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "luke://plan/7",
    "//example.com/docs",
    "https://",
    `https://example.com/docs?q=${"a".repeat(2_048)}`,
  ];
  const open = (url: string) => settled(client, TASKS_ACT_KIND.WEB_OPEN, { url });

  assert.deepEqual(await open("https://example.com/docs"), { answer: undefined });
  assert.deepEqual(await open("http://localhost:3000/"), { answer: undefined });
  assert.deepEqual(await open("mailto:dean@example.com"), { answer: undefined });
  for (const url of refused) {
    assert.deepEqual(await open(url), { refused: REFUSAL[TASKS_ACT_KIND.WEB_OPEN] });
  }
  assert.deepEqual(browsed, [
    "https://example.com/docs",
    "http://localhost:3000/",
    "mailto:dean@example.com",
  ]);
});

it("a GitHub link opens GitHub's own addresses in the browser and no other", async () => {
  const { client, browsed } = windowPort(PANEL);
  const open = (url: string) => settled(client, TASKS_ACT_KIND.GITHUB_OPEN, { url });

  assert.deepEqual(await open("https://github.com/acme/relay"), { answer: undefined });
  assert.deepEqual(await open("https://example.com/acme/relay"), {
    refused: REFUSAL[TASKS_ACT_KIND.GITHUB_OPEN],
  });
  assert.deepEqual(browsed, ["https://github.com/acme/relay"]);
});

it("a GitHub page the host names off the service's own origin is refused and nothing opens", async () => {
  const { client, browsed, script } = windowPort(PANEL);

  for (const page of [
    "file:///etc/passwd",
    "evil://connect",
    "https://evil.test/connect-github.html",
  ]) {
    script.connectPage = page;
    assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
      refused: REFUSAL[TASKS_ACT_KIND.GITHUB_CONNECT],
    });
  }
  assert.deepEqual(browsed, []);
});

it("the admin dashboard opens the service's own page in the browser, and an address a window hands in is refused with nothing opened", async () => {
  const { client, asked, browsed } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.ADMIN_OPEN, undefined), {
    answer: undefined,
  });
  for (const url of ["https://evil.test/admin", "file:///etc/passwd", `${SERVICE}/admin`]) {
    assert.deepEqual(await settled(client, TASKS_ACT_KIND.ADMIN_OPEN, { url }), {
      refused: REFUSAL[TASKS_ACT_KIND.ADMIN_OPEN],
    });
  }

  assert.deepEqual(browsed, [`${SERVICE}/admin`]);
  assert.deepEqual(asked, []);
});

it("the admin dashboard is refused, and nothing opens, where the service's origin is no web address", async () => {
  for (const serviceBaseUrl of ["file:///srv/app", "evil://service", "not an address"]) {
    const { client, browsed } = windowPort(PANEL, { serviceBaseUrl });

    assert.deepEqual(await settled(client, TASKS_ACT_KIND.ADMIN_OPEN, undefined), {
      refused: REFUSAL[TASKS_ACT_KIND.ADMIN_OPEN],
    });
    assert.deepEqual(browsed, []);
  }
});

it("a fenced block is colored for a panel, its lines answered as the highlighter drew them", async () => {
  const { client } = windowPort(PANEL);

  const colored = await settled(client, TASKS_ACT_KIND.TASKS_COLOR_CODE, {
    language: "ts",
    code: "const a = 1;",
  });

  assert.ok("answer" in colored && Array.isArray(colored.answer));
  const [line] = colored.answer;
  assert.ok(Array.isArray(line));
  assert.equal(line.map((run) => run.text).join(""), "const a = 1;");
  assert.ok(line.some((run) => run.color !== undefined));
  for (const block of [
    { language: "ts", code: "a".repeat(20_001) },
    { language: "  ", code: "a" },
  ]) {
    assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COLOR_CODE, block), {
      refused: REFUSAL[TASKS_ACT_KIND.TASKS_COLOR_CODE],
    });
  }
});

it("Connect GitHub opens the page the host named in the browser, and is refused where the host named none", async () => {
  const { client, asked, browsed, script } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    answer: undefined,
  });
  script.connectPage = undefined;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    refused: REFUSAL[TASKS_ACT_KIND.GITHUB_CONNECT],
  });

  assert.deepEqual(browsed, [CONNECT_PAGE]);
  assert.deepEqual(asked, ["github-connect", "github-connect"]);
});

it("a description's comments are read again through the host from a panel", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COMMENTS_RETRY, TASK), {
    answer: undefined,
  });
  assert.deepEqual(asked, [`comments-retry:${TASK_ID}`]);
});

/** A window's act port as `windowPort` opens it. */
type WindowClient = ReturnType<typeof windowPort>["client"];

/** The holds a panel keeps on a plan's reads the host lays on app state, each opened as the window opens its stream, and the line the fake host notes it by. */
const HOLDS = [
  {
    what: "pages",
    line: "pages",
    hold: (client: WindowClient) => client[TASKS_ACT_KIND.TASKS_PAGES_FOLLOW](TASK),
  },
  {
    what: "Browser tabs",
    line: "tabs",
    hold: (client: WindowClient) => client[TASKS_ACT_KIND.TASKS_BROWSER_TABS_FOLLOW](TASK),
  },
  {
    what: "history",
    line: "history",
    hold: (client: WindowClient) => client[TASKS_ACT_KIND.TASKS_HISTORY_FOLLOW](TASK),
  },
] as const;

it.each(HOLDS)(
  "a panel's hold on a plan's $what follows them at the host once for every stream of them, and the last one closed lets them go",
  async ({ line, hold }) => {
    const { client, asked } = windowPort(PANEL);

    const one = await hold(client);
    const other = await hold(client);
    // Note that a stream is read so its hold opens, though nothing is ever heard down it.
    void one.next();
    void other.next();
    await vi.waitFor(() => assert.deepEqual(asked, [`${line}-follow:${TASK_ID}`]));

    await one.return?.(undefined);
    await vi.waitFor(() => assert.equal(asked.length, 1, "the other stream still holds it"));
    await other.return?.(undefined);
    await vi.waitFor(() =>
      assert.deepEqual(asked, [`${line}-follow:${TASK_ID}`, `${line}-unfollow:${TASK_ID}`]),
    );
  },
);

it.each(HOLDS)(
  "a window that is not a panel is refused a plan's $what, and the host follows nothing",
  async ({ hold }) => {
    const { client, asked } = windowPort(OTHER_WINDOW);
    await assert.rejects(hold(client));
    assert.deepEqual(asked, []);
  },
);
