import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { highlightSnippet } from "@sidecar/host";
import { WORKSPACE_CALL_FAILURE } from "@sidecar/hosted";
import { PLAN_FILE_REFUSAL } from "@sidecar/hosted/plan-wire";
import {
  type CodeLines,
  PLAN_CALL_FAILURE,
  type PlanningGitHubPageAnswer,
  type PlanningStartAnswer,
  type PlanningWorkspaceGitHubConnectAnswer,
} from "@sidecar/hosted/planning-view";
import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  COLOURED_CODE_MAX_CHARS,
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
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
const ACME = {
  id: "workspace-acme",
  name: "acme",
  personal: false,
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
};
const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
};
const REQUEST = { name: "Teammate invitations", repository: "acme/relay" };
const CONNECT_PAGE = "https://tryluke.dev/connect-github.html?intent=intent-1";
const DISCONNECT_PAGE = "https://tryluke.dev/connect-github.html?disconnect=1";

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

function fixture() {
  const asked: string[] = [];
  const talked: string[] = [];
  const opened: string[] = [];
  const view: OpenPlan = { activePlanId: PLAN_ID };
  /**
   * Whether the host refuses a workspace write as the account's role not
   * allowing it, the install address a connection answers, and whether the
   * host names no page to connect the account's own GitHub.
   */
  const host = { notPermitted: false, connectUrl: INSTALL_URL, githubUnanswered: false };
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
      githubConnect: () =>
        Effect.sync((): PlanningGitHubPageAnswer => {
          asked.push("github-connect");
          return host.githubUnanswered
            ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
            : { url: CONNECT_PAGE };
        }),
      githubDisconnect: () =>
        Effect.sync((): PlanningGitHubPageAnswer => {
          asked.push("github-disconnect");
          return { url: DISCONNECT_PAGE };
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
  return { router, asked, talked, opened, view, start, host };
}

it.effect("the Plans tab's asks reach the host and answer what the host answered", () =>
  Effect.gen(function* () {
    const f = fixture();

    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REFRESH }, PANEL);
    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
      PANEL,
    );
    const started = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_START, payload: REQUEST },
      PANEL,
    );
    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_CLOSE }, PANEL);
    const renamed = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_RENAME, payload: { planId: PLAN_ID, name: " Team invites " } },
      PANEL,
    );
    const pinned = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_PIN, payload: { planId: PLAN_ID, pinned: true } },
      PANEL,
    );
    const pinnedRepository = yield* f.router.performAct(
      {
        kind: ACT_KIND.PLANNING_PIN_REPOSITORY,
        payload: { repository: "acme/relay", pinned: true },
      },
      PANEL,
    );
    const archived = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_ARCHIVE, payload: { planId: PLAN_ID, archived: false } },
      PANEL,
    );
    const deleted = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_DELETE, payload: { planId: PLAN_ID } },
      PANEL,
    );

    assert.deepEqual(renamed, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(pinned, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(pinnedRepository, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(archived, { status: ACT_OUTCOME_STATUS.DONE, value: false });
    assert.deepEqual(deleted, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(selected, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(started, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
    });
    assert.deepEqual(f.asked, [
      "refresh",
      `open:${PLAN_ID}`,
      "start:acme/relay",
      "close",
      `rename:${PLAN_ID}:Team invites`,
      `pin:${PLAN_ID}:true`,
      "pin-repository:acme/relay:true",
      `archive:${PLAN_ID}:false`,
      `delete:${PLAN_ID}`,
    ]);
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
  "inviting people opens the service's invite page for the workspace, from a panel alone, and asks the host nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const invited = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_INVITE, payload: { workspaceId: "org a&b" } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.WORKSPACE_INVITE, payload: { workspaceId: ACME.id } },
        VOICE,
      );

      assert.equal(invited.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.opened, [`${SERVICE}/invite.html?workspace=org+a%26b`]);
      assert.deepEqual(f.asked, []);
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
  "the repository chip's read and a plan's repository reach the host, and answer what it answered",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const listed = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_REPOSITORIES, payload: { workspaceId: ACME.id } },
        PANEL,
      );
      const changed = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_SET_REPOSITORY, payload: { planId: PLAN_ID, repository: null } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_REPOSITORIES, payload: {} },
        VOICE,
      );

      assert.deepEqual(listed, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
      });
      assert.deepEqual(changed, { status: ACT_OUTCOME_STATUS.DONE, value: { repository: null } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`repositories:${ACME.id}`, `repository:${PLAN_ID}:null`]);
    }),
);

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
  "the Work tab's ask for earlier work reaches the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const read = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_WORK_EARLIER }, PANEL);
      const fromVoice = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_WORK_EARLIER }, VOICE);

      assert.equal(read.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_WORK_EARLIER].refusal,
      });
      assert.deepEqual(f.asked, ["earlier"]);
    }),
);

it.effect(
  "a File tab's window reaches the host from a panel and answers what it answered, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const window = { planId: PLAN_ID, path: "src/gone.ts", firstLine: 1, lastLine: 500 };

      const read = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_FILE, payload: window },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_FILE, payload: window },
        VOICE,
      );

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { refusal: PLAN_FILE_REFUSAL.MISSING },
      });
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_FILE].refusal,
      });
      assert.deepEqual(f.asked, ["file:src/gone.ts:1-500"]);
    }),
);

it.effect(
  "a File tab's tree lists a folder through the host from a panel and answers what it answered, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const folder = { planId: PLAN_ID, path: "src" };

      const read = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_TREE, payload: folder },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_TREE, payload: folder },
        VOICE,
      );

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE },
      });
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_TREE].refusal,
      });
      assert.deepEqual(f.asked, ["tree:src"]);
    }),
);

it.effect(
  "a repository's skills are read through the host from a panel and answer what it answered, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const plan = { planId: PLAN_ID };

      const read = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_SKILLS, payload: plan },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_SKILLS, payload: plan },
        VOICE,
      );

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY },
      });
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_SKILLS].refusal,
      });
      assert.deepEqual(f.asked, [`skills:${PLAN_ID}`]);
    }),
);

it.effect(
  "the version history's reads and its restore reach the host from a panel, and never from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const page = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_REVISIONS, payload: { planId: PLAN_ID, before: 3 } },
        PANEL,
      );
      const revision = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_REVISION, payload: { planId: PLAN_ID, seq: 2 } },
        PANEL,
      );
      const restored = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_RESTORE, payload: { planId: PLAN_ID, seq: 2 } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_RESTORE, payload: { planId: PLAN_ID, seq: 2 } },
        VOICE,
      );

      assert.deepEqual(page, { status: ACT_OUTCOME_STATUS.DONE, value: { revisions: [] } });
      assert.deepEqual(revision, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
      });
      assert.deepEqual(restored, { status: ACT_OUTCOME_STATUS.DONE, value: true });
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_RESTORE].refusal,
      });
      assert.deepEqual(f.asked, [`revisions:${PLAN_ID}:3`, "revision:2", "restore:2"]);
    }),
);

it.effect(
  "a transcript's fenced block is coloured from a panel as its fence's language, refused from the voice window, and a block past the bound is refused at the boundary",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const block = { language: "ts", code: "export const seats = 3;\nseats;" };

      const coloured = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_COLOUR_CODE, payload: block },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_COLOUR_CODE, payload: block },
        VOICE,
      );
      const tooLong = yield* f.router.performAct(
        {
          kind: ACT_KIND.PLANNING_COLOUR_CODE,
          payload: { language: "ts", code: "a".repeat(COLOURED_CODE_MAX_CHARS + 1) },
        },
        PANEL,
      );

      assert.equal(coloured.status, ACT_OUTCOME_STATUS.DONE);
      assert.ok(coloured.status === ACT_OUTCOME_STATUS.DONE && Array.isArray(coloured.value));
      // SAFETY: the router admitted the answer through the kind's own guard, which reads coloured lines.
      const [first, second] = coloured.value as CodeLines;
      assert.deepEqual(
        [first, second].map((line) => line?.map((token) => token.text).join("")),
        ["export const seats = 3;", "seats;"],
      );
      assert.ok(first?.find((token) => token.text === "export")?.color, "the keyword is coloured");
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_COLOUR_CODE].refusal,
      });
      assert.notEqual(tooLong.status, ACT_OUTCOME_STATUS.DONE);
    }),
);

it.effect(
  "Connect GitHub opens the page the host named in the browser, Disconnect its own, and neither from the voice window",
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
      assert.deepEqual(f.opened, [CONNECT_PAGE, DISCONNECT_PAGE]);
    }),
);

it.effect("Open on GitHub opens a GitHub address in the browser, and no other address at all", () =>
  Effect.gen(function* () {
    const f = fixture();

    const opened = yield* f.router.performAct(
      { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay" } },
      PANEL,
    );
    const elsewhere = yield* f.router.performAct(
      // SAFETY: an address off GitHub is what the schema refuses, so it is sent as the shape it would arrive in.
      { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://example.com/acme/relay" } } as never,
      PANEL,
    );

    assert.equal(opened.status, ACT_OUTCOME_STATUS.DONE);
    assert.notEqual(elsewhere.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(f.opened, ["https://github.com/acme/relay"]);
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

it.effect("the panel's board save reaches the host with the drawing its scene holds", () =>
  Effect.gen(function* () {
    const f = fixture();

    const saved = yield* f.router.performAct(
      {
        kind: ACT_KIND.PLANNING_BOARD_SAVE,
        payload: { planId: PLAN_ID, elements: [], appliedDrawing: 3 },
      },
      PANEL,
    );

    assert.equal(saved.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(f.asked, [`board:${PLAN_ID}:3`]);
  }),
);

it.effect(
  "the Plans tab's microphone tells the voice window about the plan the host has open, and is refused with none open or from any other window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const talked = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, PANEL);
      assert.equal(talked.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(f.talked, [PLAN_ID]);

      const refused = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, VOICE);
      assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
      f.view.activePlanId = undefined;
      const unopened = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, PANEL);
      assert.deepEqual(unopened, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_TALK].refusal,
      });
      assert.deepEqual(f.talked, [PLAN_ID]);
    }),
);

it.effect(
  "a started plan opens its call at once when voice could open one without asking, so Luke's greeting needs no second press",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const NEW_PLAN_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
      f.start.answer = { planId: NEW_PLAN_ID };

      const started = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_START, payload: REQUEST },
        PANEL,
      );

      assert.deepEqual(started, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { planId: NEW_PLAN_ID },
      });
      assert.deepEqual(f.talked, [NEW_PLAN_ID]);
    }),
);

it.effect(
  "a start that failed, one where the microphone would first have to be asked for, or one made while a call stands opens no call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_START, payload: REQUEST }, PANEL);

      f.start.answer = { planId: PLAN_ID };
      f.start.voiceReady = false;
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_START, payload: REQUEST }, PANEL);

      // A call already standing is left for the panel to ask about ending.
      f.start.voiceReady = true;
      f.start.callStanding = true;
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_START, payload: REQUEST }, PANEL);

      assert.deepEqual(f.talked, []);
    }),
);
