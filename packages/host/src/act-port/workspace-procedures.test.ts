import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ORPCError } from "@orpc/client";
import { WORKSPACE_CALL_FAILURE } from "@repo/features";
import type {
  TasksWorkspaceGitHubConnectAnswer,
  WorkspaceInvitationsFollowed,
} from "@repo/features/tasks-view";
import { WORKSPACE_PHOTO_TYPE, WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { ALREADY_INVITED_REFUSAL, WORKSPACE_NOT_PERMITTED_REFUSAL } from "../acts.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  WORKSPACE_ACT_KIND,
} from "../contract/index.js";
import type { ActSender } from "./base.js";
import { type TestActPort, testActPort } from "./testing.js";
import {
  type WorkspaceProceduresDependencies,
  workspaceProcedures,
} from "./workspace-procedures.js";

/**
 * The workspace acts, through the act port as a window calls them: only a
 * panel of this build's own renderer asks; any other window, and
 * a frame this build does not trust, are refused in each kind's own words
 * before the host is asked; a panel's ask reaches the host with its payload
 * as the kind's schema read it, and answers what the host answered; a write
 * the account's role does not allow and an address already invited are
 * refused in words that say so; and an
 * address the service named opens only where it is the one kind its
 * connection may open.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const INVITATION = {
  id: "inv-1",
  email: "alan@app.test",
  role: WORKSPACE_ROLE.MEMBER,
  expiresAt: "2026-10-16T12:00:00.000Z",
  acceptUrl: "https://app.test/accept-invitation.html?id=inv-1",
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
  email: "grace@app.test",
  role: WORKSPACE_ROLE.MEMBER,
};
const SENTRY_INSTALL_URL = "https://sentry.io/sentry-apps/luke/external-install/?state=fixture";
const SENTRY_INSTALLATION = { installationId: "installation-1", account: "acme" };

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
  [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]:
    "Could not install Sentry for that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT]:
    "Could not disconnect Sentry from that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY]:
    "Could not read that workspace's members again on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE]: "Could not remove that member on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE]: "Could not change that member's role on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER]: "Could not transfer that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_LEAVE]: "Could not leave that workspace on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ]:
    "Could not read that workspace's photo on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET]:
    "Could not change that workspace's photo on this system.",
  [WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET]: "Could not change that workspace's link on this system.",
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
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY, payload: WORKSPACE },
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
  { kind: WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET, payload: { ...WORKSPACE, slug: "acme-labs" } },
];

/** What the fake host answers, set by each test before it asks. */
interface Script {
  /** Whether every write is refused as the account's role not allowing it. */
  notPermitted: boolean;
  /** Whether an invitation is refused as the address already invited. */
  alreadyInvited: boolean;
  /** The address a GitHub connection answers to open. */
  connectUrl: string;
  /** The address a Sentry install answers to open. */
  sentryInstallUrl: string;
}

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/**
 * A window's act port, opened as the bridge opens one, over a fake host
 * holding the Acme workspace with Grace in it: the window standing as
 * `actor`, trusted or not.
 */
function windowPort(actor: ActSender, options: { trusted?: boolean } = {}) {
  const asked: string[] = [];
  const browsed: string[] = [];
  const invitationListeners = new Set<(changed: WorkspaceInvitationsFollowed) => void>();
  const script: Script = {
    notPermitted: false,
    alreadyInvited: false,
    connectUrl: INSTALL_URL,
    sentryInstallUrl: SENTRY_INSTALL_URL,
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
    workspaceTokenRepositoriesFollow: (params) =>
      ask(`tokenRepositoriesFollow:${params.workspaceId}`, () => undefined),
    workspaceTokenRepositoriesUnfollow: (params) =>
      ask(`tokenRepositoriesUnfollow:${params.workspaceId}`, () => undefined),
    workspaceTokenRepositoriesRetry: (params) =>
      ask(`tokenRepositoriesRetry:${params.workspaceId}`, () => undefined),
    workspaceTokenRepositorySet: (params) =>
      ask(`tokenRepositorySet:${params.workspaceId}:${params.repository}:${params.added}`, () =>
        script.notPermitted ? refusal() : { repositories: [] },
      ),
    workspaceCreate: (params) =>
      ask(`create:${params.name}`, () =>
        script.notPermitted ? refusal() : { workspace: { ...ACME, name: params.name } },
      ),
    workspaceRename: (params) =>
      ask(`rename:${params.workspaceId}:${params.name}`, () =>
        script.notPermitted ? refusal() : { workspace: { ...ACME, name: params.name } },
      ),
    workspaceSlugSet: (params) =>
      ask(`slugSet:${params.workspaceId}:${params.slug}`, () =>
        script.notPermitted ? refusal() : { workspace: { ...ACME, slug: params.slug } },
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
    workspaceSentryInstall: (params) =>
      ask(
        `sentry-install:${params.workspaceId}`,
        (): TasksWorkspaceGitHubConnectAnswer =>
          script.notPermitted ? refusal() : { url: script.sentryInstallUrl },
      ),
    workspaceSentryDisconnect: (params) =>
      ask(`sentry-disconnect:${params.workspaceId}:${params.installationId}`, () =>
        script.notPermitted ? refusal() : { sentry: { configured: true, installations: [] } },
      ),
    workspaceSlackBot: (params) =>
      ask(`slack-bot:${params.workspaceId}`, () => ({ slackBot: { configured: true } })),
    workspaceSlackBotConnect: (params) =>
      ask(`slack-bot-connect:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : { slackBot: { configured: true } },
      ),
    workspaceSlackBotDisconnect: (params) =>
      ask(`slack-bot-disconnect:${params.workspaceId}`, () =>
        script.notPermitted ? refusal() : { slackBot: { configured: true } },
      ),
    workspaceSlackBotNotifications: (params) =>
      ask(`slack-bot-notifications:${params.workspaceId}`, () => ({
        slackBot: { configured: true },
      })),
    workspaceSlackBotRepository: (params) =>
      ask(`slack-bot-repository:${params.workspaceId}`, () => ({
        slackBot: { configured: true },
      })),
    workspaceSlackBotChannel: (params) =>
      ask(`slack-bot-channel:${params.workspaceId}`, () => ({
        slackBot: { configured: true },
      })),
    workspaceMembersFollow: (scope) => ask(`membersFollow:${scope.workspaceId}`, () => undefined),
    workspaceMembersUnfollow: (scope) =>
      ask(`membersUnfollow:${scope.workspaceId}`, () => undefined),
    workspaceMembersRetry: (scope) => ask(`membersRetry:${scope.workspaceId}`, () => undefined),
    workspaceIntegrationsFollow: (params) =>
      ask(`integrationsFollow:${params.workspaceId}`, () => undefined),
    workspaceIntegrationsUnfollow: (params) =>
      ask(`integrationsUnfollow:${params.workspaceId}`, () => undefined),
    workspaceIntegrationsRetry: (params) =>
      ask(`integrationsRetry:${params.workspaceId}`, () => undefined),
    workspaceSlackChannelsFollow: (params) =>
      ask(`slackChannelsFollow:${params.workspaceId}`, () => undefined),
    workspaceSlackChannelsUnfollow: (params) =>
      ask(`slackChannelsUnfollow:${params.workspaceId}`, () => undefined),
    workspaceSlackChannelsRetry: (params) =>
      ask(`slackChannelsRetry:${params.workspaceId}`, () => undefined),
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
        script.notPermitted || params.workspaceId !== ACME.id
          ? refusal()
          : { invitations: [INVITATION] },
      ),
    workspaceInvite: (params) =>
      ask(`invite:${params.workspaceId}:${params.email}`, () =>
        script.alreadyInvited
          ? ({ failure: WORKSPACE_CALL_FAILURE.ALREADY_INVITED } as const)
          : { invitation: INVITATION },
      ),
    workspaceInvitationCancel: (params) =>
      ask(`cancel:${params.workspaceId}:${params.invitationId}`, () => ({ invitations: [] })),
    workspaceInvitationsFollow: (scope) =>
      ask(`invitationsFollow:${scope.workspaceId}`, () => undefined),
    workspaceInvitationsUnfollow: (scope) =>
      ask(`invitationsUnfollow:${scope.workspaceId}`, () => undefined),
    onWorkspaceInvitationsChanged: (listener) => {
      invitationListeners.add(listener);
      return () => invitationListeners.delete(listener);
    },
  };
  const port = testActPort(
    workspaceProcedures({
      host,
      openExternal: (url) => {
        browsed.push(url);
        return Promise.resolve();
      },
    }),
  );
  ports.push(port);
  const client = port.as(actor, { trusted: options.trusted ?? true });
  /** The host telling a workspace's invitations. */
  const tellInvitations = (changed: WorkspaceInvitationsFollowed) => {
    for (const listener of [...invitationListeners]) listener(changed);
  };
  return { client, asked, browsed, script, tellInvitations };
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

it("a window that is not a panel is refused every workspace act in the kind's own words, and the host is not asked", async () => {
  const { client, asked, browsed } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
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
  assert.deepEqual(await ask(WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY, WORKSPACE), {
    answer: undefined,
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
    `membersRetry:${ACME.id}`,
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

it("a workspace's Sentry install opens only Sentry's own address, and a disconnect answers what remains or is refused in words that say why", async () => {
  const { client, browsed, script } = windowPort(PANEL);
  const disconnect = { ...WORKSPACE, installationId: SENTRY_INSTALLATION.installationId };

  const installed = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL, WORKSPACE);
  script.sentryInstallUrl = "https://sentry.example/sentry-apps/luke/external-install/";
  const elsewhere = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL, WORKSPACE);
  const disconnected = await settled(
    client,
    WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT,
    disconnect,
  );
  script.notPermitted = true;
  const refused = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT, disconnect);

  assert.deepEqual(installed, { answer: undefined });
  assert.deepEqual(elsewhere, { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL] });
  assert.deepEqual(browsed, [SENTRY_INSTALL_URL]);
  assert.deepEqual(disconnected, { answer: { configured: true, installations: [] } });
  assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
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
  const unread = await settled(client, WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ, {
    workspaceId: "workspace-gone",
  });

  const notPermitted = { refused: WORKSPACE_NOT_PERMITTED_REFUSAL };
  assert.deepEqual(refusedNow, Array(6).fill(notPermitted));
  assert.deepEqual(unread, { refused: REFUSAL[WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ] });
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

it("a payload carrying a key its kind's schema does not name is refused, and the host is not asked", async () => {
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

/** The event loop turned until `ready` holds, or two hundred turns pass. */
async function until(ready: () => boolean) {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

it("a workspace's invitations stream to the window following them, and the host lets them go with the last stream", async () => {
  const { client, asked, tellInvitations } = windowPort(PANEL);
  const stream = await client[WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS](WORKSPACE);
  const next = stream.next();
  await until(() => asked.length === 1);

  tellInvitations({ ...WORKSPACE, view: { invitations: [INVITATION] } });

  assert.deepEqual((await next).value, { invitations: [INVITATION] });
  await stream.return(undefined);
  await until(() => asked.length === 2);
  assert.deepEqual(asked, [`invitationsFollow:${ACME.id}`, `invitationsUnfollow:${ACME.id}`]);
});
