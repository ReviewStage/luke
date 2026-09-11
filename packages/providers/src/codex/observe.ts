import path from "node:path";
import {
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
} from "@sidecar/session";
import {
  isRecord,
  isWireBoolean,
  oneLine,
  recordFromJsonLine,
  text,
  type WireRecord,
} from "@sidecar/wire";
import { Effect } from "effect";
import { type HookStatusRefinement, hookRefinedStatus } from "../shared/hook-status.js";
import { readTail, workspaceLabel } from "../shared/local-files.js";
import { numberFromRow, textFromRow } from "../shared/local-sqlite.js";
import {
  CODEX_HOOK_EVENT,
  type CodexHookEvent,
  type ObservedCodexHookEvent,
  readCodexHookEvent,
} from "./hooks.js";
import {
  argumentPhrase,
  CODEX_CALL_ARGUMENT_KEY,
  CODEX_DELEGATION_TITLE,
  CODEX_EVENT_PAYLOAD,
  CODEX_MESSAGE_ROLE,
  CODEX_REALTIME_ACTIVE_KEY,
  CODEX_RESPONSE_PAYLOAD,
  CODEX_ROLLOUT_TYPE,
  CODEX_SUBAGENT_SOURCE_FIELD,
  CODEX_THREAD_ID,
  CODEX_THREAD_LINK_PREFIX,
  CODEX_WORLD_STATE_SECTION,
  isCodexRealtimeDelegationText,
} from "./records.js";
import { CODEX_SESSION_INDEX_FILE, CODEX_THREAD_COLUMN, type CodexThreadRow } from "./state.js";

const CODEX_OBSERVATION_DEFAULTS = {
  /** Enough to reach past one turn's token accounting to its boundary event. */
  READ_ROLLOUT_TAIL_BYTES: 64 * 1024,
  /** Only the threads that can still change are worth a second file read. */
  MAXIMUM_ROLLOUT_READS: 12,
  /**
   * How far back into Codex's append-only name index one pass reads. The
   * newest entry per thread wins and a delegated chat is created moments
   * before its title needs resolving, so the names worth having live at the
   * end; a bounded tail keeps a file that only ever grows from becoming an
   * unbounded read on every pass.
   */
  READ_SESSION_INDEX_TAIL_BYTES: 128 * 1024,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

export const CODEX_PROVIDER: SessionProvider = {
  id: PROVIDER_ID.CODEX,
  displayName: "Codex",
};

/** Names the tool Codex called, preferring whichever argument says what it is for. */
function activityFromCall(payload: WireRecord): string | undefined {
  const name = text(payload.name);
  if (!name) return undefined;
  const parsedArguments = text(payload.arguments)
    ? recordFromJsonLine(
        // SAFETY: text() narrows arguments to string before JSON parsing.
        payload.arguments as string,
      )
    : undefined;
  for (const key of CODEX_CALL_ARGUMENT_KEY) {
    const detail = oneLine(
      argumentPhrase(parsedArguments?.[key]),
      CODEX_OBSERVATION_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
    );
    if (detail) return `${name}: ${detail}`;
  }
  return name;
}

interface ParsedCodexRollout {
  activity?: string | undefined;
  error?: string | undefined;
  turnComplete?: boolean | undefined;
  /** Whether a realtime voice conversation is live over this thread, when the tail says. */
  realtimeVoiceLive?: boolean | undefined;
}

/**
 * Reads whether the realtime voice conversation is open out of one world-state
 * snapshot, or nothing when the snapshot does not say. A patch that omits the
 * realtime section left it unchanged; a full snapshot omitting it comes from a
 * build with no realtime to be in.
 */
function realtimeActiveFromWorldState(payload: WireRecord): boolean | undefined {
  const state = isRecord(payload.state) ? payload.state : undefined;
  if (!state) return undefined;
  const realtime = state[CODEX_WORLD_STATE_SECTION.REALTIME];
  if (isRecord(realtime)) {
    const active = realtime[CODEX_REALTIME_ACTIVE_KEY];
    return isWireBoolean(active) ? active : undefined;
  }
  return payload.full === true ? false : undefined;
}

/** Whether a message is the realtime conversation delegating its turn to the thread. */
function isRealtimeDelegationMessage(payload: WireRecord): boolean {
  if (payload.role !== CODEX_MESSAGE_ROLE.USER || !Array.isArray(payload.content)) return false;
  return payload.content.some(
    (block) => isRecord(block) && isCodexRealtimeDelegationText(text(block.text)),
  );
}

/**
 * Reads the turn boundary and the current call out of a rollout tail. A
 * `task_complete` that nothing followed means the turn ended and the session is
 * holding for its developer; a `task_started` means it is still running.
 */
function parseCodexRolloutTail(tail: string): ParsedCodexRollout {
  const parsed: ParsedCodexRollout = {};
  const lines = tail.split(/\r?\n/);
  for (const line of lines) {
    const record = recordFromJsonLine(line);
    if (!record) continue;
    const payload = isRecord(record.payload) ? record.payload : undefined;
    if (!payload) continue;

    if (record.type === CODEX_ROLLOUT_TYPE.EVENT_MSG) {
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_STARTED) {
        parsed.turnComplete = false;
        // A new turn is not running the previous turn's last call, and holding
        // it would keep a stale line on the row until some other tool runs.
        parsed.activity = undefined;
        // A new turn is also not stuck on the previous turn's failure, and
        // holding it would keep the row at error while the session works.
        parsed.error = undefined;
      }
      if (payload.type === CODEX_EVENT_PAYLOAD.ERROR) {
        parsed.error =
          oneLine(text(payload.message), CODEX_OBSERVATION_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ??
          parsed.error;
      }
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_COMPLETE) {
        parsed.turnComplete = true;
        parsed.activity = undefined;
        if (isRecord(payload.error)) {
          // The fallback keeps a standalone error event's message when the
          // boundary's own error carries none.
          parsed.error =
            oneLine(
              text(payload.error.message),
              CODEX_OBSERVATION_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
            ) ?? parsed.error;
        } else {
          // A turn that settled cleanly got past any failure it recorded on
          // the way, so a stale error must not outlive it.
          parsed.error = undefined;
        }
      }
      continue;
    }
    if (record.type === CODEX_ROLLOUT_TYPE.WORLD_STATE) {
      parsed.realtimeVoiceLive = realtimeActiveFromWorldState(payload) ?? parsed.realtimeVoiceLive;
      continue;
    }
    if (record.type === CODEX_ROLLOUT_TYPE.RESPONSE_ITEM) {
      if (payload.type === CODEX_RESPONSE_PAYLOAD.FUNCTION_CALL) {
        parsed.activity = activityFromCall(payload) ?? parsed.activity;
      }
      // A delegation is written only while the conversation is open, so one is
      // proof of the conversation even when the world-state snapshot that
      // opened it has scrolled past the bounded tail. The snapshot that closes
      // it always lands after the last delegation, so last-in-file-order wins.
      if (payload.type === CODEX_RESPONSE_PAYLOAD.MESSAGE && isRealtimeDelegationMessage(payload)) {
        parsed.realtimeVoiceLive = true;
      }
    }
  }
  return parsed;
}

function timestampFromRow(row: CodexThreadRow): number {
  return Math.max(
    numberFromRow(row, CODEX_THREAD_COLUMN.RECENCY_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT_MS) ?? 0,
    (numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT) ?? 0) * 1000,
    (numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT) ?? 0) * 1000,
  );
}

interface CodexThreadNameSources {
  /**
   * The newest name per thread from Codex's own index, read only on a pass
   * where a marker title actually needs resolving.
   */
  indexNames: ReadonlyMap<string, string>;
  /** Each observed thread's own titled name, for resolving a delegation's source in the same pass. */
  rowTitles: ReadonlyMap<string, string>;
}

/**
 * Codex names its own threads, and that name is what a developer is looking
 * for. A delegated chat's derived title is the delegation marker itself, so it
 * resolves through names Codex actually keeps — the chat's own newest indexed
 * name first, for one renamed since it was spawned, then the source
 * conversation's title or indexed name, because the delegated chat is that
 * conversation's work. The workspace is the fallback for a thread too new to
 * have been named — or one whose only title is the realtime delegation
 * scaffolding, which names no source to borrow from.
 */
function titleFromRow(row: CodexThreadRow, names: CodexThreadNameSources): string {
  const title = oneLine(textFromRow(row, CODEX_THREAD_COLUMN.TITLE), maximumSessionTitleLength);
  const workspace = workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD));
  if (!title) return workspace;
  const ownName = indexedName(names, textFromRow(row, CODEX_THREAD_COLUMN.ID));
  const sourceThreadId = CODEX_DELEGATION_TITLE.exec(title)?.[1];
  if (sourceThreadId) {
    return (
      ownName ??
      names.rowTitles.get(sourceThreadId) ??
      indexedName(names, sourceThreadId) ??
      workspace
    );
  }
  if (isCodexRealtimeDelegationText(title)) return ownName ?? workspace;
  return title;
}

/**
 * The newest indexed name for a thread, unless that name is itself delegation
 * scaffolding: the marker leaking into the index is still not a name, so every
 * candidate passes the same test the title failed.
 */
function indexedName(
  names: CodexThreadNameSources,
  threadId: string | undefined,
): string | undefined {
  const name = names.indexNames.get(threadId ?? "");
  if (name === undefined) return undefined;
  if (CODEX_DELEGATION_TITLE.test(name) || isCodexRealtimeDelegationText(name)) return undefined;
  return name;
}

/**
 * The newest name Codex's own index holds for each thread. Entries are
 * append-only and a later line wins; a line with an empty name is the name
 * being removed, and unmakes what an earlier line said rather than being
 * skipped past it. The read is a bounded tail: the file only ever grows, and
 * the names worth having — a delegated chat's, its source's — are recent by
 * construction.
 */
async function readCodexSessionTitles(codexHome: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const tail = await readTail(
    path.join(codexHome, CODEX_SESSION_INDEX_FILE),
    CODEX_OBSERVATION_DEFAULTS.READ_SESSION_INDEX_TAIL_BYTES,
  );
  for (const line of tail.split(/\r?\n/u)) {
    const record = recordFromJsonLine(line);
    const id = text(record?.id);
    if (!id) continue;
    const title = oneLine(text(record?.thread_name), maximumSessionTitleLength);
    if (title) titles.set(id, title);
    else titles.delete(id);
  }
  return titles;
}

/**
 * Codex keeps the initial user message in the thread row even after it gives
 * the chat a user-facing name. That makes it a more durable signal than the
 * provisional title, while the title fallback covers older rows that do not
 * carry the column's value.
 */
function isCodexRealtimeDelegationThread(row: CodexThreadRow): boolean {
  return (
    isCodexRealtimeDelegationText(textFromRow(row, CODEX_THREAD_COLUMN.FIRST_USER_MESSAGE)) ||
    isCodexRealtimeDelegationText(textFromRow(row, CODEX_THREAD_COLUMN.TITLE))
  );
}

/**
 * The source conversation a delegated chat was born from. Current Codex rows
 * carry an exact parent id in their structured thread source. Older delegated
 * chats used the first-message marker instead: the row keeps that message for
 * its whole life, so the link outlives a rename, while the title stands in for
 * still older rows whose column carries nothing.
 */
function delegationSourceFromRow(row: CodexThreadRow): string | undefined {
  const source = recordFromJsonLine(textFromRow(row, CODEX_THREAD_COLUMN.SOURCE) ?? "");
  const subagentValue = source?.[CODEX_SUBAGENT_SOURCE_FIELD.SUBAGENT];
  const subagent = isRecord(subagentValue) ? subagentValue : undefined;
  const threadSpawnValue = subagent?.[CODEX_SUBAGENT_SOURCE_FIELD.THREAD_SPAWN];
  const threadSpawn = isRecord(threadSpawnValue) ? threadSpawnValue : undefined;
  const parentThreadId = text(threadSpawn?.[CODEX_SUBAGENT_SOURCE_FIELD.PARENT_THREAD_ID]);
  if (parentThreadId && CODEX_THREAD_ID.test(parentThreadId)) return parentThreadId;

  for (const column of [CODEX_THREAD_COLUMN.FIRST_USER_MESSAGE, CODEX_THREAD_COLUMN.TITLE]) {
    const sourceId = CODEX_DELEGATION_TITLE.exec(textFromRow(row, column) ?? "")?.[1];
    if (sourceId) return sourceId;
  }
  return undefined;
}

/**
 * A chat another conversation delegated is a limb of that conversation: while
 * the source thread's rollout says its realtime voice conversation is open,
 * the delegated chat's turn boundaries belong to the same spoken exchange and
 * hold their announcements the same way. The link is the marker Codex itself
 * wrote the chat's first message with, and the source's state is the same
 * pass's rollout read — arithmetic against observed state, nothing decided.
 */
function linkDelegatedVoiceConversations(
  rows: readonly CodexThreadRow[],
  rollouts: Map<string, ParsedCodexRollout>,
): void {
  for (const row of rows) {
    const sourceId = delegationSourceFromRow(row);
    if (!sourceId || rollouts.get(sourceId)?.realtimeVoiceLive !== true) continue;
    const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
    if (!id) continue;
    const parsed = rollouts.get(id);
    if (parsed) parsed.realtimeVoiceLive = true;
    else rollouts.set(id, { realtimeVoiceLive: true });
  }
}

function modelFromRow(row: CodexThreadRow): string | undefined {
  const model = textFromRow(row, CODEX_THREAD_COLUMN.MODEL);
  if (!model) return undefined;
  const effort = textFromRow(row, CODEX_THREAD_COLUMN.REASONING_EFFORT);
  return effort ? `${model} · ${effort}` : model;
}

function statusFromRow(
  rollout: ParsedCodexRollout | undefined,
  lastActivityAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  // A turn that failed is stuck until someone comes back to it, so the error
  // outranks freshness: going stale is exactly what a session waiting on a
  // rescue looks like, and decaying it to unknown would hide the one row
  // that most needs a person.
  if (rollout?.error) return SESSION_STATUS.ERROR;
  const isFresh = now - lastActivityAt <= activeSessionFreshnessMs;
  // A turn that ended is holding for the developer however the row's timestamp
  // reads, but once it is stale Luke cannot tell a turn that just finished from
  // a thread abandoned hours ago.
  if (rollout?.turnComplete === true) {
    return isFresh ? SESSION_STATUS.WAITING : SESSION_STATUS.UNKNOWN;
  }
  if (rollout?.turnComplete === false) return SESSION_STATUS.WORKING;
  return isFresh ? SESSION_STATUS.WORKING : SESSION_STATUS.UNKNOWN;
}

/**
 * What the refinement actually buys here is the states the state database
 * cannot show: a tool call holding for approval writes no records while it
 * holds, and a turn's true end can sit past the rollout's read. The
 * notification keeps waiting past freshness — a standing event is proof the
 * approval dialog is still up, because any record at or past it would have
 * discarded it, and a process killed mid-hold leaves that proof standing
 * only until the spool prune retires it.
 */
const CODEX_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: CODEX_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    {
      event: CODEX_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.WAITING,
    },
    { event: CODEX_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CODEX_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
  ],
  notificationEvent: CODEX_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: CODEX_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<CodexHookEvent>;

function detailFromRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
): SessionDetail {
  const activity = rollout?.activity;
  const branch = textFromRow(row, CODEX_THREAD_COLUMN.GIT_BRANCH);
  const model = modelFromRow(row);
  const error = rollout?.error;
  const threadId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  return {
    ...(activity ? { activity } : undefined),
    repository: workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD)),
    ...(branch ? { branch } : undefined),
    ...(model ? { model } : undefined),
    ...(error ? { error } : undefined),
    ...(threadId
      ? { link: `${CODEX_THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}` }
      : undefined),
  };
}

function chatGptApplication(link: string) {
  return {
    id: SESSION_APPLICATION_ID.CHATGPT,
    displayName: "ChatGPT",
    scope: SESSION_APPLICATION_SCOPE.SESSION,
    link,
  } as const;
}

function observationFromThreadRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
  names: CodexThreadNameSources,
  now: number,
  activeSessionFreshnessMs: number,
  hookEvent?: ObservedCodexHookEvent,
): ProviderSessionObservation | undefined {
  const providerSessionId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  if (!providerSessionId) return undefined;

  const rowAt = timestampFromRow(row);
  const refined = hookRefinedStatus({
    refinement: CODEX_HOOK_STATUS_REFINEMENT,
    hookEvent,
    providerAtMs: rowAt,
    statusAt: (lastActivityAt) =>
      statusFromRow(rollout, lastActivityAt, now, activeSessionFreshnessMs),
    now,
    activeSessionFreshnessMs,
  });
  const completionCause = refined.sessionClosed
    ? SESSION_COMPLETION_CAUSE.SESSION_CLOSED
    : undefined;
  const detail = detailFromRow(row, rollout);
  const parentProviderSessionId = delegationSourceFromRow(row);
  const observation: ProviderSessionObservation = {
    providerSessionId,
    ...(parentProviderSessionId ? { parentProviderSessionId } : undefined),
    title: titleFromRow(row, names),
    status: refined.status,
    ...(completionCause ? { completionCause } : undefined),
    lastActivityAt: refined.lastActivityAt,
    detail,
    ...(detail.link ? { applications: [chatGptApplication(detail.link)] } : undefined),
    ...(refined.holdingForDeveloper ? { holdingForDeveloper: true } : undefined),
  };
  if (isCodexRealtimeDelegationThread(row)) observation.realtimeVoice = true;
  if (rollout?.realtimeVoiceLive === true) observation.realtimeVoiceLive = true;
  return observation;
}

/**
 * Reads the turn boundary for each observed thread, newest first. The cap
 * keeps a crowded day from turning one observation pass into dozens of file
 * reads.
 */
function rollouts(rows: readonly CodexThreadRow[]): Effect.Effect<Map<string, ParsedCodexRollout>> {
  const candidates = rows
    .slice(0, CODEX_OBSERVATION_DEFAULTS.MAXIMUM_ROLLOUT_READS)
    .map((row) => ({
      id: textFromRow(row, CODEX_THREAD_COLUMN.ID),
      rolloutPath: textFromRow(row, CODEX_THREAD_COLUMN.ROLLOUT_PATH),
    }))
    .filter(
      (candidate): candidate is { id: string; rolloutPath: string } =>
        candidate.id !== undefined && candidate.rolloutPath !== undefined,
    );

  return Effect.map(
    Effect.forEach(
      candidates,
      (candidate) =>
        Effect.map(
          Effect.promise(() =>
            readTail(candidate.rolloutPath, CODEX_OBSERVATION_DEFAULTS.READ_ROLLOUT_TAIL_BYTES),
          ),
          (tail) => [candidate.id, parseCodexRolloutTail(tail)] as const,
        ),
      { concurrency: "unbounded" },
    ),
    (parsed) => new Map(parsed),
  );
}

/**
 * Gathers the names a delegated chat's marker title can resolve through. The
 * pass's own rows already carry every titled thread; the name index is a
 * second file read, so it is opened only when some row actually shows a
 * marker in need of a name.
 */
function threadNames(
  codexHome: string,
  rows: readonly CodexThreadRow[],
): Effect.Effect<CodexThreadNameSources> {
  const rowTitles = new Map<string, string>();
  let hasMarkerTitle = false;
  for (const row of rows) {
    const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
    const title = oneLine(textFromRow(row, CODEX_THREAD_COLUMN.TITLE), maximumSessionTitleLength);
    if (!id || !title) continue;
    if (CODEX_DELEGATION_TITLE.test(title) || isCodexRealtimeDelegationText(title)) {
      hasMarkerTitle = true;
      continue;
    }
    rowTitles.set(id, title);
  }
  return Effect.map(
    hasMarkerTitle
      ? Effect.promise(() => readCodexSessionTitles(codexHome))
      : Effect.succeed(new Map<string, string>()),
    (indexNames) => ({ indexNames, rowTitles }),
  );
}

/**
 * Reads what the observation hook last said about each thread. The spool is
 * a refinement, never a dependency: a directory that is missing, unreadable,
 * or holding something unexpected reads as no event, and the row's own
 * verdict stands.
 */
function hookEvents(
  hookEventsDirectory: string | undefined,
  rows: readonly CodexThreadRow[],
): Effect.Effect<Map<string, ObservedCodexHookEvent>> {
  const events = new Map<string, ObservedCodexHookEvent>();
  if (!hookEventsDirectory) return Effect.succeed(events);
  return Effect.as(
    Effect.forEach(
      rows,
      (row) => {
        const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
        if (!id) return Effect.void;
        return Effect.map(
          Effect.orElseSucceed(
            Effect.tryPromise(() => readCodexHookEvent(hookEventsDirectory, id)),
            () => undefined,
          ),
          (event) => {
            if (event) events.set(id, event);
          },
        );
      },
      { concurrency: "unbounded", discard: true },
    ),
    events,
  );
}

/**
 * One pass's rows into one pass's rows on the panel. The rollout, spool and
 * name-index reads all happen with the state database already closed, so a
 * slow disk never holds a read lock on state Codex itself is writing.
 */
export function codexObservations(input: {
  readonly codexHome: string;
  readonly rows: readonly CodexThreadRow[];
  readonly hookEventsDirectory: string | undefined;
  readonly now: number;
  readonly activeSessionFreshnessMs: number;
}): Effect.Effect<readonly ProviderSessionObservation[]> {
  const { codexHome, rows, now, activeSessionFreshnessMs } = input;
  return Effect.map(
    Effect.all(
      [rollouts(rows), hookEvents(input.hookEventsDirectory, rows), threadNames(codexHome, rows)],
      { concurrency: "unbounded" },
    ),
    ([parsedRollouts, events, names]) => {
      linkDelegatedVoiceConversations(rows, parsedRollouts);
      return rows
        .map((row) => {
          const id = textFromRow(row, CODEX_THREAD_COLUMN.ID) ?? "";
          return observationFromThreadRow(
            row,
            parsedRollouts.get(id),
            names,
            now,
            activeSessionFreshnessMs,
            events.get(id),
          );
        })
        .filter(
          (observation): observation is ProviderSessionObservation => observation !== undefined,
        );
    },
  );
}
