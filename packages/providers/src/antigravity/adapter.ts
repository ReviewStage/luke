import fs from "node:fs/promises";
import path from "node:path";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  providerTranscriptResult,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, oneLine, type WireRecord } from "@sidecar/wire";
import {
  canIgnoreFilesystemError,
  fileStats,
  LocalSessionAdapter,
  type LocalSessionAdapterOptions,
  localSessionStatus,
  readDirectory,
  readTextFile,
  sessionIdFromFileName,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import {
  ANTIGRAVITY_ANNOTATIONS_DIRECTORY,
  ANTIGRAVITY_ANNOTATIONS_EXTENSION,
  ANTIGRAVITY_CONVERSATION_STORE_EXTENSION,
  ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
  ANTIGRAVITY_PROFILE_DIRECTORIES,
  ANTIGRAVITY_SUMMARIES_FILE,
  ANTIGRAVITY_SUMMARIES_MAXIMUM_BYTES,
  type AntigravityProfile,
  type AntigravitySessionSummary,
  type AntigravityWorkspace,
  antigravityAnnotationTitle,
  antigravityCheckpointTitle,
  antigravityDeveloperWords,
  antigravityErrorWords,
  antigravityNotifyWords,
  antigravitySessionLink,
  antigravityStepToolCall,
  antigravityTrajectoryWorkspace,
  bytesFromRow,
  CASCADE_RUN_STATUS,
  CORTEX_STEP_STATUS,
  CORTEX_STEP_TYPE,
  defaultAntigravityHome,
  type ProtoField,
  parseAntigravitySummaries,
  protoFields,
} from "./records.js";
import { ANTIGRAVITY_SESSION_ID_PATTERN, readAntigravitySessionTranscript } from "./transcript.js";

/**
 * Observes the Antigravity conversations on this machine — the Agent
 * Manager's, the IDE's, and the terminal CLI's — from the state those
 * surfaces already write for themselves under `~/.gemini`. It runs no
 * server, needs no credential, registers no hook, and opens everything
 * read-only. Only the Agent Manager writes the summaries index, so its
 * conversations draw the index's own reading — title, run status, workspace,
 * permission holds; a surface without the index still writes every
 * conversation's own store, and those draw rows derived from the store's
 * newest step instead. A derived conversation is named by the developer's
 * own rename when the annotations file carries one, else by the title the
 * app generated for itself — recorded on the conversation's newest
 * checkpoint step, the same name every surface's picker shows — else by the
 * developer's opening ask, else by its workspace. A row's address
 * is the profile's own app — the Agent Manager under its `antigravity:`
 * scheme, the IDE's folder window under `antigravity-ide://file` — because
 * neither app documents a conversation-level deep link; a CLI conversation,
 * like every terminal agent's, has no address at all. Antigravity documents
 * no way into a running conversation this build could carry a message
 * through, so its sessions advertise nothing and stay entirely read-only.
 */

const ANTIGRAVITY_PROVIDER_NAME = "Antigravity";

export const ANTIGRAVITY_PROVIDER: SessionProvider = {
  id: PROVIDER_ID.ANTIGRAVITY,
  displayName: ANTIGRAVITY_PROVIDER_NAME,
};

const ANTIGRAVITY_ADAPTER_DEFAULTS = {
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

/** The one thing Cursor's adapter also says when a turn failed wordlessly. */
const ANTIGRAVITY_TURN_FAILED = "The turn failed";

const ANTIGRAVITY_STEP_COLUMN = {
  STATUS: "status",
  STEP_PAYLOAD: "step_payload",
  ERROR_DETAILS: "error_details",
} as const;

const ANTIGRAVITY_METADATA_COLUMN = {
  DATA: "data",
} as const;

// The newest step alone: whether the conversation's last recorded move was a
// failure, and which tool it was inside. The projection names its columns so
// the payload blob travels once; a schema this build does not fit costs the
// tip, never the pass.
const ANTIGRAVITY_TIP_QUERY = `
  SELECT status, step_payload, error_details
  FROM steps
  ORDER BY idx DESC
  LIMIT 1
`;

// The newest step of one type — the recap the newest notify-user step
// carries, and the generated title the newest checkpoint records — read from
// the store itself for the surfaces that keep no index. The store's own
// step-type index makes each a point read.
const ANTIGRAVITY_LATEST_STEP_QUERY = `
  SELECT step_payload
  FROM steps
  WHERE step_type = ?1
  ORDER BY idx DESC
  LIMIT 1
`;

// The conversation's opening user input, for the developer's own opening
// words.
const ANTIGRAVITY_FIRST_INPUT_QUERY = `
  SELECT step_payload
  FROM steps
  WHERE step_type = ?1
  ORDER BY idx ASC
  LIMIT 1
`;

// The store's own trajectory metadata: the workspace record the summaries
// index carries per conversation, kept here by the surfaces that write no
// index.
const ANTIGRAVITY_METADATA_QUERY = `
  SELECT data
  FROM trajectory_metadata_blob
  LIMIT 1
`;

export interface AntigravityAdapterOptions extends LocalSessionAdapterOptions {
  antigravityHome?: string;
  sqlite?: SqliteModuleLoader;
  transcriptMaximumRenderedLength?: number;
}

/** What the conversation store's newest step says about the turn. */
interface AntigravityConversationTip {
  /** The newest step failed; the words are the app's own, when it wrote any. */
  erred: boolean;
  /** The newest step is holding on a question only the developer can answer. */
  holding: boolean;
  /** The newest step is still moving. */
  working: boolean;
  failure?: string;
  /** The tool the newest still-open step is running. */
  activity?: string;
}

/** One conversation as its own store describes it, where no index speaks. */
interface AntigravityDerivedConversation {
  tip: AntigravityConversationTip;
  /** The agent's latest notification to the developer, verbatim. */
  notifyWords?: string;
  /** The workspace the store's own metadata names. */
  folderPath?: string;
  /** The branch the store's own metadata says the conversation began on. */
  storedBranch?: string;
  /**
   * The conversation's own generated title, as the newest checkpoint step
   * records it — the same name the surfaces' pickers show.
   */
  generatedTitle?: string;
  /**
   * The developer's own opening ask, for the title a store without an index
   * never records: the same reading Devin's own store designates as a
   * session's name, taken here because a row that cannot be told apart from
   * its siblings is not worth the space beside the housing. A conversation
   * opened by voice or by an empty prompt has none, and keeps the workspace
   * label.
   */
  openingWords?: string;
}

const MOVING_STEP_STATUSES: ReadonlySet<number> = new Set([
  CORTEX_STEP_STATUS.PENDING,
  CORTEX_STEP_STATUS.RUNNING,
  CORTEX_STEP_STATUS.GENERATING,
  CORTEX_STEP_STATUS.QUEUED,
]);

function tipFromRow(row: WireRecord): AntigravityConversationTip {
  const stepStatus = numberFromRow(row, ANTIGRAVITY_STEP_COLUMN.STATUS);
  const payloadBytes = bytesFromRow(row, ANTIGRAVITY_STEP_COLUMN.STEP_PAYLOAD);
  const stepFields = payloadBytes ? protoFields(payloadBytes) : undefined;
  if (stepStatus === CORTEX_STEP_STATUS.ERROR) {
    const failure = antigravityErrorWords(
      bytesFromRow(row, ANTIGRAVITY_STEP_COLUMN.ERROR_DETAILS),
      ANTIGRAVITY_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
    );
    return { erred: true, holding: false, working: false, ...(failure ? { failure } : undefined) };
  }
  const holding = stepStatus === CORTEX_STEP_STATUS.WAITING;
  const working = stepStatus !== undefined && MOVING_STEP_STATUSES.has(stepStatus);
  const toolCall =
    (holding || working) && stepFields
      ? antigravityStepToolCall(stepFields, ANTIGRAVITY_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH)
      : undefined;
  return {
    erred: false,
    holding,
    working,
    ...(toolCall
      ? { activity: toolCall.detail ? `${toolCall.name}: ${toolCall.detail}` : toolCall.name }
      : undefined),
  };
}

function isRunning(runStatus: number | undefined): boolean {
  return (
    runStatus === CASCADE_RUN_STATUS.RUNNING ||
    runStatus === CASCADE_RUN_STATUS.BUSY ||
    runStatus === CASCADE_RUN_STATUS.CANCELING
  );
}

/**
 * Whose move the summary says it is. A step holding for permission is the
 * developer's move whatever the run status says, because the loop only looks
 * running while it waits. A run the developer killed is over, not moving. A
 * failure on the newest step of a settled conversation is a stop the
 * developer has to come back for. Everything still running is working, and a
 * killed process leaves its last state on disk forever, so anything gone
 * quiet decays to unknown rather than posing as live. Nothing in the store
 * marks a conversation closed, so a local Antigravity session is never
 * complete; the app's own archive control removes it from the roster instead.
 */
function statusFromSummary(
  summary: AntigravitySessionSummary,
  tip: AntigravityConversationTip | undefined,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  const running = !summary.killed && isRunning(summary.runStatus);
  if (summary.holding) {
    return localSessionStatus(SESSION_STATUS.WAITING, observedAt, now, freshnessMs);
  }
  if (tip?.erred && !running) return SESSION_STATUS.ERROR;
  return localSessionStatus(
    running ? SESSION_STATUS.WORKING : SESSION_STATUS.WAITING,
    observedAt,
    now,
    freshnessMs,
  );
}

/**
 * Whose move a derived conversation's newest step says it is. The store
 * records step states rather than the loop's own status, so a settled newest
 * step reads as the developer's move — between one step closing and the next
 * opening that is briefly wrong, but the next pass reads the step that
 * followed. The same decay applies as everywhere local: a killed process
 * leaves its last step on disk forever, so anything gone quiet is unknown
 * rather than still working.
 */
function statusFromDerived(
  tip: AntigravityConversationTip,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (tip.holding) {
    return localSessionStatus(SESSION_STATUS.WAITING, observedAt, now, freshnessMs);
  }
  if (tip.erred) return SESSION_STATUS.ERROR;
  return localSessionStatus(
    tip.working ? SESSION_STATUS.WORKING : SESSION_STATUS.WAITING,
    observedAt,
    now,
    freshnessMs,
  );
}

function detailFromSummary(
  summary: AntigravitySessionSummary,
  tip: AntigravityConversationTip | undefined,
  status: SessionStatus,
): SessionDetail {
  const activity =
    status === SESSION_STATUS.WORKING
      ? tip?.activity
      : summary.holding
        ? summary.holdingActivity
        : undefined;
  const failure =
    status === SESSION_STATUS.ERROR ? (tip?.failure ?? ANTIGRAVITY_TURN_FAILED) : undefined;
  return {
    ...(activity ? { activity } : undefined),
    repository: workspaceLabel(summary.folderPath),
    ...(summary.branch ? { branch: summary.branch } : undefined),
    ...(failure ? { error: failure } : undefined),
  };
}

/**
 * The summaries index whole, bounded and read-only. The file is rewritten in
 * place rather than appended, so a bounded region of it would be a different
 * document; the cap refuses a file no healthy install writes.
 */
async function readSummariesBytes(filePath: string): Promise<Uint8Array | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size > ANTIGRAVITY_SUMMARIES_MAXIMUM_BYTES) {
      return undefined;
    }
    const buffer = Buffer.alloc(stats.size);
    await handle.read(buffer, 0, stats.size, 0);
    return buffer;
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return undefined;
  } finally {
    await handle?.close();
  }
}

export class AntigravitySessionAdapter extends LocalSessionAdapter {
  readonly provider = ANTIGRAVITY_PROVIDER;

  readonly #antigravityHome: string;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #parsedSummaries = new Map<
    string,
    { mtimeMs: number; summaries: readonly AntigravitySessionSummary[] }
  >();
  readonly #parsedStores = new Map<
    string,
    { mtimeMs: number; derived: AntigravityDerivedConversation | undefined }
  >();

  constructor(options: AntigravityAdapterOptions = {}) {
    super(options);
    this.#antigravityHome = options.antigravityHome ?? defaultAntigravityHome();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.observationTime();
    const observations = new Map<string, ProviderSessionObservation>();
    const summariesFilesSeen = new Set<string>();
    const storesSeen = new Set<string>();
    for (const profile of ANTIGRAVITY_PROFILE_DIRECTORIES) {
      const profileDirectory = path.join(this.#antigravityHome, profile);
      const summariesPath = path.join(profileDirectory, ANTIGRAVITY_SUMMARIES_FILE);
      const stats = await fileStats(summariesPath);
      if (!stats?.isFile()) continue;
      summariesFilesSeen.add(summariesPath);
      const summaries = await this.#summaries(summariesPath, stats.mtimeMs);
      if (!summaries) continue;
      for (const summary of summaries) {
        // Filed away in the app's own listing is filed away here: the row
        // returns whenever the developer unarchives it.
        if (summary.archived) continue;
        // One conversation can appear in both profiles after a migration; the
        // first profile's reading wins, matching the composite adapters.
        if (observations.has(summary.conversationId)) continue;
        const observedAt = summary.observedAtMs ?? stats.mtimeMs;
        // The store's own newest step rides along however old the row is — a
        // failure lives only on that step, and a failure does not heal by
        // going stale — at the price of one cached, mtime-keyed reading.
        const tip = (await this.#storeReading(profileDirectory, summary.conversationId, storesSeen))
          ?.tip;
        observations.set(
          summary.conversationId,
          this.#observation(profile, summary, tip, observedAt, now),
        );
      }
    }
    // The stores come second across every profile, so an index's reading of a
    // conversation always outranks a reading derived from its store alone.
    for (const profile of ANTIGRAVITY_PROFILE_DIRECTORIES) {
      await this.#observeConversationStores(profile, observations, storesSeen, now);
    }
    for (const filePath of this.#parsedSummaries.keys()) {
      if (!summariesFilesSeen.has(filePath)) this.#parsedSummaries.delete(filePath);
    }
    for (const filePath of this.#parsedStores.keys()) {
      if (!storesSeen.has(filePath)) this.#parsedStores.delete(filePath);
    }
    return [...observations.values()];
  }

  override readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return providerTranscriptResult(
      readAntigravitySessionTranscript({
        antigravityHome: this.#antigravityHome,
        providerSessionId,
        sqlite: this.#sqlite,
        maximumRenderedLength: this.#transcriptMaximumRenderedLength,
      }),
    );
  }

  #observation(
    profile: AntigravityProfile,
    summary: AntigravitySessionSummary,
    tip: AntigravityConversationTip | undefined,
    observedAt: number,
    now: number,
  ): ProviderSessionObservation {
    const status = statusFromSummary(summary, tip, observedAt, now, this.activeSessionFreshnessMs);
    // The agent's latest notification is its own word on where the work
    // stands — the recap field of this store — but only once the turn is not
    // moving past it: mid-run it describes a moment already left behind.
    const recap =
      status === SESSION_STATUS.WORKING
        ? undefined
        : oneLine(summary.notifyWords, maximumSessionRecapLength);
    const link = antigravitySessionLink(profile, summary.conversationId, summary.folderPath);
    return {
      providerSessionId: summary.conversationId,
      title:
        oneLine(summary.title, maximumSessionTitleLength) ?? workspaceLabel(summary.folderPath),
      status,
      observedAt,
      ...(recap ? { recap } : undefined),
      detail: {
        ...detailFromSummary(summary, tip, status),
        ...(link ? { link } : undefined),
      },
      ...(summary.folderPath ? { directory: summary.folderPath } : undefined),
      ...(status === SESSION_STATUS.WAITING && summary.holding
        ? { holdingForDeveloper: true }
        : undefined),
    };
  }

  /**
   * The conversations a profile's own stores describe, for every id no index
   * already spoke for. The stores are the same files the transcript read
   * opens; here only the newest step and the newest notification are read.
   * Legacy `.pb` conversations are not stores and draw nothing.
   */
  async #observeConversationStores(
    profile: AntigravityProfile,
    observations: Map<string, ProviderSessionObservation>,
    storesSeen: Set<string>,
    now: number,
  ): Promise<void> {
    const profileDirectory = path.join(this.#antigravityHome, profile);
    const conversationsDirectory = path.join(profileDirectory, ANTIGRAVITY_CONVERSATIONS_DIRECTORY);
    for (const entry of await readDirectory(conversationsDirectory)) {
      if (!entry.isFile()) continue;
      const conversationId = sessionIdFromFileName(
        entry.name,
        ANTIGRAVITY_CONVERSATION_STORE_EXTENSION,
      );
      if (!conversationId || !ANTIGRAVITY_SESSION_ID_PATTERN.test(conversationId)) continue;
      if (observations.has(conversationId)) continue;
      const storePath = path.join(conversationsDirectory, entry.name);
      const stats = await fileStats(storePath);
      if (!stats?.isFile()) continue;
      storesSeen.add(storePath);
      const derived = await this.#derivedConversation(storePath, stats.mtimeMs);
      if (!derived) continue;
      const title = await this.#annotationTitle(profileDirectory, conversationId);
      // The branch the store's metadata recorded at the start, which can be
      // stale after a checkout. The folder's own HEAD would say where it
      // stands now, but a repository under Documents, Desktop, or Downloads
      // pays for that read with macOS's folder consent dialog: a label is
      // not worth a permission, so observation never touches the folder.
      const branch = derived.storedBranch;
      observations.set(
        conversationId,
        this.#derivedObservation(
          profile,
          conversationId,
          title,
          derived,
          branch,
          stats.mtimeMs,
          now,
        ),
      );
    }
  }

  #derivedObservation(
    profile: AntigravityProfile,
    conversationId: string,
    title: string | undefined,
    derived: AntigravityDerivedConversation,
    branch: string | undefined,
    observedAt: number,
    now: number,
  ): ProviderSessionObservation {
    const status = statusFromDerived(derived.tip, observedAt, now, this.activeSessionFreshnessMs);
    const recap =
      status === SESSION_STATUS.WORKING
        ? undefined
        : oneLine(derived.notifyWords, maximumSessionRecapLength);
    const activity =
      status === SESSION_STATUS.WORKING ||
      (status === SESSION_STATUS.WAITING && derived.tip.holding)
        ? derived.tip.activity
        : undefined;
    const failure =
      status === SESSION_STATUS.ERROR
        ? (derived.tip.failure ?? ANTIGRAVITY_TURN_FAILED)
        : undefined;
    const link = antigravitySessionLink(profile, conversationId, derived.folderPath);
    return {
      providerSessionId: conversationId,
      // The developer's own rename first, then the title the app generated
      // for itself, then the developer's opening ask, then the workspace for
      // a conversation too young to have earned any of those.
      title:
        oneLine(title, maximumSessionTitleLength) ??
        oneLine(derived.generatedTitle, maximumSessionTitleLength) ??
        oneLine(derived.openingWords, maximumSessionTitleLength) ??
        workspaceLabel(derived.folderPath),
      status,
      observedAt,
      ...(recap ? { recap } : undefined),
      detail: {
        ...(activity ? { activity } : undefined),
        repository: workspaceLabel(derived.folderPath),
        ...(branch ? { branch } : undefined),
        ...(failure ? { error: failure } : undefined),
        ...(link ? { link } : undefined),
      },
      ...(derived.folderPath ? { directory: derived.folderPath } : undefined),
      ...(status === SESSION_STATUS.WAITING && derived.tip.holding
        ? { holdingForDeveloper: true }
        : undefined),
    };
  }

  /** The developer's own rename, when the annotations file carries one. */
  async #annotationTitle(
    profileDirectory: string,
    conversationId: string,
  ): Promise<string | undefined> {
    const document = await readTextFile(
      path.join(
        profileDirectory,
        ANTIGRAVITY_ANNOTATIONS_DIRECTORY,
        `${conversationId}${ANTIGRAVITY_ANNOTATIONS_EXTENSION}`,
      ),
    );
    return document ? antigravityAnnotationTitle(document) : undefined;
  }

  async #derivedConversation(
    storePath: string,
    mtimeMs: number,
  ): Promise<AntigravityDerivedConversation | undefined> {
    const cached = this.#parsedStores.get(storePath);
    if (cached?.mtimeMs === mtimeMs) return cached.derived;
    const database = await openReadOnlyDatabase(this.#sqlite, storePath);
    if (!database) return undefined;
    let derived: AntigravityDerivedConversation | undefined;
    try {
      const row = this.#tipRow(database);
      if (row) {
        const notifyStep = this.#stepFields(
          database,
          ANTIGRAVITY_LATEST_STEP_QUERY,
          CORTEX_STEP_TYPE.NOTIFY_USER,
        );
        const notifyWords = notifyStep ? antigravityNotifyWords(notifyStep) : undefined;
        const checkpointStep = this.#stepFields(
          database,
          ANTIGRAVITY_LATEST_STEP_QUERY,
          CORTEX_STEP_TYPE.CHECKPOINT,
        );
        const generatedTitle = checkpointStep
          ? antigravityCheckpointTitle(checkpointStep)
          : undefined;
        const openingStep = this.#stepFields(
          database,
          ANTIGRAVITY_FIRST_INPUT_QUERY,
          CORTEX_STEP_TYPE.USER_INPUT,
        );
        const openingWords = openingStep ? antigravityDeveloperWords(openingStep) : undefined;
        const workspace = this.#trajectoryWorkspace(database);
        derived = {
          tip: tipFromRow(row),
          ...(notifyWords !== undefined ? { notifyWords } : undefined),
          ...(generatedTitle !== undefined ? { generatedTitle } : undefined),
          ...(openingWords !== undefined ? { openingWords } : undefined),
          ...(workspace.folderPath !== undefined
            ? { folderPath: workspace.folderPath }
            : undefined),
          ...(workspace.branch !== undefined ? { storedBranch: workspace.branch } : undefined),
        };
      }
    } finally {
      database.close();
    }
    this.#parsedStores.set(storePath, { mtimeMs, derived });
    return derived;
  }

  /** The workspace the store's own metadata names, or none recorded. */
  #trajectoryWorkspace(database: SqliteDatabase): AntigravityWorkspace {
    try {
      const row = database
        .prepare(ANTIGRAVITY_METADATA_QUERY)
        .all()
        .find((candidate): candidate is WireRecord => isRecord(candidate));
      if (!row) return {};
      const metadataBytes = bytesFromRow(row, ANTIGRAVITY_METADATA_COLUMN.DATA);
      return metadataBytes ? antigravityTrajectoryWorkspace(metadataBytes) : {};
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return {};
      throw error;
    }
  }

  /** One step of one type, by the query's own ordering, or nothing readable. */
  #stepFields(
    database: SqliteDatabase,
    query: string,
    stepType: number,
  ): readonly ProtoField[] | undefined {
    try {
      const row = database
        .prepare(query)
        .all(stepType)
        .find((candidate): candidate is WireRecord => isRecord(candidate));
      if (!row) return undefined;
      const payloadBytes = bytesFromRow(row, ANTIGRAVITY_STEP_COLUMN.STEP_PAYLOAD);
      return payloadBytes ? protoFields(payloadBytes) : undefined;
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return undefined;
      throw error;
    }
  }

  async #summaries(
    filePath: string,
    mtimeMs: number,
  ): Promise<readonly AntigravitySessionSummary[] | undefined> {
    const cached = this.#parsedSummaries.get(filePath);
    if (cached?.mtimeMs === mtimeMs) return cached.summaries;
    const bytes = await readSummariesBytes(filePath);
    const summaries = bytes ? parseAntigravitySummaries(bytes) : undefined;
    if (!summaries) return undefined;
    this.#parsedSummaries.set(filePath, { mtimeMs, summaries });
    return summaries;
  }

  /**
   * One conversation's own store, read through the mtime-keyed cache.
   * Conversations from older builds have no readable store — their `.pb`
   * files are not plaintext — and read as nothing, exactly like a store
   * another process holds locked: the caller's own account stands.
   */
  async #storeReading(
    profileDirectory: string,
    conversationId: string,
    storesSeen: Set<string>,
  ): Promise<AntigravityDerivedConversation | undefined> {
    if (!ANTIGRAVITY_SESSION_ID_PATTERN.test(conversationId)) return undefined;
    const storePath = path.join(
      profileDirectory,
      ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
      `${conversationId}${ANTIGRAVITY_CONVERSATION_STORE_EXTENSION}`,
    );
    const stats = await fileStats(storePath);
    if (!stats?.isFile()) return undefined;
    storesSeen.add(storePath);
    return this.#derivedConversation(storePath, stats.mtimeMs);
  }

  /** A steps table this build cannot read costs the tip, not the pass. */
  #tipRow(database: SqliteDatabase): WireRecord | undefined {
    try {
      return database
        .prepare(ANTIGRAVITY_TIP_QUERY)
        .all()
        .find((row): row is WireRecord => isRecord(row));
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return undefined;
      throw error;
    }
  }
}
