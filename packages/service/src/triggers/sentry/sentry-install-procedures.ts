/**
 * sentry-install-procedures.ts -- a workspace's installations of Luke's Sentry integration begun, read, and disconnected.
 *
 * Three procedures the signed-in desktop calls with its bearer:
 *
 * - `POST /api/workspaces/sentry/install` takes an owner or admin of the
 *   workspace, opens an install intent bound to the account and the
 *   workspace (`integration-installation-store.ts`), and answers Sentry's
 *   external install address for the integration with the intent's state on
 *   it, which Sentry hands back on the Redirect URL
 *   (`sentry-install-app.ts`).
 * - `GET /api/workspaces/sentry/installations` takes any member, and answers
 *   whether this deployment holds the integration and the workspace's
 *   active installations.
 * - `POST /api/workspaces/sentry/disconnect` takes an owner or admin, and
 *   marks one of the workspace's installations deleted, so its deliveries
 *   fire nothing; the integration stays installed on Sentry until the
 *   organization uninstalls it there.
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@luke/database/integration-vocabulary";
import {
  markIntegrationInstallationDeleted,
  openIntegrationInstallIntent,
  workspaceIntegrationInstallations,
} from "@luke/database/models/integration-installation-store";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import type { WorkspaceSentry } from "@luke/features/sentry-install-wire";
import { TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import { managesWorkspace } from "@luke/features/workspace-role";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../../http/http-effect.js";
import { accountMiddleware, hosted } from "../../orpc/base.js";
import { SentryApp, type SentryAppSettings } from "./sentry-app-config.js";
import { SENTRY_ORIGIN } from "./sentry-install-app.js";

/** The query the install address carries to Sentry, which Sentry hands back. */
const INSTALL_STATE_QUERY = "state";

export interface SentryInstallProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace named, as the account sees it; one it is not in is not found. */
const memberWorkspace = Effect.fn("web/sentryInstallWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** The workspace named, where the account is an owner or admin of it. */
const administeredWorkspace = Effect.fn("web/sentryInstallAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

/** The integration's settings, or the unavailable refusal where this deployment holds none. */
const settingsOrUnavailable = Effect.flatMap(SentryApp, (app) =>
  app.settings.pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE)),
);

/** The workspace's Sentry as the wire carries it: its active installations, the first linked first. */
const workspaceSentry = Effect.fn("web/workspaceSentry")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSentry, HostedRefusal, DatabaseServices | SentryApp> {
  const app = yield* SentryApp;
  const configured = Result.isSuccess(yield* Effect.result(app.settings));
  const rows = yield* hostedStoreOrUnavailable(workspaceIntegrationInstallations(workspaceId));
  const installations = rows
    .filter(
      (row) =>
        row.provider === TRIGGER_PROVIDER.SENTRY &&
        row.status === INTEGRATION_INSTALLATION_STATUS.ACTIVE,
    )
    .map((row) =>
      row.accountLabel === null
        ? { installationId: row.externalId }
        : { installationId: row.externalId, account: row.accountLabel },
    );
  return { configured, installations };
});

/** Sentry's external install address for the integration, carrying the intent's state. */
function installUrl(settings: SentryAppSettings, state: string): string {
  const url = new URL(
    `/sentry-apps/${encodeURIComponent(settings.slug)}/external-install/`,
    SENTRY_ORIGIN,
  );
  url.searchParams.set(INSTALL_STATE_QUERY, state);
  return url.toString();
}

/** The workspace Sentry resource: install and disconnect to an owner or admin, and the installations to any member. */
export function sentryInstallProcedures(seams: SentryInstallProcedureSeams) {
  const resource = hosted.workspaceSentry.use(accountMiddleware(seams.resolveUserId));
  return {
    /** An intent opened for the workspace, answered as Sentry's install address. */
    install: resource.install.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const settings = yield* settingsOrUnavailable;
      const state = yield* hostedStoreOrUnavailable(
        openIntegrationInstallIntent(TRIGGER_PROVIDER.SENTRY, context.userId, workspace.id),
      );
      return { url: installUrl(settings, state) };
    }),
    /** The workspace's Sentry, to any member of it. */
    installations: resource.installations.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      return yield* workspaceSentry(workspace.id);
    }),
    /**
     * One of the workspace's installations disconnected; one that is not the
     * workspace's is not found, and the write itself names the workspace, so
     * an installation another workspace linked since the read is left alone.
     */
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const before = yield* workspaceSentry(workspace.id);
      if (!before.installations.some((one) => one.installationId === input.installationId)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      yield* hostedStoreOrUnavailable(
        markIntegrationInstallationDeleted(
          TRIGGER_PROVIDER.SENTRY,
          input.installationId,
          workspace.id,
        ),
      );
      return yield* workspaceSentry(workspace.id);
    }),
  };
}
