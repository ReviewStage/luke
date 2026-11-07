import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { HOSTED_API_ERROR } from "@repo/features";
import { WORKSPACE_ROLE, WORKSPACE_SLUG_PROBLEM } from "@repo/features/workspace-wire";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
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

/** What a declared act's refusal row holds: a payload its schema takes, and the sentence it is refused in. */
interface RefusalRow {
  readonly payload: WireBoundaryInput;
  /** Its refusal, as the window drew it before the act was declared. */
  readonly refusal: string;
  /** Whether its procedure is written by hand, which the host's relayed port does not serve. */
  readonly byHand?: true;
}

/** Every declared act's row, keyed by its name, so an act declared with no row here does not compile. */
const REFUSAL_ROWS: { readonly [Name in keyof typeof WORKSPACE_ACTS]: RefusalRow } = {
  WORKSPACE_CREATE: {
    refusal: "Could not make that workspace on this system.",
    payload: { name: "Relay Labs" },
  },
  WORKSPACE_RENAME: {
    refusal: "Could not rename that workspace on this system.",
    payload: { ...WORKSPACE, name: "Acme Labs" },
  },
  WORKSPACE_SLUG_SET: {
    refusal: "Could not change that workspace's link on this system.",
    payload: { ...WORKSPACE, slug: "acme-labs" },
  },
  WORKSPACE_PHOTO_SET: {
    refusal: "Could not change that workspace's photo on this system.",
    payload: { ...WORKSPACE, photo: null },
  },
  WORKSPACE_INVITE: {
    refusal: "Could not invite that address on this system.",
    payload: { ...WORKSPACE, email: "alan@app.test", role: WORKSPACE_ROLE.MEMBER },
  },
  WORKSPACE_INVITATION_CANCEL: {
    refusal: "Could not cancel that invitation on this system.",
    payload: { ...WORKSPACE, invitationId: "inv-1" },
  },
  WORKSPACE_GITHUB_DISCONNECT: {
    refusal: "Could not disconnect GitHub from that workspace on this system.",
    payload: WORKSPACE,
  },
  WORKSPACE_SENTRY_DISCONNECT: {
    refusal: "Could not disconnect Sentry from that workspace on this system.",
    payload: { ...WORKSPACE, installationId: "installation-1" },
  },
  WORKSPACE_SLACK_BOT_CONNECT: {
    refusal: "Could not connect the Slack bot to that workspace on this system.",
    payload: WORKSPACE,
  },
  WORKSPACE_SLACK_BOT_DISCONNECT: {
    refusal: "Could not disconnect the Slack bot from that workspace on this system.",
    payload: WORKSPACE,
  },
  WORKSPACE_SLACK_BOT_NOTIFICATIONS: {
    refusal: "Could not change your Slack notifications on this system.",
    payload: { ...WORKSPACE, notifications: false },
  },
  WORKSPACE_SLACK_BOT_REPOSITORY: {
    refusal: "Could not change the Slack bot's default repository on this system.",
    payload: { ...WORKSPACE, repository: null },
  },
  WORKSPACE_SLACK_BOT_CHANNEL: {
    refusal: "Could not change that Slack channel on this system.",
    payload: { ...WORKSPACE, channelId: "C1", member: false },
  },
  WORKSPACE_MEMBER_REMOVE: {
    refusal: "Could not remove that member on this system.",
    payload: { ...WORKSPACE, userId: "user-grace" },
  },
  WORKSPACE_MEMBER_ROLE: {
    refusal: "Could not change that member's role on this system.",
    payload: { ...WORKSPACE, userId: "user-grace", role: WORKSPACE_ROLE.ADMIN },
  },
  WORKSPACE_TRANSFER: {
    refusal: "Could not transfer that workspace on this system.",
    payload: { ...WORKSPACE, userId: "user-grace" },
  },
  WORKSPACE_LEAVE: {
    refusal: "Could not leave that workspace on this system.",
    payload: WORKSPACE,
  },
  WORKSPACE_DELETE: {
    refusal: "Could not delete that workspace on this system.",
    payload: WORKSPACE,
  },
  WORKSPACE_TOKEN_REPOSITORY_SET: {
    refusal: "Could not change that workspace's repositories on this system.",
    payload: { ...WORKSPACE, repository: "acme/relay", added: true },
  },
  WORKSPACE_GITHUB_CONNECT: {
    refusal: "Could not connect GitHub to that workspace on this system.",
    payload: WORKSPACE,
    byHand: true,
  },
  WORKSPACE_SENTRY_INSTALL: {
    refusal: "Could not install Sentry for that workspace on this system.",
    payload: WORKSPACE,
    byHand: true,
  },
};

/** Each declared act, with its kind and its row. */
const ACTS = Object.values(WORKSPACE_ACTS).map((act) => ({
  kind: act.kind,
  ...REFUSAL_ROWS[act.name],
}));

/** What the host sent the service on an act's behalf: every request but the reads it opens on its own, which only read. */
function asksSent<Request extends { readonly method: string }>(requests: readonly Request[]) {
  return requests.filter((request) => request.method !== HTTP_METHOD.GET);
}

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

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

it.effect.each(ACTS)(
  "$kind is refused a window that is not a panel, and a frame this build does not trust, in its own words, and nothing is asked or opened",
  (act) =>
    Effect.gen(function* () {
      // Note that a connection is served by its own procedure, over handlers that would open an address on its own origin.
      const { port, done } = yield* act.byHand
        ? Effect.sync(() => {
            const connect = connectPort({
              github: Effect.succeed(INSTALL_URL),
              sentry: Effect.succeed(SENTRY_INSTALL_URL),
            });
            return { port: connect.port, done: () => connect.opened };
          })
        : Effect.map(hostActPort({ account: SIGNED_IN }), ({ port, requests }) => ({
            port,
            done: (): readonly unknown[] => asksSent(requests),
          }));

      const refused = [
        yield* port.perform(act, OTHER_WINDOW),
        yield* port.perform(act, PANEL, { trusted: false }),
      ];

      assert.deepEqual(refused, [{ refused: act.refusal }, { refused: act.refusal }]);
      assert.deepEqual(done(), []);
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
          request.method !== HTTP_METHOD.GET && refusal !== undefined
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
