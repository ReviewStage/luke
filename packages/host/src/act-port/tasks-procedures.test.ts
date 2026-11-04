/**
 * tasks-procedures.test.ts -- the task list, lifecycle, and content acts, through the act port as a window calls them.
 *
 * Only a panel of this build's own renderer asks; any other
 * window, and a frame this build does not trust, are refused in each
 * kind's own words before the host is asked; a panel's ask reaches the host
 * with its payload as the kind's schema read it, and answers what the host
 * answered; the browser opens only the addresses each kind may open; and what a task
 * holds is read through the host, a page's source colored, and a pull
 * request or an issue the service did not answer refused.
 */

import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ORPCError } from "@orpc/client";
import {
  ADMIN_QUERY,
  ADMIN_READ,
  ADMIN_REFUSED,
  type AdminReadAnswer,
} from "@repo/features/admin-wire";
import { browserTabsPlaceId } from "@repo/features/agent-browser-tab-wire";
import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { ISSUE_STATE } from "@repo/features/github-repositories-wire";
import { pagePlaceId } from "@repo/features/page-wire";
import { PICTURE_TYPE } from "@repo/features/picture-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
} from "@repo/features/plan-comment-wire";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import { TASK_FILE_REFUSAL } from "@repo/features/task-wire";
import {
  BROWSER_TAB_OPEN_FAILURE,
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksPageSourceAnswer,
  type TasksStartAnswer,
} from "@repo/features/tasks-view";
import { Effect } from "effect";
import { vi } from "vitest";
import { GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
} from "../contract/index.js";
import { highlightSnippet } from "../task-code.js";
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

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [TASKS_ACT_KIND.TASKS_REFRESH]: "Could not read your tasks on this system.",
  [TASKS_ACT_KIND.TASKS_SELECT]: "Could not open that task on this system.",
  [TASKS_ACT_KIND.TASKS_CLOSE]: "Could not leave that task on this system.",
  [TASKS_ACT_KIND.TASKS_START]: "Could not start that task on this system.",
  [TASKS_ACT_KIND.TASKS_DELETE]: "Could not delete that task on this system.",
  [TASKS_ACT_KIND.TASKS_RENAME]: "Could not rename that task on this system.",
  [TASKS_ACT_KIND.TASKS_PIN]: "Could not pin that task on this system.",
  [TASKS_ACT_KIND.TASKS_PIN_REPOSITORY]: "Could not pin that repository on this system.",
  [TASKS_ACT_KIND.TASKS_WRITE_SECTION]: "Could not change that section on this system.",
  [TASKS_ACT_KIND.TASKS_REPOSITORIES]: "Could not read your GitHub repositories on this system.",
  [TASKS_ACT_KIND.TASKS_SET_REPOSITORY]: "Could not change that task's repository on this system.",
  [TASKS_ACT_KIND.TASKS_MOVE]: "Could not move that task on this system.",
  [TASKS_ACT_KIND.TASKS_EDIT]: "Could not save that edit on this system.",
  [TASKS_ACT_KIND.GITHUB_OPEN]: "Could not open GitHub on this system.",
  [TASKS_ACT_KIND.WEB_OPEN]: "Could not open that link on this system.",
  [TASKS_ACT_KIND.GITHUB_CONNECT]: "Could not open GitHub's connection page on this system.",
  [TASKS_ACT_KIND.ADMIN_OPEN]: "Could not open the admin dashboard on this system.",
  [TASKS_ACT_KIND.ADMIN_READ]: "Could not read the admin dashboard on this system.",
  [TASKS_ACT_KIND.ADMIN_FAVORITE]: "Could not star that account on this system.",
  [TASKS_ACT_KIND.GITHUB_DISCONNECT]: "Could not disconnect GitHub on this system.",
  [TASKS_ACT_KIND.TASKS_SET_STANDING]: "Could not change where that task stands on this system.",
  [TASKS_ACT_KIND.TASKS_FILE]: "Could not read that file on this system.",
  [TASKS_ACT_KIND.TASKS_TREE]: "Could not list that folder on this system.",
  [TASKS_ACT_KIND.TASKS_SKILLS]: "Could not read this repository's skills on this system.",
  [TASKS_ACT_KIND.TASKS_PULL_REQUEST]: "Could not read that pull request on this system.",
  [TASKS_ACT_KIND.TASKS_ISSUE]: "Could not read that issue on this system.",
  [TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN]:
    "Could not open a tab in that agent's browser on this system.",
  [TASKS_ACT_KIND.TASKS_COLOR_CODE]: "Could not color that code on this system.",
  [TASKS_ACT_KIND.TASKS_REVISIONS]: "Could not read that plan's history on this system.",
  [TASKS_ACT_KIND.TASKS_REVISION]: "Could not read that version on this system.",
  [TASKS_ACT_KIND.TASKS_RESTORE]: "Could not restore that version on this system.",
  [TASKS_ACT_KIND.TASKS_PAGE_SOURCE]: "Could not read that page's source on this system.",
  [TASKS_ACT_KIND.TASKS_PICTURE_READ]: "Could not read that picture on this system.",
  [TASKS_ACT_KIND.TASKS_PICTURE_KEEP]: "Could not keep that picture on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENTS_RETRY]: "Could not read the task's comments again on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENT_START]: "Could not comment on the task on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENT_ACT]: "Could not change the task's comment on this system.",
} as const;

type TasksKind = keyof typeof REFUSAL;

/** What any port kind takes, the union a test hands one kind or refuses on purpose. */
type AnyPayload = PortActPayload<PortActKind>;

const TASK = { taskId: TASK_ID };
const EDIT = { ...TASK, edit: { document: { base: "", value: "Invites expire." } } };

/** A comment thread's id, as the service spells one. */
const THREAD_ID = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
/** The one picture the fake host holds. */
const PICTURE_ID = "picture-1";
const PLAN = { planId: "plan-1" };
const PLACE = { workspaceId: "workspace-acme", repository: "acme/relay" };
const PAGE = { ...TASK, pageId: "page-funnel", version: 2 };
const COMMENT_START = {
  ...PLAN,
  start: {
    clientKey: "comment-1",
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "Invites",
    anchor: { from: 0, to: 7 },
    text: "Invites expire.",
    words: "Shorter?",
  },
};
const COMMENT_ACT = {
  ...PLAN,
  threadId: THREAD_ID,
  action: { action: PLAN_COMMENT_ACTION.RESOLVE },
};

/** The one pull request the fake host's service holds; it holds none numbered `PULL_REQUEST_NONE`, and answers nothing for any other number. */
const PULL_REQUEST = {
  number: 42,
  title: "Send invitations in batches",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
};
const PULL_REQUEST_NONE = 43;
/** The one issue the fake host's service holds; it holds none numbered `ISSUE_NONE`, and answers nothing for any other number. */
const ISSUE = {
  number: 7,
  title: "Invitations expire too soon",
  url: "https://github.com/acme/relay/issues/7",
  state: ISSUE_STATE.CLOSED,
};
const ISSUE_NONE = 8;

/** One Browser tab in a coding agent's browser on the task. */
const BROWSER_TAB = {
  id: "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
  agentId: "1e2d3c4b-5a6f-4e7d-8c9b-0a1f2e3d4c5b",
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: { kind: "agent" },
  driver: null,
  createdAt: 1_000,
  lastActedAt: 2_000,
} as const;

/** A tab a member opens in a coding agent's browser. */
const BROWSER_TAB_OPEN = {
  agentId: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
  address: "https://example.com/sign-in",
};

/** A coding agent whose browser the service could not reach. */
const AGENT_UNREACHABLE = "7b6a5f4e-3d2c-4b1a-9f8e-7d6c5b4a3f2e";

/** One admin read, of the roster at a week, admins counted. */
const ADMIN_READ_PARAMS = {
  procedure: ADMIN_READ.USERS,
  query: { [ADMIN_QUERY.WINDOW]: "7", [ADMIN_QUERY.SCOPE]: "all" },
};
/** The one account the fake service names, and the roster it answers for it. */
const ADMIN_ACCOUNT_ID = "user-ada";
const ADMIN_ROSTER = { total: 1, rows: [{ id: ADMIN_ACCOUNT_ID, name: "Ada" }] };

/** One ask of every task kind, with a payload its schema admits. */
const ACTS: readonly { kind: TasksKind; payload: AnyPayload }[] = [
  { kind: TASKS_ACT_KIND.TASKS_REFRESH, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_SELECT, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_CLOSE, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_START, payload: { name: "Invitations" } },
  { kind: TASKS_ACT_KIND.TASKS_DELETE, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_RENAME, payload: { ...TASK, name: "Expiry" } },
  { kind: TASKS_ACT_KIND.TASKS_PIN, payload: { ...TASK, pinned: true } },
  {
    kind: TASKS_ACT_KIND.TASKS_PIN_REPOSITORY,
    payload: { repository: "acme/relay", pinned: true },
  },
  {
    kind: TASKS_ACT_KIND.TASKS_WRITE_SECTION,
    payload: { writes: [{ kind: TASK_SECTION_WRITE.PLACE, taskId: TASK_ID, sectionId: null }] },
  },
  { kind: TASKS_ACT_KIND.TASKS_REPOSITORIES, payload: { workspaceId: "workspace-acme" } },
  { kind: TASKS_ACT_KIND.TASKS_SET_REPOSITORY, payload: { ...TASK, repository: "acme/relay" } },
  { kind: TASKS_ACT_KIND.TASKS_MOVE, payload: { ...TASK, workspaceId: "workspace-relay" } },
  { kind: TASKS_ACT_KIND.TASKS_EDIT, payload: EDIT },
  { kind: TASKS_ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay" } },
  { kind: TASKS_ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
  { kind: TASKS_ACT_KIND.GITHUB_CONNECT, payload: undefined },
  { kind: TASKS_ACT_KIND.ADMIN_OPEN, payload: undefined },
  { kind: TASKS_ACT_KIND.ADMIN_READ, payload: ADMIN_READ_PARAMS },
  { kind: TASKS_ACT_KIND.ADMIN_FAVORITE, payload: { id: ADMIN_ACCOUNT_ID, favorite: true } },
  { kind: TASKS_ACT_KIND.GITHUB_DISCONNECT, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_SET_STANDING, payload: { ...TASK, status: "done" } },
  {
    kind: TASKS_ACT_KIND.TASKS_FILE,
    payload: { ...TASK, path: "README.md", firstLine: 1, lastLine: 2 },
  },
  { kind: TASKS_ACT_KIND.TASKS_TREE, payload: { ...PLAN, path: "src" } },
  { kind: TASKS_ACT_KIND.TASKS_SKILLS, payload: PLAN },
  { kind: TASKS_ACT_KIND.TASKS_PULL_REQUEST, payload: { ...PLACE, number: PULL_REQUEST.number } },
  { kind: TASKS_ACT_KIND.TASKS_ISSUE, payload: { ...PLACE, number: ISSUE.number } },
  { kind: TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN, payload: BROWSER_TAB_OPEN },
  { kind: TASKS_ACT_KIND.TASKS_COLOR_CODE, payload: { language: "ts", code: "const a = 1;" } },
  { kind: TASKS_ACT_KIND.TASKS_REVISIONS, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_REVISION, payload: { ...TASK, seq: 3 } },
  { kind: TASKS_ACT_KIND.TASKS_RESTORE, payload: { ...TASK, seq: 3 } },
  { kind: TASKS_ACT_KIND.TASKS_PAGE_SOURCE, payload: PAGE },
  { kind: TASKS_ACT_KIND.TASKS_PICTURE_READ, payload: { ...PLAN, attachmentId: PICTURE_ID } },
  {
    kind: TASKS_ACT_KIND.TASKS_PICTURE_KEEP,
    payload: { ...PLAN, picture: "data:image/png;base64,iVBORw0KGgo=" },
  },
  { kind: TASKS_ACT_KIND.TASKS_COMMENTS_RETRY, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_COMMENT_START, payload: COMMENT_START },
  { kind: TASKS_ACT_KIND.TASKS_COMMENT_ACT, payload: COMMENT_ACT },
];

/** What the fake host and the window's process answer, set by each test before it asks. */
interface Script {
  /** What a start answers. */
  start: TasksStartAnswer;
  /** The page the host names to connect the account's own GitHub, or none. */
  connectPage: string | undefined;
  /** Whether GitHub is the account's only way to sign in. */
  lastSignIn: boolean;
  /** A key the host's start answer carries beside what the window reads, as a newer host might. */
  startExtra: boolean;
  /** The HTML the service answers for a page's version, none where it does not answer. */
  pageHtml: string | undefined;
  /** What an admin read answers. */
  adminRead: AdminReadAnswer;
}

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
  const script: Script = {
    start: { failure: TASK_CALL_FAILURE.UNANSWERED },
    connectPage: CONNECT_PAGE,
    lastSignIn: false,
    startExtra: false,
    pageHtml: undefined,
    adminRead: { answer: ADMIN_ROSTER },
  };
  const ask = <A>(line: string, answer: () => A) =>
    Effect.sync(() => {
      asked.push(line);
      return answer();
    });
  const host: TasksProceduresDependencies["host"] = {
    tasksRefresh: () => ask("refresh", () => undefined),
    tasksOpen: (taskId) => ask(`open:${taskId}`, () => true),
    tasksClose: () => ask("close", () => undefined),
    tasksDelete: (taskId) => ask(`delete:${taskId}`, () => true),
    tasksRename: (params) => ask(`rename:${params.taskId}:${params.name}`, () => true),
    tasksPin: (params) => ask(`pin:${params.taskId}:${params.pinned}`, () => true),
    tasksPinRepository: (params) =>
      ask(`pin-repository:${params.repository}:${params.pinned}`, () => true),
    tasksWriteSection: (params) =>
      ask(`section:${params.writes.map((write) => write.kind).join(",")}`, () => true),
    tasksStart: (request) =>
      ask(`start:${request.name ?? ""}`, () =>
        // A key no start answer names, carried on purpose to show the port drops it.
        script.startExtra ? Object.assign({ extra: true }, script.start) : script.start,
      ),
    tasksRepositories: (params) =>
      ask(`repositories:${params.workspaceId}`, () => ({
        failure: TASK_CALL_FAILURE.UNANSWERED,
      })),
    tasksSetRepository: (params) =>
      ask(`repository:${params.taskId}:${params.repository}`, () => ({
        repository: params.repository,
      })),
    tasksMove: (params) =>
      ask(`move:${params.taskId}:${params.workspaceId}`, () => ({
        workspaceId: params.workspaceId,
      })),
    tasksBlock: (params) =>
      ask(`block:${params.taskId}:${params.block.taskId}`, () => ({ blockedBy: [], blocks: [] })),
    tasksSetParent: (params) =>
      ask(`parent:${params.taskId}:${params.parentTaskId}`, () => ({
        parentTaskId: params.parentTaskId,
      })),
    tasksChangeRelation: (params) =>
      ask(`relation:${params.taskId}:${params.relation.taskId}`, () => ({
        blockedBy: [],
        blocks: [],
        parentTaskId: null,
      })),
    tasksEdit: (params) =>
      ask(
        `edit:${params.taskId}:${"document" in params.edit ? params.edit.document.value : ""}`,
        () => ({ saved: true }) as const,
      ),
    githubConnect: () =>
      ask(
        "github-connect",
        (): TasksGitHubPageAnswer =>
          script.connectPage === undefined
            ? { failure: TASK_CALL_FAILURE.UNANSWERED }
            : { url: script.connectPage },
      ),
    githubDisconnect: () =>
      ask(
        "github-disconnect",
        (): TasksGitHubDisconnectAnswer =>
          script.lastSignIn
            ? { failure: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED }
            : { connection: { connected: false, login: null } },
      ),
    adminRead: (params) =>
      ask(
        `admin-read:${params.procedure}:${new URLSearchParams(params.query)}`,
        () => script.adminRead,
      ),
    adminFavorite: (params) =>
      ask(`admin-favorite:${params.id}:${params.favorite}`, () => params.id === ADMIN_ACCOUNT_ID),
    tasksSetStanding: (params) =>
      ask(`standing:${params.taskId}:${params.status ?? ""}`, () => true),
    tasksFile: (params) =>
      ask(
        `file:${params.path}:${params.firstLine}-${params.lastLine}`,
        () => ({ refusal: TASK_FILE_REFUSAL.MISSING }) as const,
      ),
    tasksTree: (params) =>
      ask(`tree:${params.path}`, () => ({ refusal: TASK_FILE_REFUSAL.NOT_REACHABLE }) as const),
    tasksSkills: (params) =>
      ask(
        `skills:${"planId" in params ? params.planId : params.repository}`,
        () => ({ refusal: TASK_FILE_REFUSAL.NO_REPOSITORY }) as const,
      ),
    tasksPullRequest: (params) =>
      ask(`pullRequest:${params.repository}:${params.number}`, () => {
        if (params.number === PULL_REQUEST.number) return { pullRequest: PULL_REQUEST };
        if (params.number === PULL_REQUEST_NONE) return { pullRequest: null };
        return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
      }),
    tasksIssue: (params) =>
      ask(`issue:${params.repository}:${params.number}`, () => {
        if (params.number === ISSUE.number) return { issue: ISSUE };
        if (params.number === ISSUE_NONE) return { issue: null };
        return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
      }),
    tasksBrowserTabOpen: (params) =>
      ask(`browserTabOpen:${params.agentId}`, () =>
        params.agentId === AGENT_UNREACHABLE
          ? ({ failure: BROWSER_TAB_OPEN_FAILURE.UNREACHABLE } as const)
          : {
              tab: {
                ...BROWSER_TAB,
                agentId: params.agentId,
                address: params.address,
                openedBy: { kind: "member", userId: "user-ada" },
                driver: { userId: "user-ada", heldUntil: 62_000 },
              } as const,
            },
      ),
    tasksFind: (params) =>
      ask(`find:${params.workspace}:${params.number}`, () => ({ taskId: TASK_ID })),
    tasksRevisions: (params) =>
      ask(`revisions:${params.taskId}:${params.before}`, () => ({ revisions: [] })),
    tasksRevision: (params) =>
      ask(`revision:${params.seq}`, () => ({ failure: TASK_CALL_FAILURE.UNANSWERED }) as const),
    tasksRestore: (params) => ask(`restore:${params.seq}`, () => true),
    tasksPictureKeep: (params) => ask(`keep:${params.planId}`, () => ({ id: PICTURE_ID })),
    tasksCommentsFollow: (scope) => ask(`comments-follow:${scope.taskId}`, () => undefined),
    tasksCommentsUnfollow: (scope) => ask(`comments-unfollow:${scope.taskId}`, () => undefined),
    tasksCommentsRetry: (scope) => ask(`comments-retry:${scope.taskId}`, () => undefined),
    tasksCommentStart: (params) =>
      ask(`comment:${params.planId}`, () => ({ refused: PLAN_COMMENT_REFUSAL.TOO_MANY })),
    tasksCommentAct: (params) =>
      ask(`act:${params.threadId}:${params.action.action}`, () => ({ deleted: params.threadId })),
    tasksPicture: (params) =>
      ask(`picture:${params.planId}:${params.attachmentId}`, () =>
        params.attachmentId === PICTURE_ID
          ? { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" }
          : ({ failure: TASK_CALL_FAILURE.NOT_FOUND } as const),
      ),
    tasksPage: (params) =>
      ask(`page:${params.pageId}:${params.version}`, () => {
        const html = script.pageHtml;
        if (html === undefined) return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        return { page: { id: params.pageId, title: "Invite funnel", version: 2, at: 0, html } };
      }),
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

it("a window that is not a panel is refused every task act in the kind's own words, and the host is not asked", async () => {
  const { client, asked, browsed } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
});

it("a frame this build does not trust is refused every task act, even as a panel, and the host is not asked", async () => {
  const { client, asked, browsed } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
});

it("the task acts reach the host from a panel and answer what it answered", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (kind: TasksKind, payload: AnyPayload) => settled(client, kind, payload);

  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REFRESH, undefined), { answer: undefined });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SELECT, TASK), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_CLOSE, undefined), { answer: undefined });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_DELETE, TASK), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_RENAME, { ...TASK, name: "  Expiry " }), {
    answer: true,
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_PIN, { ...TASK, pinned: true }), {
    answer: true,
  });
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_PIN_REPOSITORY, { repository: "acme/relay", pinned: false }),
    { answer: true },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_WRITE_SECTION, {
      writes: [{ kind: TASK_SECTION_WRITE.PLACE, taskId: TASK_ID, sectionId: null }],
    }),
    { answer: true },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_REPOSITORIES, { workspaceId: "workspace-acme" }),
    { answer: { failure: TASK_CALL_FAILURE.UNANSWERED } },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_SET_REPOSITORY, { ...TASK, repository: "acme/relay" }),
    { answer: { repository: "acme/relay" } },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_MOVE, { ...TASK, workspaceId: "workspace-relay" }),
    { answer: { workspaceId: "workspace-relay" } },
  );
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_EDIT, EDIT), { answer: { saved: true } });

  assert.deepEqual(asked, [
    "refresh",
    `open:${TASK_ID}`,
    "close",
    `delete:${TASK_ID}`,
    `rename:${TASK_ID}:Expiry`,
    `pin:${TASK_ID}:true`,
    "pin-repository:acme/relay:false",
    `section:${TASK_SECTION_WRITE.PLACE}`,
    "repositories:workspace-acme",
    `repository:${TASK_ID}:acme/relay`,
    `move:${TASK_ID}:workspace-relay`,
    `edit:${TASK_ID}:Invites expire.`,
  ]);
});

it("a started task answers its plan, with an agent or without", async () => {
  const { client, script } = windowPort(PANEL);
  script.start = { planId: TASK_ID };
  const start = (payload: AnyPayload) => settled(client, TASKS_ACT_KIND.TASKS_START, payload);

  const bare = await start({ name: "Typo", planning: false });
  const withAgent = await start({
    name: "Expiry",
    repository: "acme/relay",
    agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
  });

  assert.deepEqual(bare, { answer: { planId: TASK_ID } });
  assert.deepEqual(withAgent, bare);
});

it("a key the host's answer carries beside what the kind's schema names reaches the window no more, the answer encoded by the kind's own schema", async () => {
  const { client, script } = windowPort(PANEL);
  script.start = { planId: TASK_ID };
  script.startExtra = true;

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_START, { name: "Invitations" }), {
    answer: { planId: TASK_ID },
  });
});

it("a start the host could not make is answered with why", async () => {
  const { client } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_START, { name: "Invitations" }), {
    answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
  });
});

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

it("Connect GitHub opens the page the host named in the browser, Disconnect asks the host and opens nothing, and the last way to sign in is refused in words that say so", async () => {
  const { client, asked, browsed, script } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    answer: undefined,
  });
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_DISCONNECT, undefined), {
    answer: undefined,
  });
  script.connectPage = undefined;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    refused: REFUSAL[TASKS_ACT_KIND.GITHUB_CONNECT],
  });
  script.lastSignIn = true;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_DISCONNECT, undefined), {
    refused: GITHUB_LAST_SIGN_IN_REFUSAL,
  });

  assert.deepEqual(browsed, [CONNECT_PAGE]);
  assert.deepEqual(asked, [
    "github-connect",
    "github-disconnect",
    "github-connect",
    "github-disconnect",
  ]);
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

it("an admin read reaches the host from a panel and answers what the service answered, its refusal by its word, and the star answers whether it landed", async () => {
  const { client, asked, script } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.ADMIN_READ, ADMIN_READ_PARAMS), {
    answer: { answer: ADMIN_ROSTER },
  });
  script.adminRead = { refused: ADMIN_REFUSED.FORBIDDEN };
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.ADMIN_READ, ADMIN_READ_PARAMS), {
    answer: { refused: ADMIN_REFUSED.FORBIDDEN },
  });
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.ADMIN_FAVORITE, { id: ADMIN_ACCOUNT_ID, favorite: true }),
    { answer: true },
  );
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.ADMIN_FAVORITE, { id: "user-gone", favorite: false }),
    { answer: false },
  );

  assert.deepEqual(asked, [
    "admin-read:users:window=7&scope=all",
    "admin-read:users:window=7&scope=all",
    `admin-favorite:${ADMIN_ACCOUNT_ID}:true`,
    "admin-favorite:user-gone:false",
  ]);
});

it("an admin read naming no procedure the service serves is refused in its own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    // SAFETY: a procedure no admin read is served under, sent on purpose to be refused.
    await settled(client, TASKS_ACT_KIND.ADMIN_READ, {
      procedure: "secrets",
      query: {},
    } as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.ADMIN_READ] },
  );
  assert.deepEqual(asked, []);
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

it("a payload its kind's schema refuses is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_SELECT, { taskId: "   " }), {
    refused: REFUSAL[TASKS_ACT_KIND.TASKS_SELECT],
  });
  assert.deepEqual(
    // SAFETY: a payload sent to a kind that takes none, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_REFRESH, TASK as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_REFRESH] },
  );
  assert.deepEqual(asked, []);
});

it("a payload carrying a key its kind's schema does not name is refused, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    // SAFETY: a key the schema does not name, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_EDIT, { ...EDIT, extra: true } as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_EDIT] },
  );
  assert.deepEqual(
    // SAFETY: a key the schema does not name, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_DELETE, { ...TASK, extra: true } as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_DELETE] },
  );
  assert.deepEqual(asked, []);
});

it("what a task holds is read through the host from a panel, and answers what it answered", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (kind: TasksKind, payload: AnyPayload) => settled(client, kind, payload);

  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SET_STANDING, { ...TASK, status: "done" }), {
    answer: true,
  });
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_FILE, { ...TASK, path: "README.md", firstLine: 1, lastLine: 2 }),
    { answer: { refusal: TASK_FILE_REFUSAL.MISSING } },
  );
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_TREE, { ...PLAN, path: "src" }), {
    answer: { refusal: TASK_FILE_REFUSAL.NOT_REACHABLE },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SKILLS, PLACE), {
    answer: { refusal: TASK_FILE_REFUSAL.NO_REPOSITORY },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REVISIONS, TASK), { answer: { revisions: [] } });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REVISION, { ...TASK, seq: 3 }), {
    answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_RESTORE, { ...TASK, seq: 3 }), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_COMMENT_START, COMMENT_START), {
    answer: { refused: PLAN_COMMENT_REFUSAL.TOO_MANY },
  });

  assert.deepEqual(asked, [
    `standing:${TASK_ID}:done`,
    "file:README.md:1-2",
    "tree:src",
    "skills:acme/relay",
    `revisions:${TASK_ID}:undefined`,
    "revision:3",
    "restore:3",
    "comment:plan-1",
  ]);
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
});

it("a page's source is read through the host for a panel, line by line and plain, since the panel colors it, and its silence answered", async () => {
  const { client, asked, script } = windowPort(PANEL);
  const source = () => settled(client, TASKS_ACT_KIND.TASKS_PAGE_SOURCE, PAGE);
  const long = `<p>${"a".repeat(70_000)}</p>`;

  const unanswered = await source();
  script.pageHtml = "<h1>Invites</h1>\n\n<p>sent</p>";
  const read = await source();
  script.pageHtml = long;
  const plain = await source();

  assert.deepEqual(unanswered, { answer: { failure: TASK_CALL_FAILURE.UNANSWERED } });
  // SAFETY: the page-source procedure answers a page source, which the assertion below reads.
  const answer = ("answer" in read ? read.answer : undefined) as TasksPageSourceAnswer | undefined;
  assert.ok(answer !== undefined && "lines" in answer);
  assert.deepEqual(answer.lines, [[{ text: "<h1>Invites</h1>" }], [], [{ text: "<p>sent</p>" }]]);
  assert.deepEqual(plain, { answer: { lines: [[{ text: long }]] } });
  assert.deepEqual(asked, ["page:page-funnel:2", "page:page-funnel:2", "page:page-funnel:2"]);
});

it("a plan's picture is read through the host from a panel, its absence answered rather than refused, and one is kept", async () => {
  const { client, asked } = windowPort(PANEL);
  const read = (attachmentId: string) =>
    settled(client, TASKS_ACT_KIND.TASKS_PICTURE_READ, { ...PLAN, attachmentId });

  assert.deepEqual(await read(PICTURE_ID), {
    answer: { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" },
  });
  assert.deepEqual(await read("picture-gone"), {
    answer: { failure: TASK_CALL_FAILURE.NOT_FOUND },
  });
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_PICTURE_KEEP, {
      ...PLAN,
      picture: "data:image/png;base64,iVBORw0KGgo=",
    }),
    { answer: { id: PICTURE_ID } },
  );
  assert.deepEqual(asked, [
    `picture:plan-1:${PICTURE_ID}`,
    "picture:plan-1:picture-gone",
    "keep:plan-1",
  ]);
});

it("a plan's comments are read again and acted on through the host from a panel", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COMMENTS_RETRY, TASK), {
    answer: undefined,
  });
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COMMENT_ACT, COMMENT_ACT), {
    answer: { deleted: THREAD_ID },
  });
  assert.deepEqual(asked, [`comments-retry:${TASK_ID}`, `act:${THREAD_ID}:resolve`]);
});

it("a pull request is answered to a panel as the host read it, or as none, and a service that did not answer is refused in its kind's own words", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (number: number) =>
    settled(client, TASKS_ACT_KIND.TASKS_PULL_REQUEST, { ...PLACE, number });

  assert.deepEqual(await ask(PULL_REQUEST.number), { answer: PULL_REQUEST });
  assert.deepEqual(await ask(PULL_REQUEST_NONE), { answer: null });
  assert.deepEqual(await ask(44), { refused: REFUSAL[TASKS_ACT_KIND.TASKS_PULL_REQUEST] });
  assert.deepEqual(asked, [
    `pullRequest:acme/relay:${PULL_REQUEST.number}`,
    `pullRequest:acme/relay:${PULL_REQUEST_NONE}`,
    "pullRequest:acme/relay:44",
  ]);
});

it("an issue is answered to a panel as the host read it, or as none, and a service that did not answer is refused in its kind's own words", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (number: number) => settled(client, TASKS_ACT_KIND.TASKS_ISSUE, { ...PLACE, number });

  assert.deepEqual(await ask(ISSUE.number), { answer: ISSUE });
  assert.deepEqual(await ask(ISSUE_NONE), { answer: null });
  assert.deepEqual(await ask(9), { refused: REFUSAL[TASKS_ACT_KIND.TASKS_ISSUE] });
  assert.deepEqual(asked, [
    `issue:acme/relay:${ISSUE.number}`,
    `issue:acme/relay:${ISSUE_NONE}`,
    "issue:acme/relay:9",
  ]);
});

it("a tab opened in an agent's browser is answered to a panel as the host read it, why none opened among it, for the panel's words", async () => {
  const { client, asked } = windowPort(PANEL);
  const open = (agentId: string) =>
    settled(client, TASKS_ACT_KIND.TASKS_BROWSER_TAB_OPEN, { ...BROWSER_TAB_OPEN, agentId });

  assert.deepEqual(await open(BROWSER_TAB_OPEN.agentId), {
    answer: {
      tab: {
        ...BROWSER_TAB,
        agentId: BROWSER_TAB_OPEN.agentId,
        openedBy: { kind: "member", userId: "user-ada" },
        driver: { userId: "user-ada", heldUntil: 62_000 },
      },
    },
  });
  assert.deepEqual(await open(AGENT_UNREACHABLE), {
    answer: { failure: BROWSER_TAB_OPEN_FAILURE.UNREACHABLE },
  });
  assert.deepEqual(asked, [
    `browserTabOpen:${BROWSER_TAB_OPEN.agentId}`,
    `browserTabOpen:${AGENT_UNREACHABLE}`,
  ]);
});

it("a content act's payload carrying a key its schema does not name, or past its bound, is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  for (const act of ACTS.slice(
    ACTS.findIndex((each) => each.kind === TASKS_ACT_KIND.TASKS_SET_STANDING),
  )) {
    // SAFETY: every content kind but the two earlier-page presses takes an object payload, which ACTS gives it.
    const payload =
      act.payload === undefined ? { extra: true } : { ...(act.payload as object), extra: true };
    assert.deepEqual(
      // SAFETY: a key the schema does not name, refused on purpose.
      await settled(client, act.kind, payload as AnyPayload),
      { refused: REFUSAL[act.kind] },
    );
  }
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_COLOR_CODE, {
      language: "ts",
      code: "a".repeat(20_001),
    }),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_COLOR_CODE] },
  );
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_COLOR_CODE, { language: "  ", code: "a" }),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_COLOR_CODE] },
  );
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_SET_STANDING, TASK), {
    refused: REFUSAL[TASKS_ACT_KIND.TASKS_SET_STANDING],
  });
  assert.deepEqual(asked, []);
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
