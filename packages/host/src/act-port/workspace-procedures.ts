import { Effect } from "effect";
import { isGitHubAddress } from "../acts.js";
import { WORKSPACE_ACT_KIND, WORKSPACE_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";

/**
 * workspace-procedures.ts -- the panel's asks of the host about the account's workspaces that do work at the window: a connection's address opened.
 *
 * Every other workspace act is declared and answered by the tasks'
 * composer directly (`contract/workspaces.ts`). A connection is declared
 * too, but written by hand: its handler answers the address the service
 * named, or its refusal, and only an address on the connection's own origin
 * is opened. A workspace's per-workspace reads are live follows
 * (`act-port/live-follows.ts`).
 */
export interface WorkspaceProceduresDependencies {
  /** Opens an address in the browser: a connection's install or sign-in page the service named. */
  openExternal: (url: string) => Promise<void>;
}

/** Sentry's own origin, the one a Sentry install is opened on. */
const SENTRY_ORIGIN = "https://sentry.io";

/** Whether an address the host answered parses and stands on Sentry's own origin. */
function isSentryAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SENTRY_ORIGIN;
}

/** The handlers of the connections, whose procedures open what they answer. */
type ConnectActs = Pick<HostActTable, "WORKSPACE_GITHUB_CONNECT" | "WORKSPACE_SENTRY_INSTALL">;

export function workspaceProcedures(
  dependencies: WorkspaceProceduresDependencies,
  acts: ConnectActs,
) {
  const { openExternal } = dependencies;
  return {
    // Note that the address the service answered opens only where it is
    // GitHub's, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_GITHUB_CONNECT,
        acts.WORKSPACE_GITHUB_CONNECT,
        input,
      );
      if (!isGitHubAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(url));
    }),
    // Note that the address the service answered opens only where it is
    // Sentry's own, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_SENTRY_INSTALL,
        acts.WORKSPACE_SENTRY_INSTALL,
        input,
      );
      if (!isSentryAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(url));
    }),
  };
}
