import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import {
  CONNECTION_ID,
  type ConnectionId,
  type ConnectionRegistration,
  type CredentialProviderId,
  connectionDeclaration,
  type SignInEdge,
} from "@sidecar/credentials";
import { ISSUE_TRACKER_ID, type IssueTrackerId } from "@sidecar/issues";
import type { ProviderRegistration } from "@sidecar/providers";
import {
  type CliConnection,
  type SessionProviderAdapter,
  WORKSPACE_PROVIDER_ID_LIST,
  type WorkspaceProviderId,
} from "@sidecar/session";
import type { SupersetSignIn, SupersetWorkspaceHost } from "@sidecar/superset";
import type { IssueTrackerRegistration } from "@sidecar/trackers";
import { ACT_RESULT_STATUS, type ActResult } from "@sidecar/wire";
import {
  SUPERSET_SIGN_IN_COUNTED_AS,
  TRACKER_SIGN_IN_COUNTED_AS,
} from "#shared/product-vocabulary";
import type { SettingsStore } from "./settings-store";

export interface ConnectionRegistrationOptions {
  workspaceRegistry: Readonly<Record<WorkspaceProviderId, ProviderRegistration>>;
  /** Re-observes one provider after its key changed. */
  refreshAdapter: (adapter: SessionProviderAdapter) => Promise<void>;
  /** What the Codex CLI's latest observation pass learned about its login. */
  codexCloudConnection: () => CliConnection;
  superset: {
    host: SupersetWorkspaceHost;
    signIn: SupersetSignIn;
    /** Re-runs the observation pass once the CLI login lands or leaves. */
    refreshSessions: () => void;
  };
  trackers: Readonly<Record<IssueTrackerId, IssueTrackerRegistration>>;
  settingsStore: Pick<SettingsStore, "setGrant">;
  refreshIssues: () => void;
  /** Rebuilds the voice conversation from its key and re-claims the talk key. */
  voiceCredentialChanged: () => Promise<void>;
  recordProductEvent: RecordProductEvent;
}

/**
 * Every connection's row as the main process runs it, assembled from the
 * pieces the app already owns. This is the one main-process file that names
 * the connections, at construction; the handlers, the settings rows, and the
 * store iterate what it returns.
 */
export function connectionRegistrations(options: ConnectionRegistrationOptions) {
  // A key row's one act beyond the store is re-observing the provider the
  // key connects, which the workspace registry already knows how to do.
  const keyRow = (credentialId: CredentialProviderId): ConnectionRegistration => {
    const registration = WORKSPACE_PROVIDER_ID_LIST.map((id) => options.workspaceRegistry[id]).find(
      (candidate) => candidate.credential?.id === credentialId,
    );
    return {
      declaration: connectionDeclaration(credentialId),
      ...(registration
        ? { onCredentialChanged: () => void options.refreshAdapter(registration.adapter) }
        : undefined),
    };
  };

  const { host, signIn, refreshSessions } = options.superset;
  const supersetDisconnect = async (): Promise<ActResult> => {
    if (!(await host.cli.signOut())) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "Superset could not sign out." };
    }
    // The sign-in machine returning to idle is what tells every renderer the
    // login is gone; the refreshed pass retires the rows the login was buying.
    signIn.cancel();
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  };

  const linear = options.trackers[ISSUE_TRACKER_ID.LINEAR];
  const linearConnect = async () => {
    const outcome = await linear.signIn.signIn();
    if ("reason" in outcome) return outcome;
    const stored = await options.settingsStore.setGrant(ISSUE_TRACKER_ID.LINEAR, outcome);
    return stored.reason ? { reason: stored.reason } : undefined;
  };
  const linearDisconnect = async (): Promise<ActResult> => {
    // Revoked with Linear as well as forgotten here, so disconnecting ends
    // the access rather than only losing sight of it.
    await linear.disconnect();
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  };
  const countTrackerEdge = (edge: SignInEdge) => {
    const event = TRACKER_SIGN_IN_COUNTED_AS[edge];
    if (event) options.recordProductEvent(event, { tracker_id: ISSUE_TRACKER_ID.LINEAR });
  };

  return {
    [CONNECTION_ID.CODEX]: {
      declaration: connectionDeclaration(CONNECTION_ID.CODEX),
      cliConnection: async () => options.codexCloudConnection(),
    },
    [CONNECTION_ID.CONDUCTOR]: keyRow(CONNECTION_ID.CONDUCTOR),
    [CONNECTION_ID.CONDUCTOR_LOCAL]: {
      declaration: connectionDeclaration(CONNECTION_ID.CONDUCTOR_LOCAL),
    },
    [CONNECTION_ID.SUPERSET]: {
      declaration: connectionDeclaration(CONNECTION_ID.SUPERSET),
      cliConnection: () => host.cliConnection(),
      interactiveSignIn: signIn,
      disconnect: supersetDisconnect,
      onConnectionChanged: refreshSessions,
      countSignInEdge: (edge) =>
        options.recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
          superset_act: SUPERSET_SIGN_IN_COUNTED_AS[edge],
        }),
    },
    [CONNECTION_ID.LINEAR]: {
      declaration: connectionDeclaration(CONNECTION_ID.LINEAR),
      signInAvailable: () => linear.signInAvailable(),
      consentSignIn: {
        connect: linearConnect,
        cancel: () => linear.signIn.cancel(),
        reopen: () => linear.signIn.reopen(),
      },
      disconnect: linearDisconnect,
      // The tracker's grant connects the tracker, not a session provider, so
      // its change refreshes the roster instead of the registry.
      onCredentialChanged: options.refreshIssues,
      countSignInEdge: countTrackerEdge,
    },
    [CONNECTION_ID.OPENAI]: {
      declaration: connectionDeclaration(CONNECTION_ID.OPENAI),
      // The voice key connects no observer: it is what the spoken
      // conversation and the attention review are built from, so a change to
      // it rebuilds both and then moves the talk key.
      onCredentialChanged: options.voiceCredentialChanged,
    },
  } satisfies Readonly<Record<ConnectionId, ConnectionRegistration>>;
}
