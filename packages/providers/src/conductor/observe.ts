import {
  ACTION_KIND,
  type AdvertisedAction,
  agedStatus,
  agentIdentityFor,
  maximumSessionTitleLength,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionStatus,
} from "@sidecar/session";
import { Effect } from "effect";
import { type AdapterFailure, tolerateItemFailureEffect } from "../shared/adapter-failure.js";
import type { CloudRequest } from "../shared/cloud-wire.js";
import {
  isDefined,
  knownValue,
  recordsFromPage,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "../shared/cloud-wire.js";
import { CONDUCTOR_AGENT_BY_TYPE } from "./applications.js";
import {
  CONDUCTOR_CANCEL_ADVERTISEMENT,
  CONDUCTOR_DEFAULTS,
  CONDUCTOR_PROVIDER_ID,
  CONDUCTOR_PROVIDER_NAME,
  CONDUCTOR_RETIRED_WORKSPACE_STATUSES,
  CONDUCTOR_SESSION_STATUS,
  CONDUCTOR_SPAWNABLE_AGENTS,
  CONDUCTOR_WORKSPACE_ACTIVITY,
  CONDUCTOR_WORKSPACE_STATUS,
  type ConductorSessionStatus,
  conductorArchiveWorkspaceAdvertisement,
  SESSION_STATUS_BY_CONDUCTOR_STATUS,
  UUID_PATTERN,
} from "./vocabulary.js";
import {
  agentAndModelLabel,
  CONDUCTOR_FIELD,
  CONDUCTOR_QUERY,
  CONDUCTOR_READ_AGENT_KINDS_PREFIX,
  CONDUCTOR_READ_AGENT_KINDS_SUFFIX,
  CONDUCTOR_ROUTE,
  CONDUCTOR_ROUTE_SEGMENT,
  CONDUCTOR_SQL_FIELD,
  type ConductorProject,
  type ConductorReportedStatus,
  type ConductorSession,
  type ConductorTranscript,
  type ConductorWorkspace,
  type ConductorWorkspaceLifecycle,
  modelLabel,
  workspaceFromRecord,
} from "./wire.js";

/**
 * One read-only pass over Conductor's documented public API: the user's own
 * open workspaces, the chats inside them, where each chat stands, and one
 * fixed query for each chat's agent kind. No word of a conversation is read
 * here — that is the developer's own ask, and it lives in `conversation.ts`.
 */

/** What the identity read reported, kept for as long as the credential stands. */
export interface ConductorPassCache {
  userId?: string | undefined;
  projects: readonly ConductorProject[];
}

/**
 * One pass, as the observations it answers with. The cache is the pass's own
 * — the identity read once per credential, the projects a creation is later
 * held to — and `cloudPass` clears it whenever the credential changes.
 */
export function conductorObservations(
  request: CloudRequest,
  now: number,
  cache: ConductorPassCache,
): Effect.Effect<readonly ProviderSessionObservation[], AdapterFailure> {
  return Effect.gen(function* () {
    const userId = yield* identity(request, cache);
    if (!userId) return [];

    // Every fan-out below is bounded by the page sizes in
    // CONDUCTOR_ADAPTER_DEFAULTS — a bounded run of pages of the user's own
    // open workspaces, one page of chats per workspace — and workspaces and
    // chats are never capped beyond that: a conversation is never dropped to
    // spare a request. The projects are read for their own sake: they are
    // where a new workspace can be created, not where the workspaces come
    // from.
    cache.projects = yield* listProjects(request);
    const workspaces = (yield* listWorkspaces(request, userId))
      // The listing was asked for this user's workspaces, but the records
      // answer for themselves: Conductor does not attribute a workspace Luke
      // can prove belongs to this user unless it reports a creator, and
      // unattributed org workspaces stay out of a personal sidecar.
      .filter((workspace) => workspace.creatorId === userId)
      .sort((first, second) => second.lastActivityAt - first.lastActivityAt);

    // The listing already dropped the workspaces it marked archived or
    // deleted, so these lifecycle reads cover only the workspaces still
    // standing: they carry each one's activity words and failure message,
    // and they catch a filing-away the listing has not caught up with — a
    // workspace standing archived or deleted here is dropped all the same,
    // before its chats are ever asked for, which is what makes a press of
    // the archive control clear the rows it acted on within the pass that
    // follows it. A lifecycle that could not be read keeps its workspace: a
    // transient failure costs that workspace's activity words and failure
    // message, never its rows.
    const workspaceLifecycles = new Map(
      (yield* Effect.forEach(
        workspaces,
        (workspace) =>
          Effect.map(
            tolerateItemFailureEffect(workspaceLifecycle(request, workspace.id)),
            (lifecycle) => (lifecycle ? ([workspace.id, lifecycle] as const) : undefined),
          ),
        { concurrency: "unbounded" },
      )).filter(isDefined),
    );
    const openWorkspaces = workspaces.filter((workspace) => {
      const lifecycleStatus = workspaceLifecycles.get(workspace.id)?.status;
      return !lifecycleStatus || !CONDUCTOR_RETIRED_WORKSPACE_STATUSES.has(lifecycleStatus);
    });

    const sessions = (yield* Effect.forEach(
      openWorkspaces,
      (workspace) => tolerateItemFailureEffect(listSessions(request, workspace)),
      { concurrency: "unbounded" },
    ))
      .filter(isDefined)
      .flat();

    // The transcripts read rides beside the status reads: one bounded query
    // for every observed session, so a failed or missing answer costs an
    // agent kind, never the pass. That holds even for a credential
    // refusal: a key an org scopes away from the query endpoint alone still
    // reads the roster, and the roster reads above are what judge the
    // credential — so this one read swallows everything rather than letting
    // an enrichment 403 clear every observed row.
    const [transcripts, reportedStatuses] = yield* Effect.all(
      [
        Effect.orElseSucceed(sessionTranscripts(request, sessions), () => undefined),
        Effect.forEach(
          sessions,
          (session) => tolerateItemFailureEffect(sessionStatus(request, session.id)),
          { concurrency: "unbounded" },
        ),
      ],
      { concurrency: "unbounded" },
    );

    // The workspaces every observed chat of which was positively seen settled
    // — reporting idle or errored — judged from this pass's own statuses. An
    // archive is a workspace-level action, so it is offered only for these: a
    // chat still working, and just as much one whose status could not be read
    // at all, keeps the whole workspace off the list, because filing away a
    // workspace whose state Luke has not actually seen stop could take a live
    // turn with it. The chats already filed away never reached this pass, so
    // they neither settle a workspace nor hold one open.
    const settledWorkspaceIds = new Set(sessions.map((session) => session.workspace.id));
    sessions.forEach((session, index) => {
      const settled =
        reportedStatuses[index]?.status === CONDUCTOR_SESSION_STATUS.IDLE ||
        reportedStatuses[index]?.status === CONDUCTOR_SESSION_STATUS.ERROR;
      if (!settled) settledWorkspaceIds.delete(session.workspace.id);
    });

    // One row per chat, each grouped under its workspace. The grouping names
    // the workspace once, which leaves each chat free to say what it alone is
    // doing, be opened where it alone lives, and take the message meant for it
    // rather than for whichever sibling most needed a person.
    return sessions
      .map((session, index) =>
        observationFor(
          session,
          reportedStatuses[index],
          transcripts,
          workspaceLifecycles.get(session.workspace.id),
          settledWorkspaceIds,
          now,
        ),
      )
      .filter(isDefined);
  });
}

function identity(
  request: CloudRequest,
  cache: ConductorPassCache,
): Effect.Effect<string | undefined, AdapterFailure> {
  if (cache.userId) return Effect.succeed(cache.userId);
  return Effect.map(request(CONDUCTOR_ROUTE.IDENTITY), (body) => {
    cache.userId = textFromRecord(body, CONDUCTOR_FIELD.USER_ID);
    return cache.userId;
  });
}

function listProjects(request: CloudRequest): Effect.Effect<ConductorProject[], AdapterFailure> {
  return Effect.map(
    request(CONDUCTOR_ROUTE.PROJECTS, {
      [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_DEFAULTS.MAXIMUM_PROJECTS),
    }),
    (body) =>
      recordsFromPage(body, CONDUCTOR_FIELD.DATA)
        .map((record): ConductorProject | undefined => {
          const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
          return id
            ? {
                id,
                repositoryLabel: repositoryLabel(
                  textFromRecord(record, CONDUCTOR_FIELD.GIT_REMOTE),
                  textFromRecord(record, CONDUCTOR_FIELD.NAME),
                ),
              }
            : undefined;
        })
        .filter(isDefined)
        .slice(0, CONDUCTOR_DEFAULTS.MAXIMUM_PROJECTS),
  );
}

/**
 * The user's own open workspaces, from the documented workspace listing
 * under its own filters: the creator is the user the same pass's identity
 * read reported, and the archived are excluded where they are indexed
 * rather than paged through and dropped — a user who files away dozens of
 * workspaces a week would otherwise fill every page with them and crowd an
 * old but open workspace off the end of the read. The listing is followed
 * while it says more remain, to the fixed page bound, and a page that
 * could not be read fails the pass whole rather than quietly retiring
 * every row a later page was holding.
 */
function listWorkspaces(
  request: CloudRequest,
  userId: string,
): Effect.Effect<ConductorWorkspace[], AdapterFailure> {
  return Effect.gen(function* () {
    const workspaces: ConductorWorkspace[] = [];
    let offset = 0;
    for (let page = 0; page < CONDUCTOR_DEFAULTS.MAXIMUM_WORKSPACE_PAGES; page += 1) {
      const body = yield* request(
        [CONDUCTOR_ROUTE_SEGMENT.V0, CONDUCTOR_ROUTE_SEGMENT.WORKSPACES],
        {
          [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_DEFAULTS.WORKSPACE_PAGE_SIZE),
          [CONDUCTOR_QUERY.OFFSET]: String(offset),
          [CONDUCTOR_QUERY.CREATOR]: userId,
          [CONDUCTOR_QUERY.INCLUDE_ARCHIVED]: "false",
        },
      );
      const records = recordsFromPage(body, CONDUCTOR_FIELD.DATA);
      workspaces.push(...records.map(workspaceFromRecord).filter(isDefined));
      offset += records.length;
      if (body[CONDUCTOR_FIELD.HAS_MORE] !== true || records.length === 0) break;
    }
    return workspaces;
  });
}

function listSessions(
  request: CloudRequest,
  workspace: ConductorWorkspace,
): Effect.Effect<ConductorSession[], AdapterFailure> {
  return Effect.map(
    request(
      [
        CONDUCTOR_ROUTE_SEGMENT.V0,
        CONDUCTOR_ROUTE_SEGMENT.WORKSPACES,
        workspace.id,
        CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      ],
      { [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_DEFAULTS.SESSION_PAGE_SIZE) },
    ),
    (body) =>
      recordsFromPage(body, CONDUCTOR_FIELD.DATA)
        .map((record): ConductorSession | undefined => {
          const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
          if (!id) return undefined;
          // Conductor's listing already leaves an archived chat off the page,
          // but one that arrives carrying an archive timestamp is dropped all
          // the same, before its status or transcript is ever asked for. Its
          // workspace stays, carrying only the chats still open.
          if (timestampFromRecord(record, CONDUCTOR_FIELD.ARCHIVED_AT) !== undefined) {
            return undefined;
          }
          const model = modelLabel(record);
          const deepLink = textFromRecord(record, CONDUCTOR_FIELD.DEEP_LINK);
          // The chat's own name tells it from its siblings; the workspace's
          // name belongs to the group.
          const name = textFromRecord(record, CONDUCTOR_FIELD.NAME)?.slice(
            0,
            maximumSessionTitleLength,
          );
          return {
            id,
            workspace,
            ...(name ? { name } : undefined),
            ...(model ? { model } : undefined),
            ...(deepLink ? { deepLink } : undefined),
          };
        })
        .filter(isDefined),
  );
}

function observationFor(
  session: ConductorSession,
  reported: ConductorReportedStatus | undefined,
  transcripts: ReadonlyMap<string, ConductorTranscript> | undefined,
  lifecycle: ConductorWorkspaceLifecycle | undefined,
  settledWorkspaceIds: ReadonlySet<string>,
  now: number,
): ProviderSessionObservation | undefined {
  const transcript = transcripts?.get(session.id);
  const lastActivityAt = reported?.updatedAt ?? session.workspace.lastActivityAt;
  const status = statusFor(reported?.status, lastActivityAt, now);
  // The chat is the agent's conversation before it is Conductor's, so a
  // mapped agent kind leads the row as the agent itself and the model rides
  // plain. Only a kind this build cannot map keeps riding the model label,
  // so the provider's own word is not lost.
  const agent = agentIdentityFor(CONDUCTOR_AGENT_BY_TYPE, transcript?.agentKind);
  const model = agent ? session.model : agentAndModelLabel(transcript?.agentKind, session.model);
  // The workspace's own words for why its chats are quiet, and its own
  // failure message when standing it up went wrong. A session's reported
  // error is about the turn the user is watching, so it always outranks the
  // machinery's.
  const activity =
    lifecycle?.status === CONDUCTOR_WORKSPACE_STATUS.INITIALIZING ||
    lifecycle?.status === CONDUCTOR_WORKSPACE_STATUS.UPDATING
      ? CONDUCTOR_WORKSPACE_ACTIVITY[lifecycle.status]
      : undefined;
  const error = reported?.errorMessage ?? lifecycle?.errorMessage;
  return {
    providerSessionId: session.id,
    // The chat's own name titles the row, because the row is the chat; the
    // workspace's name — the name the user knows the work by — rides the
    // grouping below and names all of its chats at once. A chat Conductor
    // never named still falls back to those, and none of them is reported
    // as a branch: a workspace name never was one.
    title: session.name ?? session.workspace.name ?? session.workspace.repositoryLabel,
    status,
    lastActivityAt,
    // The workspace this chat is one voice of. Its name falls back to the
    // repository so an unnamed workspace still groups under something a
    // person can say out loud. Conductor manages the workspace the way
    // Superset manages its own, so the tray around several chats carries
    // the Conductor mark once instead of each row repeating it.
    workspace: {
      providerWorkspaceId: session.workspace.id,
      name: session.workspace.name ?? session.workspace.repositoryLabel,
      scopeId: CONDUCTOR_PROVIDER_ID,
      managerName: CONDUCTOR_PROVIDER_NAME,
    },
    // The Conductor mark rides as an app association like every other app
    // holding a chat, carrying the same exact address the row opens with,
    // so the one glyph means the same thing on a cloud row and a local one.
    // The address names the exact chat, so the association is the
    // session's own and rides the row even inside the workspace's tray;
    // the tray header's manager mark comes from the workspace above.
    applications: [
      {
        id: SESSION_APPLICATION_ID.CONDUCTOR,
        displayName: CONDUCTOR_PROVIDER_NAME,
        scope: SESSION_APPLICATION_SCOPE.SESSION,
        ...(session.deepLink ? { link: session.deepLink } : undefined),
      },
    ],
    ...(agent ? { agent } : undefined),
    advertises: advertisementsFor(session, reported, settledWorkspaceIds),
    detail: {
      repository: session.workspace.repositoryLabel,
      ...(model ? { model } : undefined),
      ...(activity ? { activity } : undefined),
      ...(error ? { error } : undefined),
      ...(session.deepLink ? { link: session.deepLink } : undefined),
    },
  };
}

/**
 * The actions Conductor documents for this chat right now. Every workspace id
 * riding one is the workspace this pass observed, so a target can never
 * outlive the snapshot that promised it.
 */
function advertisementsFor(
  session: ConductorSession,
  reported: ConductorReportedStatus | undefined,
  settledWorkspaceIds: ReadonlySet<string>,
): readonly AdvertisedAction[] {
  const advertises: AdvertisedAction[] = [];
  // Conductor documents both halves of a send — queued while a session is
  // idle, steered into the turn while it works — so any open chat takes a
  // message. An errored one is documented for no writer.
  if (
    reported?.status === CONDUCTOR_SESSION_STATUS.IDLE ||
    reported?.status === CONDUCTOR_SESSION_STATUS.WORKING
  ) {
    advertises.push({ kind: ACTION_KIND.MESSAGE });
  }
  // The stop belongs to the turn and the archive to the workspace: a chat
  // mid-turn offers the stop alone — its own workspace is by definition
  // unsettled — and any chat of a positively settled workspace offers to
  // file the whole workspace away. Every workspace and every chat here is
  // still open: the filed-away workspaces never made it past the lifecycle
  // read, and the filed-away chats never made it past the listing.
  if (reported?.status === CONDUCTOR_SESSION_STATUS.WORKING) {
    advertises.push(CONDUCTOR_CANCEL_ADVERTISEMENT);
  }
  if (settledWorkspaceIds.has(session.workspace.id)) {
    advertises.push(conductorArchiveWorkspaceAdvertisement(session.workspace.id));
  }
  // Renaming is documented for any open chat, whatever its turn is doing,
  // so it is not gated on the reported status the way a message is.
  advertises.push({ kind: ACTION_KIND.RENAME_SESSION });
  // Another agent lands in the workspace around this row, whatever state
  // the row's own chat is in: the workspace was observed this pass, and
  // that is the thing the creation endpoint takes.
  advertises.push({
    kind: ACTION_KIND.ADD_AGENT,
    agents: CONDUCTOR_SPAWNABLE_AGENTS,
    target: session.workspace.id,
  });
  // A rename is documented for any open workspace, and every workspace here
  // is open — the filed-away ones never made it past the lifecycle read.
  advertises.push({ kind: ACTION_KIND.RENAME_WORKSPACE, target: session.workspace.id });
  return advertises;
}

function statusFor(
  reportedStatus: ConductorSessionStatus | undefined,
  lastActivityAt: number,
  now: number,
): SessionStatus {
  if (!reportedStatus) return SESSION_STATUS.UNKNOWN;
  return agedStatus(
    SESSION_STATUS_BY_CONDUCTOR_STATUS[reportedStatus],
    lastActivityAt,
    now,
    OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
  );
}

function sessionStatus(
  request: CloudRequest,
  sessionId: string,
): Effect.Effect<ConductorReportedStatus, AdapterFailure> {
  return Effect.map(
    request([
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      sessionId,
      CONDUCTOR_ROUTE_SEGMENT.STATUS,
    ]),
    (body) => {
      // A session that failed says why. `lastError` is the
      // last failure this session ever had rather than its current state, so both
      // are read only while the session is actually reporting an error: otherwise
      // a chat that recovered hours ago would keep showing the failure it
      // recovered from, ahead of whatever it is really doing.
      const status = knownValue(
        CONDUCTOR_SESSION_STATUS,
        textFromRecord(body, CONDUCTOR_FIELD.STATUS),
      );
      const errorMessage =
        status === CONDUCTOR_SESSION_STATUS.ERROR
          ? (
              textFromRecord(body, CONDUCTOR_FIELD.ERROR_MESSAGE) ??
              textFromRecord(body, CONDUCTOR_FIELD.LAST_ERROR)
            )?.slice(0, CONDUCTOR_DEFAULTS.MAXIMUM_ERROR_LENGTH)
          : undefined;
      return {
        status,
        updatedAt: timestampFromRecord(body, CONDUCTOR_FIELD.UPDATED_AT),
        ...(errorMessage ? { errorMessage } : undefined),
      };
    },
  );
}

/**
 * Where one workspace stands in its lifecycle, from the endpoint Conductor
 * documents for polling exactly that. A workspace still being built or
 * rebuilt explains why its chats sit quiet, and the failure message it
 * carries is the one thing that says a workspace never came up at all —
 * nothing else reports it, because every chat inside just reads idle.
 */
function workspaceLifecycle(
  request: CloudRequest,
  workspaceId: string,
): Effect.Effect<ConductorWorkspaceLifecycle, AdapterFailure> {
  return Effect.map(
    request([
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.WORKSPACES,
      workspaceId,
      CONDUCTOR_ROUTE_SEGMENT.STATUS,
    ]),
    (body) => {
      const status = knownValue(
        CONDUCTOR_WORKSPACE_STATUS,
        textFromRecord(body, CONDUCTOR_FIELD.STATUS),
      );
      const errorMessage = textFromRecord(body, CONDUCTOR_FIELD.ERROR_MESSAGE)?.slice(
        0,
        CONDUCTOR_DEFAULTS.MAXIMUM_ERROR_LENGTH,
      );
      return {
        ...(status ? { status } : undefined),
        ...(errorMessage ? { errorMessage } : undefined),
      };
    },
  );
}

/**
 * One read of the transcripts view for every session this pass observed:
 * which agent runs each chat, and nothing else. Only ids that are actually
 * UUIDs may enter the fixed document — an id that is anything else is a
 * shape this build does not know, so it is left out rather than sent — and
 * with none there is no read at all.
 */
function sessionTranscripts(
  request: CloudRequest,
  sessions: readonly ConductorSession[],
): Effect.Effect<ReadonlyMap<string, ConductorTranscript>, AdapterFailure> {
  const ids = sessions.map((session) => session.id).filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 0) return Effect.succeed(new Map());

  const document = `${CONDUCTOR_READ_AGENT_KINDS_PREFIX}${ids
    .map((id) => `'${id}'`)
    .join(", ")}${CONDUCTOR_READ_AGENT_KINDS_SUFFIX}`;
  return Effect.map(request(CONDUCTOR_ROUTE.SQL, undefined, { document }), (body) => {
    const transcripts = new Map<string, ConductorTranscript>();
    for (const row of recordsFromPage(body, CONDUCTOR_SQL_FIELD.ROWS)) {
      const sessionId = textFromRecord(row, CONDUCTOR_SQL_FIELD.SESSION_ID);
      if (!sessionId) continue;
      const agentKind = textFromRecord(row, CONDUCTOR_SQL_FIELD.AGENT_TYPE)?.slice(
        0,
        CONDUCTOR_DEFAULTS.MAXIMUM_AGENT_KIND_LENGTH,
      );
      transcripts.set(sessionId, {
        ...(agentKind ? { agentKind } : undefined),
      });
    }
    return transcripts;
  });
}
