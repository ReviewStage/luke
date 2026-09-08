import {
  ACTION_KIND,
  type AdvertisedAction,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "@sidecar/session";
import { SUPERSET_CONTROL_ID } from "./vocabulary.js";
import {
  bindingOutranks,
  type SupersetSessionContext,
  type SupersetWorktreeContext,
  supersetTerminalLink,
  supersetWorkspaceLink,
} from "./wire.js";

/**
 * What one host-state read decided about the sessions Superset manages: which
 * chats it holds, which workspaces stand idle, and what each row may be asked
 * to do. It opens nothing — the reader hands it contexts.
 */

/**
 * The actions Superset documents for one workspace it manages, given whether the
 * row is settled and whether anything is bound to take a message. Both rows
 * that carry actions — a chat's and an idle workspace's — read them from here, so
 * a press means the same thing on either. The workspace id rides every entry
 * as its target, which is what the press acts on and what seats a control once
 * on a tray's own header when several chats share the workspace.
 */
function supersetAdvertisements(
  context: SupersetSessionContext,
  row: { settled: boolean; messageable: boolean },
): readonly AdvertisedAction[] {
  const advertises: AdvertisedAction[] = [];
  // Only a bound terminal gives a message somewhere to land; a chatless
  // workspace row stays unmessageable rather than improvising a way in.
  if (row.messageable) advertises.push({ kind: ACTION_KIND.MESSAGE });
  // Deleting the workspace is unrecoverable and takes every sibling chat's
  // terminal with it, so it is offered only on a row positively seen settled —
  // never one still working, or one whose state could not be read.
  if (row.settled) {
    advertises.push({
      kind: ACTION_KIND.CONTROL,
      id: SUPERSET_CONTROL_ID.DELETE_WORKSPACE,
      label: "Delete workspace",
      target: context.workspaceId,
    });
  }
  // Superset documents renaming any workspace it manages.
  advertises.push({ kind: ACTION_KIND.RENAME_WORKSPACE, target: context.workspaceId });
  if (context.spawnableAgents.length > 0) {
    advertises.push({
      kind: ACTION_KIND.ADD_AGENT,
      agents: context.spawnableAgents,
      target: context.workspaceId,
    });
  }
  return advertises;
}

/**
 * An action reaches Superset through the CLI's own login, which serves one
 * organization at a time, so only sessions the active organization's host
 * service recorded can be acted on at all.
 */
function actableInOrganization(
  context: SupersetSessionContext,
  activeOrganizationId: string | undefined,
): boolean {
  return activeOrganizationId !== undefined && context.organizationId === activeOrganizationId;
}

/** One host-state read, as the roster and the action router ask about it. */
export interface SupersetSnapshot {
  /** The context behind one observed session, recorded or directory-matched. */
  context(providerId: string, providerSessionId: string): SupersetSessionContext | undefined;
  /** The same, but only where the CLI's login serves the recording organization. */
  actableContext(
    providerId: string,
    providerSessionId: string,
    activeOrganizationId: string | undefined,
  ): SupersetSessionContext | undefined;
  /** Annotates one provider's already-observed sessions with what Superset holds. */
  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
    activeOrganizationId?: string,
  ): readonly ProviderSessionObservation[];
  /** The idle workspaces as rows of the Superset workspace provider. */
  workspaceRowObservations(activeOrganizationId?: string): readonly ProviderSessionObservation[];
  adoptDirectoryMatches(previous: SupersetSnapshot): void;
  /**
   * The chats this snapshot matched by worktree path. Only the adoption below
   * reads it, from the snapshot it is replacing.
   */
  directoryMatches(): ReadonlyMap<string, ReadonlyMap<string, SupersetSessionContext>>;
}

export function supersetSnapshot(
  contexts: readonly SupersetSessionContext[] = [],
  worktrees: readonly SupersetWorktreeContext[] = [],
): SupersetSnapshot {
  const sessions = new Map<string, Map<string, SupersetSessionContext>>();
  const worktreesByPath = new Map<string, SupersetSessionContext>();
  /**
   * The chats matched by worktree path, remembered under the chat's own
   * identity so the action router resolves an action against the same context its
   * advertisement rode. Every enrich pass rewrites a chat's entry from its
   * latest observation — confirming, moving, or dropping it — and a fresh
   * snapshot adopts its predecessor's entries so the actions a drawn row still
   * advertises keep resolving between the snapshot standing and that pass.
   */
  const directoryMatches = new Map<string, Map<string, SupersetSessionContext>>();

  for (const context of contexts) {
    const provider = sessions.get(context.providerId) ?? new Map();
    const existing = provider.get(context.providerSessionId);
    if (!existing || bindingOutranks(context, existing)) {
      provider.set(context.providerSessionId, context);
    }
    sessions.set(context.providerId, provider);
  }
  for (const worktree of worktrees) {
    const existing = worktreesByPath.get(worktree.worktreePath);
    if (!existing || existing.updatedAt < worktree.context.updatedAt) {
      worktreesByPath.set(worktree.worktreePath, worktree.context);
    }
  }

  const rememberDirectoryMatch = (
    providerId: string,
    providerSessionId: string,
    worktree: SupersetSessionContext,
    worktreePath: string,
  ): SupersetSessionContext => {
    const context: SupersetSessionContext = {
      ...worktree,
      providerId,
      providerSessionId,
      worktreePath,
    };
    const matches = directoryMatches.get(providerId) ?? new Map();
    matches.set(providerSessionId, context);
    directoryMatches.set(providerId, matches);
    return context;
  };

  /**
   * The recorded context for a chat, or the worktree standing in for one
   * Superset never recorded: a local chat whose provider wrote down the same
   * directory Superset made a live worktree at is that workspace's chat, even
   * though the binding row carries no session id to say which. The match
   * earns everything the workspace's own identity carries — the grouping and
   * the workspace-scoped actions — but no terminal, because no observed binding
   * identifies the exact terminal this chat is behind, and a message must
   * land on the chat it was typed at.
   */
  const contextFor = (
    providerId: string,
    observation: ProviderSessionObservation,
  ): SupersetSessionContext | undefined => {
    const recorded = sessions.get(providerId)?.get(observation.providerSessionId);
    if (recorded) return recorded;
    // The observation is the match's whole authority, so it is re-decided
    // here from the observation alone, never read back from the remembered
    // entry: a chat that moved directories or stopped reporting one loses
    // its entry on the same pass.
    const worktree =
      observation.location !== SESSION_LOCATION.CLOUD && observation.directory
        ? worktreesByPath.get(observation.directory)
        : undefined;
    if (!worktree) {
      directoryMatches.get(providerId)?.delete(observation.providerSessionId);
      return undefined;
    }
    return rememberDirectoryMatch(
      providerId,
      observation.providerSessionId,
      worktree,
      observation.directory ?? "",
    );
  };

  const context = (
    providerId: string,
    providerSessionId: string,
  ): SupersetSessionContext | undefined =>
    sessions.get(providerId)?.get(providerSessionId) ??
    directoryMatches.get(providerId)?.get(providerSessionId);

  return {
    context,
    directoryMatches: () => directoryMatches,

    /**
     * Carries the previous snapshot's directory matches into this one, each
     * re-anchored to this snapshot's own read: an entry survives only while
     * the same worktree still stands, and is rebuilt from that worktree's
     * fresh fields. Without this, an action pressed between this snapshot
     * standing and the next enrich pass would find nothing behind the
     * advertisement the drawn row still carries; the workspace-scoped actions an
     * adopted entry resolves stay honest either way, because they act on the
     * workspace whose worktree was just re-read, not on the chat.
     */
    adoptDirectoryMatches(previous) {
      for (const [providerId, matches] of previous.directoryMatches()) {
        for (const [providerSessionId, match] of matches) {
          const worktree = match.worktreePath ? worktreesByPath.get(match.worktreePath) : undefined;
          if (!worktree || !match.worktreePath) continue;
          rememberDirectoryMatch(providerId, providerSessionId, worktree, match.worktreePath);
        }
      }
    },

    actableContext(providerId, providerSessionId, activeOrganizationId) {
      const found = context(providerId, providerSessionId);
      return found && actableInOrganization(found, activeOrganizationId) ? found : undefined;
    },

    enrich(providerId, observations, activeOrganizationId) {
      return observations.map((observation) => {
        const context = contextFor(providerId, observation);
        if (!context) return observation;
        const detail = { ...observation.detail };
        if (context.projectName) detail.repository = context.projectName;
        if (context.branch) detail.branch = context.branch;
        if (context.pullRequestUrl) detail.change = context.pullRequestUrl;
        const applicationLink = context.terminalId
          ? supersetTerminalLink(context.workspaceId, context.terminalId)
          : supersetWorkspaceLink(context.workspaceId);
        // The app that wrote the host state is the scheme's handler, so the
        // address stands without the CLI login the actions below wait for. The
        // association carries the exact terminal address; which mark a grouped
        // row's press follows is the session normalization's call — the
        // workspace's manager leads the marks and the press follows the first
        // linked one — so the fill here only covers a row nothing else
        // addressed.
        if (!detail.link) detail.link = applicationLink;
        const applications = observation.applications?.some(
          (application) => application.id === SESSION_APPLICATION_ID.SUPERSET,
        )
          ? observation.applications
          : [
              ...(observation.applications ?? []),
              {
                id: SESSION_APPLICATION_ID.SUPERSET,
                displayName: "Superset",
                scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
                link: applicationLink,
              },
            ];
        const workspace = {
          providerWorkspaceId: context.workspaceId,
          name: context.workspaceName,
          scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
          managerName: "Superset",
        };
        if (!actableInOrganization(context, activeOrganizationId)) {
          return { ...observation, detail, applications, workspace };
        }
        const settled =
          observation.status !== SESSION_STATUS.WORKING &&
          observation.status !== SESSION_STATUS.UNKNOWN;
        return {
          ...observation,
          detail,
          applications,
          workspace,
          advertises: [
            ...(observation.advertises ?? []),
            ...supersetAdvertisements(context, {
              settled,
              messageable: context.terminalId !== undefined,
            }),
          ],
        };
      });
    },

    /**
     * The chatless workspaces as rows of the Superset workspace provider,
     * decorated here — beside `enrich`, from the same observed state — rather
     * than by a registry transform, so an action path's plain refresh commits the
     * same shape the observation loop does. Each row stands (`standing`): it is
     * re-reported for as long as the workspace exists and dropped the pass
     * after it is gone, so retention never ages it out however long the
     * workspace has sat idle — sitting idle is exactly what earns it a row.
     * Complete is the vocabulary's settled state, and a workspace with no agent
     * terminal is settled by construction — the same gate the delete control's
     * advertisement stands on — so the actions ride only while the CLI's login
     * serves the recording organization, exactly as they do on a chat row.
     */
    workspaceRowObservations(activeOrganizationId) {
      const contexts = [...(sessions.get(SUPERSET_WORKSPACE_PROVIDER_ID)?.values() ?? [])].sort(
        (first, second) =>
          second.updatedAt - first.updatedAt || first.workspaceId.localeCompare(second.workspaceId),
      );
      return contexts.map((context) => {
        const link = supersetWorkspaceLink(context.workspaceId);
        const detail: ProviderSessionObservation["detail"] = { link };
        if (context.projectName) detail.repository = context.projectName;
        if (context.branch) detail.branch = context.branch;
        if (context.pullRequestUrl) detail.change = context.pullRequestUrl;
        const observation: ProviderSessionObservation = {
          providerSessionId: context.workspaceId,
          title: context.workspaceName,
          status: SESSION_STATUS.COMPLETE,
          lastActivityAt: context.updatedAt,
          standing: true,
          detail,
          applications: [
            {
              id: SESSION_APPLICATION_ID.SUPERSET,
              displayName: "Superset",
              scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
              link,
            },
          ],
          workspace: {
            providerWorkspaceId: context.workspaceId,
            name: context.workspaceName,
            scopeId: SUPERSET_WORKSPACE_PROVIDER_ID,
            managerName: "Superset",
          },
        };
        if (!actableInOrganization(context, activeOrganizationId)) return observation;
        // A workspace with no agent terminal is settled by construction: there
        // is no turn a delete could cut, and nothing bound to take a message.
        observation.advertises = supersetAdvertisements(context, {
          settled: true,
          messageable: false,
        });
        return observation;
      });
    },
  };
}
