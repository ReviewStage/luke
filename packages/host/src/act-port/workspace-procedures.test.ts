import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { HOSTED_API_ERROR } from "@repo/features";
import { WORKSPACE_ROLE, WORKSPACE_SLUG_PROBLEM } from "@repo/features/workspace-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import {
  ALREADY_INVITED_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
  WORKSPACE_SLUG_REFUSAL,
} from "../acts.js";
import { WORKSPACE_ACT_KIND, WORKSPACE_ACTS } from "../contract/index.js";
import { ActRefused } from "../host-acts.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { type TestActPort, testActPort } from "./testing.js";
import {
  type WorkspaceProceduresDependencies,
  workspaceProcedures,
} from "./workspace-procedures.js";

/**
 * The workspace acts, through the act port as a window calls them, over the
 * host that answers them: only a panel of this build's own renderer asks,
 * and any other window, and a frame this build does not trust, are refused
 * in each act's own words before the service is asked; a refusal the service
 * names is refused in words that say why, and anything else in the act's
 * own; and an address the service named for a connection opens only where
 * it stands on that connection's own origin.
 */

const PANEL: ActSender = { sender: Symbol("panel"), panel: true };
const OTHER_WINDOW: ActSender = { sender: Symbol("takeover"), panel: false };

/** The account the host stands signed in to, so an act reaches the service. */
const SIGNED_IN = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-dana",
  email: "dana@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

const WORKSPACE = { workspaceId: "workspace-acme" };
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
const SENTRY_INSTALL_URL = "https://sentry.io/sentry-apps/luke/external-install/?state=fixture";

/** Each relayed act, with a payload its schema takes and the sentence it is refused in. */
const ACTS: readonly {
  readonly kind: (typeof WORKSPACE_ACTS)[keyof typeof WORKSPACE_ACTS]["kind"];
  readonly payload: WireBoundaryInput;
  /** Its refusal, as the window drew it before the act was declared. */
  readonly refusal: string;
}[] = [
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_CREATE,
    refusal: "Could not make that workspace on this system.",
    payload: { name: "Relay Labs" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_RENAME,
    refusal: "Could not rename that workspace on this system.",
    payload: { ...WORKSPACE, name: "Acme Labs" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET,
    refusal: "Could not change that workspace's link on this system.",
    payload: { ...WORKSPACE, slug: "acme-labs" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET,
    refusal: "Could not change that workspace's photo on this system.",
    payload: { ...WORKSPACE, photo: null },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_INVITE,
    refusal: "Could not invite that address on this system.",
    payload: { ...WORKSPACE, email: "alan@app.test", role: WORKSPACE_ROLE.MEMBER },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL,
    refusal: "Could not cancel that invitation on this system.",
    payload: { ...WORKSPACE, invitationId: "inv-1" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT,
    refusal: "Could not disconnect GitHub from that workspace on this system.",
    payload: WORKSPACE,
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT,
    refusal: "Could not disconnect Sentry from that workspace on this system.",
    payload: { ...WORKSPACE, installationId: "installation-1" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT,
    refusal: "Could not connect the Slack bot to that workspace on this system.",
    payload: WORKSPACE,
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT,
    refusal: "Could not disconnect the Slack bot from that workspace on this system.",
    payload: WORKSPACE,
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS,
    refusal: "Could not change your Slack notifications on this system.",
    payload: { ...WORKSPACE, notifications: false },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY,
    refusal: "Could not change the Slack bot's default repository on this system.",
    payload: { ...WORKSPACE, repository: null },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL,
    refusal: "Could not change that Slack channel on this system.",
    payload: { ...WORKSPACE, channelId: "C1", member: false },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE,
    refusal: "Could not remove that member on this system.",
    payload: { ...WORKSPACE, userId: "user-grace" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE,
    refusal: "Could not change that member's role on this system.",
    payload: { ...WORKSPACE, userId: "user-grace", role: WORKSPACE_ROLE.ADMIN },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER,
    refusal: "Could not transfer that workspace on this system.",
    payload: { ...WORKSPACE, userId: "user-grace" },
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_LEAVE,
    refusal: "Could not leave that workspace on this system.",
    payload: WORKSPACE,
  },
  {
    kind: WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET,
    refusal: "Could not change that workspace's repositories on this system.",
    payload: { ...WORKSPACE, repository: "acme/relay", added: true },
  },
];

/** What the host sent the service on an act's behalf: every request but the reads it opens on its own, which only read. */
function asksSent<Request extends { readonly method: string }>(requests: readonly Request[]) {
  return requests.filter((request) => request.method !== "GET");
}

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

it.effect.each(ACTS)(
  "$kind is refused a window that is not a panel, and a frame this build does not trust, in its own words, and the service is not asked",
  (act) =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({ account: SIGNED_IN });

      const refused = [
        yield* port.perform(act, OTHER_WINDOW),
        yield* port.perform(act, PANEL, { trusted: false }),
      ];

      assert.deepEqual(refused, [{ refused: act.refusal }, { refused: act.refusal }]);
      assert.deepEqual(asksSent(requests), []);
    }),
);

it.effect(
  "a workspace act the service refuses for a reason it names is refused in words that say so, and one it does not answer in the act's own",
  () =>
    Effect.gen(function* () {
      let refusal: string | undefined;
      const { port } = yield* hostActPort({
        account: SIGNED_IN,
        respond: (request) =>
          request.method !== "GET" && refusal !== undefined
            ? Response.json({ error: refusal }, { status: 403 })
            : new Response(null, { status: 503 }),
      });
      const remove = ACTS.find((act) => act.kind === WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE);
      const invite = ACTS.find((act) => act.kind === WORKSPACE_ACT_KIND.WORKSPACE_INVITE);
      const slug = ACTS.find((act) => act.kind === WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET);
      assert.ok(remove && invite && slug);

      refusal = HOSTED_API_ERROR.NOT_PERMITTED;
      const notPermitted = yield* port.perform(remove, PANEL);
      refusal = HOSTED_API_ERROR.ALREADY_INVITED;
      const alreadyInvited = yield* port.perform(invite, PANEL);
      refusal = HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN;
      const slugTaken = yield* port.perform(slug, PANEL);
      refusal = undefined;
      const unanswered = yield* port.perform(invite, PANEL);

      assert.deepEqual(notPermitted, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(alreadyInvited, { refused: ALREADY_INVITED_REFUSAL });
      assert.deepEqual(slugTaken, {
        refused: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN],
      });
      assert.deepEqual(unanswered, { refused: invite.refusal });
    }),
);

/**
 * A panel's port over the connections' procedures alone, each handler
 * answering the address `answers` names for it or the refusal it fails
 * with, every address opened kept in `opened`.
 */
function connectPort(answers: {
  readonly github: Effect.Effect<string, ActRefused>;
  readonly sentry: Effect.Effect<string, ActRefused>;
}) {
  const opened: string[] = [];
  const dependencies: WorkspaceProceduresDependencies = {
    // SAFETY: a connection's procedure reads no follow of the host's, so none is handed.
    host: {} as WorkspaceProceduresDependencies["host"],
    openExternal: async (url) => {
      opened.push(url);
    },
  };
  const port = testActPort(
    workspaceProcedures(dependencies, {
      WORKSPACE_GITHUB_CONNECT: () => answers.github,
      WORKSPACE_SENTRY_INSTALL: () => answers.sentry,
    }),
  );
  ports.push(port);
  return { port, opened };
}

it.effect(
  "a connection opens the address its handler answered only where it stands on the connection's own origin, and a refused one opens nothing",
  () =>
    Effect.gen(function* () {
      const github = { kind: WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT, payload: WORKSPACE };
      const sentry = { kind: WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL, payload: WORKSPACE };
      const own = connectPort({
        github: Effect.succeed(INSTALL_URL),
        sentry: Effect.succeed(SENTRY_INSTALL_URL),
      });
      const elsewhere = connectPort({
        github: Effect.succeed("https://evil.test/apps/luke/installations/new"),
        sentry: Effect.succeed("https://sentry.example/sentry-apps/luke/external-install/"),
      });
      const refused = connectPort({
        github: Effect.fail(new ActRefused({ sentence: WORKSPACE_NOT_PERMITTED_REFUSAL })),
        sentry: Effect.fail(new ActRefused({})),
      });

      const opening = [
        yield* own.port.perform(github, PANEL),
        yield* own.port.perform(sentry, PANEL),
      ];
      const offOrigin = [
        yield* elsewhere.port.perform(github, PANEL),
        yield* elsewhere.port.perform(sentry, PANEL),
      ];
      const refusing = [
        yield* refused.port.perform(github, PANEL),
        yield* refused.port.perform(sentry, PANEL),
      ];

      assert.deepEqual(opening, [{ answer: undefined }, { answer: undefined }]);
      assert.deepEqual(own.opened, [INSTALL_URL, SENTRY_INSTALL_URL]);
      assert.deepEqual(offOrigin, [
        { refused: WORKSPACE_ACTS.WORKSPACE_GITHUB_CONNECT.refusal },
        { refused: WORKSPACE_ACTS.WORKSPACE_SENTRY_INSTALL.refusal },
      ]);
      assert.deepEqual(refusing, [
        { refused: WORKSPACE_NOT_PERMITTED_REFUSAL },
        { refused: WORKSPACE_ACTS.WORKSPACE_SENTRY_INSTALL.refusal },
      ]);
      assert.deepEqual([...elsewhere.opened, ...refused.opened], []);
    }),
);
