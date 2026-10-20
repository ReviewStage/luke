import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { WORKSPACE_CALL_FAILURE } from "@luke/features";
import { ISSUE_CALL_FAILURE } from "@luke/features/issue-view";
import type { TasksWorkspaceGitHubConnectAnswer } from "@luke/features/tasks-view";
import { WORKSPACE_PHOTO_TYPE, WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ALREADY_INVITED_REFUSAL,
  LINEAR_UNAVAILABLE_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "../acts.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  WORKSPACE_ACT_KIND,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  type ActPortDependencies,
  createActPortHandler,
  type IssueProceduresDependencies,
  type PlatformActProcedures,
  type WorkspaceProceduresDependencies,
} from "./index.js";

/**
 * The workspace acts, through the act port as a window calls them: only a
 * panel of this build's own renderer asks; the voice and call windows, and
 * a frame this build does not trust, are refused in each kind's own words
 * before the host is asked; a panel's ask reaches the host with its payload
 * as the kind's schema read it, and answers what the host answered; a write
 * the account's role does not allow, an address already invited, and a
 * Linear that could not be read are refused in words that say so; and an
 * address the service named opens only where it is the one kind its
 * connection may open.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const INVITATION = {
  id: "inv-1",
  email: "alan@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
  expiresAt: "2026-10-16T12:00:00.000Z",
  acceptUrl: "https://luke.test/accept-invitation.html?id=inv-1",
};
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
/** A workspace's photo as the window sends it: a WebP's `data:` URL. */
const PHOTO_URL = "data:image/webp;base64,UklGRgAAAABXRUJQ";
const ACME = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
};
const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
};
const ALAN = { userId: "user-alan", name: "Alan Turing" };
const LINEAR_SIGN_IN_URL = "https://vercel.com/connect/authorize/fixture";
const LINEAR_ISSUE = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Start a plan from Linear",
  url: "https://linear.app/acme/issue/ENG-1",
};

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: "Could not make that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_RENAME]: "Could not rename that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ]: "Could not read invitations on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITE]: "Could not invite that address on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL]:
    "Could not cancel that invitation on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]:
    "Could not connect GitHub to that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]:
    "Could not disconnect GitHub from that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT]:
    "Could not connect Linear to that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_DISCONNECT]:
    "Could not disconnect Linear from that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES]:
    "Could not read that workspace's Linear issues on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ]:
    "Could not read that workspace's members on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]:
    "Could not read who left that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE]: "Could not remove that member on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE]: "Could not change that member's role on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER]: "Could not transfer that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_LEAVE]: "Could not leave that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ]:
    "Could not read that workspace's photo on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET]:
    "Could not change that workspace's photo on this system.",
} as const;

type WorkspaceKind = keyof typeof REFUSAL;

/** What any port kind takes, the union a test hands one kind or refuses on purpose. */
type AnyPayload = PortActPayload<PortActKind>;

const WORKSPACE = { workspaceId: ACME.id };

/** One ask of every workspace kind, with a payload its schema admits. */
const ACTS: readonly { kind: WorkspaceKind; payload: AnyPayload }[] = [
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_CREATE, payload: { name: "Relay Labs" } },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_RENAME, payload: { ...WORKSPACE, name: "Acme Labs" } },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ, payload: WORKSPACE },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_INVITE,
    payload: { ...WORKSPACE, email: INVITATION.email, role: WORKSPACE_ROLE.MEMBER },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL,
    payload: { ...WORKSPACE, invitationId: INVITATION.id },
  },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_DISCONNECT, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, payload: WORKSPACE },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE,
    payload: { ...WORKSPACE, userId: GRACE.userId },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE,
    payload: { ...WORKSPACE, userId: GRACE.userId, role: WORKSPACE_ROLE.ADMIN },
  },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER, payload: { ...WORKSPACE, userId: GRACE.userId } },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_LEAVE, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ, payload: WORKSPACE },
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET, payload: { ...WORKSPACE, photo: null } },
];

/** What the fake host answers, set by each test before it asks. */
interface Script {
  /** Whether every write is refused as the account's role not allowing it. */
  notPermitted: boolean;
  /** Whether an invitation is refused as the address already invited. */
  alreadyInvited: boolean;
  /** The address a GitHub connection answers to open. */
  connectUrl: string;
  /** The address a Linear connection answers to open. */
  linearConnectUrl: string;
}

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/** The issue procedures' host, never asked here. */
const NO_ISSUES: IssueProceduresDependencies = {
  host: {
    issueList: () => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED }),
    issueRead: () => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED }),
    issueCreate: () => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED }),
    issueChange: () => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED }),
  },
};

/**
 * A window's act port, opened as the bridge opens one, over a fake host
 * holding the Acme workspace with Grace in it: the window standing as
 * `actor`, trusted or not.
 */
function windowPort(actor: ActSender, options: { trusted?: boolean } = {}) {
  const asked: string[] = [];
  const browsed: string[] = [];
  const script: Script = {
    notPermitted: false,
    alreadyInvited: false,
    connectUrl: INSTALL_URL,
    linearConnectUrl: LINEAR_SIGN_IN_URL,
  };
  const refusal = () =>
    script.notPermitted
      ? ({ failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED } as const)
      : ({ failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const);
  const ask = <A>(line: string, answer: () => A) =>
    Effect.sync(() => {
      asked.push(line);
      return answer();
    });
  const host: WorkspaceProceduresDependencies["host"] = {
    workspaceCreate: (params) =>
      ask(`create:${params.name}`, () =>
        script.notPermitted ? refusal() : { workspace: { ...ACME, name: params.name } },
      ),
    workspaceRename: (params) =>
      ask(`rename:${params.workspaceId}:${params.name}`, () =>
        script.notPermitted ? refusal() : { workspace: { ...ACME, name: params.name } },
      ),
    workspacePhotoSet: (params) =>
      ask(`photoSet:${params.workspaceId}:${params.photo ?? "none"}`, () => {
        if (script.notPermitted) return refusal();
        return { workspace: params.photo === null ? ACME : { ...ACME, photoVersion: "v2" } };
      }),
    workspaceGitHubConnect: (params) =>
      ask(
        `connect:${params.workspaceId}`,
        (): TasksWorkspaceGitHubConnectAnswer =>
          script.notPermitted ? refusal() : { url: script.connectUrl },
      ),
    workspaceGitHubDisconnect: (params) =>
      ask(`disconnect:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : { workspace: ACME },
      ),
    workspaceLinearConnect: (params) =>
      ask(
        `linear-connect:${params.workspaceId}`,
        (): TasksWorkspaceGitHubConnectAnswer =>
          script.notPermitted ? refusal() : { url: script.linearConnectUrl },
      ),
    workspaceLinearDisconnect: (params) =>
      ask(`linear-disconnect:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : { workspace: ACME },
      ),
    workspaceLinearIssues: (params) =>
      ask(`linear-issues:${params.workspaceId}`, () =>
        params.workspaceId === ACME.id
          ? { issues: [LINEAR_ISSUE] }
          : ({ failure: WORKSPACE_CALL_FAILURE.LINEAR_UNAVAILABLE } as const),
      ),
    workspaceMembers: (params) =>
      ask(`members:${params.workspaceId}`, () =>
        params.workspaceId === ACME.id ? { members: [GRACE], former: [ALAN] } : refusal(),
      ),
    workspacePhoto: (params) =>
      ask(`photo:${params.workspaceId}`, () =>
        params.workspaceId === ACME.id
          ? { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" }
          : ({ failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } as const),
      ),
    workspaceMemberRemove: (params) =>
      ask(`remove:${params.workspaceId}:${params.userId}`, () =>
        script.notPermitted ? refusal() : { members: [] },
      ),
    workspaceMemberRole: (params) =>
      ask(`role:${params.workspaceId}:${params.userId}:${params.role}`, () =>
        script.notPermitted ? refusal() : { members: [{ ...GRACE, role: params.role }] },
      ),
    workspaceTransfer: (params) =>
      ask(`transfer:${params.workspaceId}:${params.userId}`, () =>
        script.notPermitted ? refusal() : { members: [{ ...GRACE, role: WORKSPACE_ROLE.OWNER }] },
      ),
    workspaceLeave: (params) =>
      ask(`leave:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : ({ left: true } as const),
      ),
    workspaceInvitations: (params) =>
      ask(`invitations:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : { invitations: [INVITATION] },
      ),
    workspaceInvite: (params) =>
      ask(`invite:${params.workspaceId}:${params.email}`, () =>
        script.alreadyInvited
          ? ({ failure: WORKSPACE_CALL_FAILURE.ALREADY_INVITED } as const)
          : { invitation: INVITATION },
      ),
    workspaceInvitationCancel: (params) =>
      ask(`cancel:${params.workspaceId}:${params.invitationId}`, () => ({ invitations: [] })),
  };
  // SAFETY: no account ask is called here, so the account asks' host is never reached.
  const accountAsks = { host: {} } as AccountAskProceduresDependencies;
  // SAFETY: no platform act is called here, so no platform procedure is reached.
  const NO_PLATFORM = {} as PlatformActProcedures<unknown>;
  // SAFETY: no account or settings act is called here, so neither's dependencies are reached.
  const unreached = { account: {}, settings: {} } as unknown as Pick<
    ActPortDependencies,
    "account" | "settings"
  >;
  // SAFETY: no agent, inbox, chat, automation, factory, or integration act is called here, so their hosts are never reached.
  const elsewhere = {
    agentInbox: { host: {} },
    agents: { host: {}, notices: {} },
    automations: { host: {} },
    factory: { host: {} },
    integrations: { host: {} },
  } as Pick<
    ActPortDependencies,
    "agentInbox" | "agents" | "automations" | "factory" | "integrations"
  >;
  const handler = createActPortHandler(
    {
      ...unreached,
      ...elsewhere,
      accountAsks,
      issues: NO_ISSUES,
      workspaces: {
        host,
        openExternal: (url) => {
          browsed.push(url);
          return Promise.resolve();
        },
      },
    },
    NO_PLATFORM,
  );
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  handler.upgrade(port1, {
    context: () => ({
      actor,
      trusted: options.trusted ?? true,
      "effect/context": Context.empty(),
    }),
  });
  port1.start();
  const client: ActPortClient = createORPCClient(new RPCLink({ port: port2 }));
  port2.start();
  return { client, asked, browsed, script };
}

/** Any port kind's procedure, erased to the union of what every one takes and answers. */
type PortCall = (payload: PortActPayload<PortActKind>) => Promise<PortActResult<PortActKind>>;

/** One act called on the port, settled to its answer or the sentence of its refusal. */
async function settled(client: ActPortClient, kind: WorkspaceKind, payload: AnyPayload) {
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

it("the voice and call windows are refused every workspace act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked, browsed } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
    assert.deepEqual(asked, []);
    assert.deepEqual(browsed, []);
  }
});

it("a frame this build does not trust is refused every workspace act, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
});

it("the workspace acts reach the host from a panel and answer what it answered", async () => {
  const { client, asked, browsed } = windowPort(PANEL);
  const ask = (kind: WorkspaceKind, payload: AnyPayload) => settled(client, kind, payload);

  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_CREATE, { name: "Relay Labs" }), {
    answer: { ...ACME, name: "Relay Labs" },
  });
  assert.deepEqual(
    await ask(WORKSPACE_ACT_KIND.WORKSPACE_RENAME, { ...WORKSPACE, name: "  Acme Labs " }),
    { answer: { ...ACME, name: "Acme Labs" } },
  );
  assert.deepEqual(
    await ask(WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET, { ...WORKSPACE, photo: PHOTO_URL }),
    { answer: { ...ACME, photoVersion: "v2" } },
  );
  assert.deepEqual(
    await ask(WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET, { ...WORKSPACE, photo: null }),
    { answer: ACME },
  );
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT, WORKSPACE), {
    answer: undefined,
  });
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, WORKSPACE), {
    answer: undefined,
  });
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ, WORKSPACE), {
    answer: [GRACE],
  });
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ, WORKSPACE), {
    answer: [ALAN],
  });
  assert.deepEqual(
    await ask(WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE, { ...WORKSPACE, userId: GRACE.userId }),
    { answer: [] },
  );
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_LEAVE, WORKSPACE), {
    answer: undefined,
  });

  assert.deepEqual(asked, [
    "create:Relay Labs",
    `rename:${ACME.id}:Acme Labs`,
    `photoSet:${ACME.id}:${PHOTO_URL}`,
    `photoSet:${ACME.id}:none`,
    `connect:${ACME.id}`,
    `disconnect:${ACME.id}`,
    `members:${ACME.id}`,
    `members:${ACME.id}`,
    `remove:${ACME.id}:${GRACE.userId}`,
    `leave:${ACME.id}`,
  ]);
  assert.deepEqual(browsed, [INSTALL_URL]);
});

it("a member's role is changed and a workspace handed over from a panel, each answered with the members, and one the account's role does not allow is refused in words that say so", async () => {
  const { client, asked, script } = windowPort(PANEL);
  const role = {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE,
    payload: { ...WORKSPACE, userId: GRACE.userId, role: WORKSPACE_ROLE.ADMIN },
  } as const;
  const transfer = {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER,
    payload: { ...WORKSPACE, userId: GRACE.userId },
  } as const;

  const changed = await settled(client, role.kind, role.payload);
  const handedOver = await settled(client, transfer.kind, transfer.payload);
  script.notPermitted = true;
  const refused = [
    await settled(client, role.kind, role.payload),
    await settled(client, transfer.kind, transfer.payload),
  ];

  assert.deepEqual(changed, { answer: [{ ...GRACE, role: WORKSPACE_ROLE.ADMIN }] });
  assert.deepEqual(handedOver, { answer: [{ ...GRACE, role: WORKSPACE_ROLE.OWNER }] });
  const notPermitted = { refused: WORKSPACE_NOT_PERMITTED_REFUSAL };
  assert.deepEqual(refused, [notPermitted, notPermitted]);
  assert.deepEqual(asked, [
    `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
    `transfer:${ACME.id}:${GRACE.userId}`,
    `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
    `transfer:${ACME.id}:${GRACE.userId}`,
  ]);
});

it("a workspace's photo is read from a panel, its absence answered rather than refused", async () => {
  const { client, asked } = windowPort(PANEL);

  const read = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ, WORKSPACE);
  const none = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ, {
    workspaceId: "workspace-plain",
  });

  assert.deepEqual(read, {
    answer: { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" },
  });
  assert.deepEqual(none, { answer: { failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } });
  assert.deepEqual(asked, [`photo:${ACME.id}`, "photo:workspace-plain"]);
});

it("an invitation is read, made, and canceled from a panel, and an address already invited is refused in words that say so", async () => {
  const { client, asked, browsed, script } = windowPort(PANEL);
  const invite = { ...WORKSPACE, email: INVITATION.email, role: WORKSPACE_ROLE.MEMBER };

  const read = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ, WORKSPACE);
  const made = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITE, invite);
  const canceled = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL, {
    ...WORKSPACE,
    invitationId: INVITATION.id,
  });
  script.alreadyInvited = true;
  const again = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITE, invite);

  assert.deepEqual(read, { answer: [INVITATION] });
  assert.deepEqual(made, { answer: INVITATION });
  assert.deepEqual(canceled, { answer: [] });
  assert.deepEqual(again, { refused: ALREADY_INVITED_REFUSAL });
  assert.deepEqual(asked, [
    `invitations:${ACME.id}`,
    `invite:${ACME.id}:${INVITATION.email}`,
    `cancel:${ACME.id}:${INVITATION.id}`,
    `invite:${ACME.id}:${INVITATION.email}`,
  ]);
  assert.deepEqual(browsed, []);
});

it("a connection's install address opens only where it is GitHub's", async () => {
  const { client, browsed, script } = windowPort(PANEL);
  script.connectUrl = "https://evil.test/apps/luke/installations/new";

  assert.deepEqual(await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT, WORKSPACE), {
    refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT],
  });
  assert.deepEqual(browsed, []);
});

it("a workspace's Linear sign-in opens only an https address, and its issues are answered or refused in words that say how to mend it", async () => {
  const { client, browsed, script } = windowPort(PANEL);

  const connected = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT, WORKSPACE);
  script.linearConnectUrl = "http://vercel.test/connect";
  const plain = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT, WORKSPACE);
  const issues = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES, WORKSPACE);
  const none = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES, {
    workspaceId: "workspace-other",
  });

  assert.deepEqual(connected, { answer: undefined });
  assert.deepEqual(plain, { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT] });
  assert.deepEqual(browsed, [LINEAR_SIGN_IN_URL]);
  assert.deepEqual(issues, { answer: [LINEAR_ISSUE] });
  assert.deepEqual(none, { refused: LINEAR_UNAVAILABLE_REFUSAL });
});

it("a workspace write the account's role does not allow is refused in words that say so, and one unanswered in its kind's own", async () => {
  const { client, browsed, script } = windowPort(PANEL);
  script.notPermitted = true;

  const refusedNow = [
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT, WORKSPACE),
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, WORKSPACE),
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE, {
      ...WORKSPACE,
      userId: GRACE.userId,
    }),
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LEAVE, WORKSPACE),
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_RENAME, { ...WORKSPACE, name: "Acme Labs" }),
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET, { ...WORKSPACE, photo: null }),
  ];
  script.notPermitted = false;
  const unread = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ, {
    workspaceId: "workspace-gone",
  });

  const notPermitted = { refused: WORKSPACE_NOT_PERMITTED_REFUSAL };
  assert.deepEqual(refusedNow, Array(6).fill(notPermitted));
  assert.deepEqual(unread, { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ] });
  assert.deepEqual(browsed, []);
});

/** A role no workspace has. */
const EMPEROR: string = "emperor";

it("a payload its kind's schema refuses is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    // SAFETY: a role the schema does not name, refused on purpose.
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITE, {
      ...WORKSPACE,
      email: INVITATION.email,
      role: EMPEROR,
    } as AnyPayload),
    { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_INVITE] },
  );
  assert.deepEqual(asked, []);
});

it("a payload carrying a key its kind's schema does not name is refused, as app:act refused it, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    // SAFETY: a key the schema does not name, refused on purpose.
    await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_LEAVE, {
      ...WORKSPACE,
      extra: true,
    } as AnyPayload),
    { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_LEAVE] },
  );
  assert.deepEqual(asked, []);
});
