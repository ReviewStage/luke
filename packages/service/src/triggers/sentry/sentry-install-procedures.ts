import type { DatabaseServices } from "@repo/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@repo/database/integration-vocabulary";
import {
  markIntegrationInstallationDeleted,
  openIntegrationInstallIntent,
  workspaceIntegrationInstallations,
} from "@repo/database/models/integration-installation-store";
import { type Workspace, workspaceOf } from "@repo/database/models/workspace-store";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { managesWorkspace } from "@repo/features/workspace-role";
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

const INSTALL_STATE_QUERY = "state";

export interface SentryInstallProcedureSeams {
  resolveUserId: UserIdResolver;
}

const memberWorkspace = Effect.fn("web/sentryInstallWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

const administeredWorkspace = Effect.fn("web/sentryInstallAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

const settingsOrUnavailable = Effect.flatMap(SentryApp, (app) =>
  app.settings.pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE)),
);

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

function installUrl(settings: SentryAppSettings, state: string): string {
  const url = new URL(
    `/sentry-apps/${encodeURIComponent(settings.slug)}/external-install/`,
    SENTRY_ORIGIN,
  );
  url.searchParams.set(INSTALL_STATE_QUERY, state);
  return url.toString();
}

export function sentryInstallProcedures(seams: SentryInstallProcedureSeams) {
  const resource = hosted.workspaceSentry.use(accountMiddleware(seams.resolveUserId));
  return {
    install: resource.install.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const settings = yield* settingsOrUnavailable;
      const state = yield* hostedStoreOrUnavailable(
        openIntegrationInstallIntent(TRIGGER_PROVIDER.SENTRY, context.userId, workspace.id),
      );
      return { url: installUrl(settings, state) };
    }),
    installations: resource.installations.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      return yield* workspaceSentry(workspace.id);
    }),
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const before = yield* workspaceSentry(workspace.id);
      if (!before.installations.some((one) => one.installationId === input.installationId)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const marked = yield* hostedStoreOrUnavailable(
        markIntegrationInstallationDeleted(
          TRIGGER_PROVIDER.SENTRY,
          input.installationId,
          workspace.id,
        ),
      );
      const sentry = yield* workspaceSentry(workspace.id);
      return Option.match(marked, {
        onNone: () => sentry,
        onSome: (txid) => ({ ...sentry, txid }),
      });
    }),
  };
}
