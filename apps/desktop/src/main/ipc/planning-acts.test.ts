import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { WORKSPACE_CALL_FAILURE } from "@sidecar/features";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/features/coding-agent-view";
import { PLAN_FILE_REFUSAL } from "@sidecar/features/plan-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  PLAN_CALL_FAILURE,
  type PlanningGitHubDisconnectAnswer,
  type PlanningGitHubPageAnswer,
  type PlanningStartAnswer,
  type PlanningWorkspaceGitHubConnectAnswer,
} from "@sidecar/features/planning-view";
import { WORKSPACE_ROLE } from "@sidecar/features/workspace-wire";
import { highlightSnippet } from "@sidecar/host";
import { Effect } from "effect";
import type { WebContents } from "electron";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  ALREADY_INVITED_REFUSAL,
  GITHUB_LAST_SIGN_IN_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { planningActRows } from "./planning-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SERVICE = "https://luke.test";
const INVITATION = {
  id: "inv-1",
  email: "alan@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
  expiresAt: "2026-10-16T12:00:00.000Z",
  acceptUrl: "https://luke.test/accept-invitation.html?id=inv-1",
};
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
const ACME = {
  id: "workspace-acme",
  name: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
};
const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
};
const CONNECT_PAGE = `${SERVICE}/connect-github.html?intent=intent-1`;

/** The plan the host has open, as the fixture's main process reads it. */
interface OpenPlan {
  activePlanId: string | undefined;
}

/** What the host answers a start with, and whether voice could open a call now. */
interface StartScript {
  answer: PlanningStartAnswer;
  voiceReady: boolean;
  /** Whether a call is already in progress, about whichever plan. */
  callStanding: boolean;
}

/** The HTML the service answers for a page's version, none where it does not answer. */
interface PageScript {
  html: string | undefined;
}

function fixture() {
  const asked: string[] = [];
  const page: PageScript = { html: undefined };
  const talked: string[] = [];
  const opened: string[] = [];
  const view: OpenPlan = { activePlanId: PLAN_ID };
  /**
   * Whether the host refuses a workspace write as the account's role not
   * allowing it, the install address a connection answers, whether the
   * host names no page to connect the account's own GitHub, and the pages
   * it names to connect and disconnect it.
   */
  const host = {
    notPermitted: false,
    alreadyInvited: false,
    lastSignIn: false,
    connectUrl: INSTALL_URL,
    githubUnanswered: false,
    connectPage: CONNECT_PAGE,
  };
  const refusal = () =>
    host.notPermitted
      ? ({ failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED } as const)
      : ({ failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const);
  const start: StartScript = {
    answer: { failure: PLAN_CALL_FAILURE.UNANSWERED },
    voiceReady: true,
    callStanding: false,
  };
  const rows = planningActRows({
    host: {
      planningRefresh: () => Effect.sync(() => void asked.push("refresh")),
      planningWorkEarlier: () => Effect.sync(() => void asked.push("earlier")),
      planningConversationEarlier: () => Effect.sync(() => void asked.push("conversation-earlier")),
      planningMessages: (params) =>
        Effect.sync(() => {
          asked.push(`messages:${params.planId}:${params.callId}:${params.after}`);
          return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
        }),
      planningClose: () => Effect.sync(() => void asked.push("close")),
      planningOpen: (planId) =>
        Effect.sync(() => {
          asked.push(`open:${planId}`);
          return true;
        }),
      planningDelete: (planId) =>
        Effect.sync(() => {
          asked.push(`delete:${planId}`);
          return true;
        }),
      planningRename: (params) =>
        Effect.sync(() => {
          asked.push(`rename:${params.planId}:${params.name}`);
          return true;
        }),
      planningPin: (params) =>
        Effect.sync(() => {
          asked.push(`pin:${params.planId}:${params.pinned}`);
          return true;
        }),
      planningPinRepository: (params) =>
        Effect.sync(() => {
          asked.push(`pin-repository:${params.repository}:${params.pinned}`);
          return true;
        }),
      planningArchive: (params) =>
        Effect.sync(() => {
          asked.push(`archive:${params.planId}:${params.archived}`);
          return false;
        }),
      planningStart: (request) =>
        Effect.sync(() => {
          asked.push(`start:${request.repository}`);
          return start.answer;
        }),
      planningRepositories: (params) =>
        Effect.sync(() => {
          asked.push(`repositories:${params.workspaceId}`);
          return { failure: PLAN_CALL_FAILURE.UNANSWERED } as const;
        }),
      planningSetRepository: (params) =>
        Effect.sync(() => {
          asked.push(`repository:${params.planId}:${params.repository}`);
          return { repository: params.repository };
        }),
      planningMove: (params) =>
        Effect.sync(() => {
          asked.push(`move:${params.planId}:${params.workspaceId}`);
          return { workspaceId: params.workspaceId };
        }),
      planningEdit: (params) =>
        Effect.sync(() => {
          const value = "document" in params.edit ? params.edit.document.value : "";
          asked.push(`edit:${params.planId}:${value}`);
          return { saved: true } as const;
        }),
      planningBoardSave: (params) =>
        Effect.sync(() => void asked.push(`board:${params.planId}:${params.appliedDrawing}`)),
      planningFile: (params) =>
        Effect.sync(() => {
          asked.push(`file:${params.path}:${params.firstLine}-${params.lastLine}`);
          return { refusal: PLAN_FILE_REFUSAL.MISSING } as const;
        }),
      planningTree: (params) =>
        Effect.sync(() => {
          asked.push(`tree:${params.path}`);
          return { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE } as const;
        }),
      planningSkills: (params) =>
        Effect.sync(() => {
          asked.push(`skills:${params.planId}`);
          return { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY } as const;
        }),
      planningRevisions: (params) =>
        Effect.sync(() => {
          asked.push(`revisions:${params.planId}:${params.before}`);
          return { revisions: [] };
        }),
      planningRevision: (params) =>
        Effect.sync(() => {
          asked.push(`revision:${params.seq}`);
          return { failure: PLAN_CALL_FAILURE.UNANSWERED } as const;
        }),
      planningRestore: (params) =>
        Effect.sync(() => {
          asked.push(`restore:${params.seq}`);
          return true;
        }),
      planningPage: (params) =>
        Effect.sync(() => {
          asked.push(`page:${params.pageId}:${params.version}`);
          const { html } = page;
          if (html === undefined) return { failure: PLAN_CALL_FAILURE.UNANSWERED } as const;
          return { page: { id: params.pageId, title: "Invite funnel", version: 2, at: 0, html } };
        }),
      githubConnect: () =>
        Effect.sync((): PlanningGitHubPageAnswer => {
          asked.push("github-connect");
          return host.githubUnanswered
            ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
            : { url: host.connectPage };
        }),
      githubDisconnect: () =>
        Effect.sync((): PlanningGitHubDisconnectAnswer => {
          asked.push("github-disconnect");
          return host.lastSignIn
            ? { failure: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED }
            : { connection: { connected: false, login: null } };
        }),
      workspaceCreate: (params) =>
        Effect.sync(() => {
          asked.push(`create:${params.name}`);
          return host.notPermitted ? refusal() : { workspace: { ...ACME, name: params.name } };
        }),
      workspaceGitHubConnect: (params) =>
        Effect.sync((): PlanningWorkspaceGitHubConnectAnswer => {
          asked.push(`connect:${params.workspaceId}`);
          return host.notPermitted ? refusal() : { url: host.connectUrl };
        }),
      workspaceGitHubDisconnect: (params) =>
        Effect.sync(() => {
          asked.push(`disconnect:${params.workspaceId}`);
          return host.notPermitted ? refusal() : { workspace: ACME };
        }),
      workspaceMembers: (params) =>
        Effect.sync(() => {
          asked.push(`members:${params.workspaceId}`);
          return params.workspaceId === ACME.id ? { members: [GRACE] } : refusal();
        }),
      workspaceMemberRemove: (params) =>
        Effect.sync(() => {
          asked.push(`remove:${params.workspaceId}:${params.userId}`);
          return host.notPermitted ? refusal() : { members: [] };
        }),
      workspaceLeave: (params) =>
        Effect.sync(() => {
          asked.push(`leave:${params.workspaceId}`);
          return host.notPermitted ? refusal() : ({ left: true } as const);
        }),
      workspaceInvitations: (params) =>
        Effect.sync(() => {
          asked.push(`invitations:${params.workspaceId}`);
          return host.notPermitted ? refusal() : { invitations: [INVITATION] };
        }),
      workspaceInvite: (params) =>
        Effect.sync(() => {
          asked.push(`invite:${params.workspaceId}:${params.email}`);
          return host.alreadyInvited
            ? ({ failure: WORKSPACE_CALL_FAILURE.ALREADY_INVITED } as const)
            : { invitation: INVITATION };
        }),
      workspaceInvitationCancel: (params) =>
        Effect.sync(() => {
          asked.push(`cancel:${params.workspaceId}:${params.invitationId}`);
          return { invitations: [] };
        }),
    },
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    serviceBaseUrl: SERVICE,
    activePlanId: () => view.activePlanId,
    talkAboutPlan: (planId) => {
      talked.push(planId);
    },
    voiceReady: () => start.voiceReady,
    callStanding: () => start.callStanding,
    colourCode: highlightSnippet,
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, opened, view, start, page, host };
}
it.effect(
  "the developer's edit of the text reaches the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const edit = {
        kind: ACT_KIND.PLANNING_EDIT,
        payload: {
          planId: PLAN_ID,
          edit: { document: { base: "", value: "Invites expire." } },
        },
      } as const;

      const saved = yield* f.router.performAct(edit, PANEL);
      const fromVoice = yield* f.router.performAct(edit, VOICE);

      assert.deepEqual(saved, { status: ACT_OUTCOME_STATUS.DONE, value: { saved: true } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`edit:${PLAN_ID}:Invites expire.`]);
    }),
);
it.effect(
  "a web link opens an http or https address in the browser, and no other scheme nor an address past the cap",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const refused = [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "luke://plan/7",
        "mailto:dean@example.com",
        "//example.com/docs",
        "https://",
        `https://example.com/docs?q=${"a".repeat(2_048)}`,
      ];

      const opened = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        PANEL,
      );
      const plain = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "http://localhost:3000/" } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        VOICE,
      );
      const outcomes = yield* Effect.forEach(refused, (url) =>
        f.router.performAct(
          // SAFETY: an address the schema refuses is sent as the shape it would arrive in.
          { kind: ACT_KIND.WEB_OPEN, payload: { url } } as never,
          PANEL,
        ),
      );

      assert.equal(opened.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(plain.status, ACT_OUTCOME_STATUS.DONE);
      assert.notEqual(fromVoice.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status === ACT_OUTCOME_STATUS.DONE),
        refused.map(() => false),
      );
      assert.deepEqual(f.opened, ["https://example.com/docs", "http://localhost:3000/"]);
    }),
);

it.effect("the voice window does not reach the plans", () =>
  Effect.gen(function* () {
    const f = fixture();
    const board = { planId: PLAN_ID, elements: [], appliedDrawing: 0 };

    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
      VOICE,
    );
    const saved = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_BOARD_SAVE, payload: board },
      VOICE,
    );
    assert.deepEqual(selected, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PLANNING_SELECT].refusal,
    });
    assert.deepEqual(saved, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PLANNING_BOARD_SAVE].refusal,
    });
    assert.deepEqual(f.asked, []);
  }),
);

it.effect(
  "a page's source is read through the host and coloured as HTML for a panel, plain past the bound, and not for the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const source = {
        kind: ACT_KIND.PLANNING_PAGE_SOURCE,
        payload: { planId: PLAN_ID, pageId: "page-funnel", version: 2 },
      } as const;
      const long = `<p>${"a".repeat(70_000)}</p>`;

      const unanswered = yield* f.router.performAct(source, PANEL);
      f.page.html = "<h1>Invites</h1>\n<p>sent</p>";
      const read = yield* f.router.performAct(source, PANEL);
      const fromVoice = yield* f.router.performAct(source, VOICE);
      f.page.html = long;
      const plain = yield* f.router.performAct(source, PANEL);

      assert.deepEqual(unanswered, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
      });
      assert.ok(read.status === ACT_OUTCOME_STATUS.DONE && "lines" in read.value);
      const { lines } = read.value;
      assert.deepEqual(
        lines.map((line) => line.map((run) => run.text).join("")),
        ["<h1>Invites</h1>", "<p>sent</p>"],
      );
      assert.ok(lines[0]?.some((run) => run.color !== undefined));
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_PAGE_SOURCE].refusal,
      });
      assert.deepEqual(plain, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { lines: [[{ text: long }]] },
      });
      assert.deepEqual(f.asked, ["page:page-funnel:2", "page:page-funnel:2", "page:page-funnel:2"]);
    }),
);

it.effect(
  "a planning worker's page is read through the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const page = {
        kind: ACT_KIND.PLANNING_MESSAGES,
        payload: { planId: PLAN_ID, callId: "call-models", after: "0:0" },
      } as const;

      const read = yield* f.router.performAct(page, PANEL);
      const fromVoice = yield* f.router.performAct(page, VOICE);

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`messages:${PLAN_ID}:call-models:0:0`]);
    }),
);

it.effect(
  "the workspace acts reach the host from a panel and answer what it answered, and never from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const workspace = { workspaceId: ACME.id };

      const made = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_CREATE, payload: { name: "Relay Labs" } },
        PANEL,
      );
      const connected = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: workspace },
        PANEL,
      );
      const disconnected = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, payload: workspace },
        PANEL,
      );
      const members = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_MEMBERS_READ, payload: workspace },
        PANEL,
      );
      const removed = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_MEMBER_REMOVE, payload: { ...workspace, userId: GRACE.userId } },
        PANEL,
      );
      const left = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_LEAVE, payload: workspace },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_CREATE, payload: { name: "Relay Labs" } },
        VOICE,
      );

      assert.deepEqual(made, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { ...ACME, name: "Relay Labs" },
      });
      assert.equal(connected.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(disconnected.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(members, { status: ACT_OUTCOME_STATUS.DONE, value: [GRACE] });
      assert.deepEqual(removed, { status: ACT_OUTCOME_STATUS.DONE, value: [] });
      assert.equal(left.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [
        "create:Relay Labs",
        `connect:${ACME.id}`,
        `disconnect:${ACME.id}`,
        `members:${ACME.id}`,
        `remove:${ACME.id}:${GRACE.userId}`,
        `leave:${ACME.id}`,
      ]);
      assert.deepEqual(f.opened, [INSTALL_URL]);
    }),
);

it.effect(
  "an invitation is read, made, and canceled through the host from a panel alone, and an address already invited is refused in words that say so",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const panel = (act: Parameters<typeof f.router.performAct>[0]) =>
        f.router.performAct(act, PANEL);
      const invite = {
        kind: ACT_KIND.WORKSPACE_INVITE,
        payload: { workspaceId: ACME.id, email: INVITATION.email, role: WORKSPACE_ROLE.MEMBER },
      } as const;

      const read = yield* panel({
        kind: ACT_KIND.WORKSPACE_INVITATIONS_READ,
        payload: { workspaceId: ACME.id },
      });
      const made = yield* panel(invite);
      const canceled = yield* panel({
        kind: ACT_KIND.WORKSPACE_INVITATION_CANCEL,
        payload: { workspaceId: ACME.id, invitationId: INVITATION.id },
      });
      const fromVoice = yield* f.router.performAct(invite, VOICE);
      f.host.alreadyInvited = true;
      const again = yield* panel(invite);

      assert.deepEqual(read, { status: ACT_OUTCOME_STATUS.DONE, value: [INVITATION] });
      assert.deepEqual(made, { status: ACT_OUTCOME_STATUS.DONE, value: INVITATION });
      assert.deepEqual(canceled, { status: ACT_OUTCOME_STATUS.DONE, value: [] });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(again, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ALREADY_INVITED_REFUSAL,
      });
      assert.deepEqual(f.asked, [
        `invitations:${ACME.id}`,
        `invite:${ACME.id}:${INVITATION.email}`,
        `cancel:${ACME.id}:${INVITATION.id}`,
        `invite:${ACME.id}:${INVITATION.email}`,
      ]);
      assert.deepEqual(f.opened, []);
    }),
);

it.effect("a connection's install address opens only where it is GitHub's", () =>
  Effect.gen(function* () {
    const f = fixture();
    f.host.connectUrl = "https://evil.test/apps/luke/installations/new";

    const connected = yield* f.router.performAct(
      { kind: ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: { workspaceId: ACME.id } },
      PANEL,
    );

    assert.deepEqual(connected, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.WORKSPACE_GITHUB_CONNECT].refusal,
    });
    assert.deepEqual(f.opened, []);
  }),
);

it.effect(
  "a workspace write the account's role does not allow is refused in words that say so, and one unanswered in its kind's own",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      f.host.notPermitted = true;
      const workspace = { workspaceId: ACME.id };

      const refusedNow = yield* Effect.all([
        f.router.performAct({ kind: ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: workspace }, PANEL),
        f.router.performAct(
          { kind: ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, payload: workspace },
          PANEL,
        ),
        f.router.performAct(
          {
            kind: ACT_KIND.WORKSPACE_MEMBER_REMOVE,
            payload: { ...workspace, userId: GRACE.userId },
          },
          PANEL,
        ),
        f.router.performAct({ kind: ACT_KIND.WORKSPACE_LEAVE, payload: workspace }, PANEL),
      ]);
      f.host.notPermitted = false;
      const unread = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_MEMBERS_READ, payload: { workspaceId: "workspace-gone" } },
        PANEL,
      );

      const notPermitted = {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: WORKSPACE_NOT_PERMITTED_REFUSAL,
      };
      assert.deepEqual(refusedNow, [notPermitted, notPermitted, notPermitted, notPermitted]);
      assert.deepEqual(unread, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.WORKSPACE_MEMBERS_READ].refusal,
      });
      assert.deepEqual(f.opened, []);
    }),
);

it.effect(
  "Connect GitHub opens the page the host named in the browser, Disconnect asks the host and opens nothing, and neither from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const connected = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);
      const disconnected = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_DISCONNECT }, PANEL);
      const fromVoice = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, VOICE);
      f.host.githubUnanswered = true;
      const unanswered = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);

      assert.equal(connected.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(disconnected.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(unanswered, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.GITHUB_CONNECT].refusal,
      });
      assert.deepEqual(f.opened, [CONNECT_PAGE]);
      assert.equal(f.asked.includes("github-disconnect"), true);
      f.host.lastSignIn = true;
      assert.deepEqual(yield* f.router.performAct({ kind: ACT_KIND.GITHUB_DISCONNECT }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: GITHUB_LAST_SIGN_IN_REFUSAL,
      });
    }),
);

it.effect(
  "a GitHub page the host names off the service's own origin is refused and nothing opens",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pages = [
        "file:///etc/passwd",
        "luke-evil://connect",
        "https://evil.test/connect-github.html",
      ];

      const refused = yield* Effect.forEach(pages, (page) => {
        f.host.connectPage = page;
        return f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);
      });

      assert.deepEqual(
        refused,
        pages.map(() => ({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: ACT[ACT_KIND.GITHUB_CONNECT].refusal,
        })),
      );
      assert.deepEqual(f.opened, []);
    }),
);
