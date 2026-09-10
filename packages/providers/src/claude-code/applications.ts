import os from "node:os";
import path from "node:path";
import {
  maximumSessionTitleLength,
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  type SessionApplication,
} from "@sidecar/session";
import { text, unparsedWire, type WireRecord, wireRecord } from "@sidecar/wire";
import { type HostClaims, hostClaims, type WorkspaceHostContexts } from "../shared/host-claims.js";
import { readDirectory, readTextFile, statDirectoryEntry } from "../shared/local-files.js";

const CLAUDE_DESKTOP_APPLICATION_SUPPORT_DIRECTORY = "Claude";
const CLAUDE_DESKTOP_SESSIONS_DIRECTORY = "claude-code-sessions";
const CLAUDE_DESKTOP_SESSION_FILE_EXTENSION = ".json";

/** The app's own name: its Code tab is where these sessions are held. */
const CLAUDE_DESKTOP_APPLICATION_NAME = "Claude";

/**
 * The fields of one record in the Claude desktop app's session store. The app
 * keeps one JSON file per Code-tab session under its own application data,
 * `claude-code-sessions/<account>/<organization>/<sessionId>.json`, and each
 * names the Claude Code transcript the session runs as, so this is the app's
 * own statement of which transcripts are its chats.
 */
const CLAUDE_DESKTOP_SESSION_FIELD = {
  SESSION_ID: "sessionId",
  CLI_SESSION_ID: "cliSessionId",
  TITLE: "title",
  IS_ARCHIVED: "isArchived",
} as const;

/**
 * The shape of the app's own id for a Code-tab session, the same pattern the
 * app's URL handler admits for one. A record whose id falls outside it names
 * a chat the app would not route to, so the association stands without an
 * address rather than composing one that lands somewhere else.
 */
const CLAUDE_DESKTOP_SESSION_ID_PATTERN = /^local_[A-Za-z0-9-]{1,64}$/u;

/**
 * The Code tab's own route to one of its sessions, as the app itself navigates
 * to one after an import or a launcher action.
 */
const CLAUDE_DESKTOP_CODE_ROUTE = "epitaxy";

const CLAUDE_DESKTOP_READER_DEFAULTS = {
  MAXIMUM_ACCOUNT_DIRECTORIES: 8,
  MAXIMUM_ORGANIZATION_DIRECTORIES: 16,
  MAXIMUM_SESSION_FILES: 500,
  /**
   * A record carries the session's MCP configuration and prompt snapshot
   * beside the few fields read here, so it runs to hundreds of kilobytes; a
   * file past this bound is something other than a session record.
   */
  MAXIMUM_SESSION_FILE_BYTES: 8 * 1024 * 1024,
} as const;

/**
 * The address of one Code-tab session in the Claude desktop app: the app's own
 * scheme carrying the in-app route it navigates to for that session, exactly
 * as the app composes it for itself. The app resolves the id against the
 * sessions it holds and shows that one; the address reaches no provider and
 * needs no credential, because the app that wrote the record is the scheme's
 * handler. Two other routes the app registers are deliberately not used:
 * `claude://code/continue?session=…` stands behind a feature gate the app
 * reads at launch and does nothing while the gate is off, and
 * `claude://claude.ai/resume?session=…` imports a transcript as a new
 * session — rewriting the transcript file as it does, and standing a second
 * chat beside one the app already holds — which is a write into a provider's
 * file at one remove and never an open.
 */
export function claudeDesktopSessionLink(desktopSessionId: string): string {
  return `claude://claude.ai/${CLAUDE_DESKTOP_CODE_ROUTE}/${encodeURIComponent(desktopSessionId)}`;
}

/** What the Claude desktop app's own store says about one session it holds. */
interface ClaudeDesktopSessionContext {
  /** The app's own id for the session, absent when it is not one the handler takes. */
  desktopSessionId?: string;
  /** The name the app shows in its Code tab sidebar. */
  title?: string;
  /**
   * The user archived this chat in the app's own sidebar. Archiving is how a
   * user says the chat is done being watched, so it keeps the chat off the
   * panel the way a Conductor chat filed away is kept off.
   */
  archived?: boolean;
}

function defaultClaudeDesktopSessionsDirectory(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    CLAUDE_DESKTOP_APPLICATION_SUPPORT_DIRECTORY,
    CLAUDE_DESKTOP_SESSIONS_DIRECTORY,
  );
}

/**
 * Annotates already-observed Claude Code sessions with the Claude desktop app
 * that holds them, without opening any transcript. An absent app or an
 * unreadable store means no annotation; failure can never make the provider's
 * own observation disappear. Only the app's own positive record that the user
 * archived a chat drops a row, and drops it whole.
 */
function claudeDesktopClaims(
  contexts: WorkspaceHostContexts<ClaudeDesktopSessionContext>,
): HostClaims {
  return hostClaims<ClaudeDesktopSessionContext>({
    applicationId: SESSION_APPLICATION_ID.CLAUDE,
    contexts,
    retains: (context) => context.archived !== true,
    annotate({ observation, context, hostSessions }) {
      // A sub-agent's inherited context addresses the ancestor chat, which is
      // where its conversation is shown.
      const link = context.desktopSessionId
        ? claudeDesktopSessionLink(context.desktopSessionId)
        : undefined;
      const application: SessionApplication = {
        id: SESSION_APPLICATION_ID.CLAUDE,
        displayName: CLAUDE_DESKTOP_APPLICATION_NAME,
        scope: SESSION_APPLICATION_SCOPE.SESSION,
        ...(link ? { link } : undefined),
      };
      // The address fills the row's link only where nothing else gave one; the
      // session normalization decides which linked mark a grouped row's press
      // follows.
      const detail =
        link && !observation.detail?.link ? { ...observation.detail, link } : observation.detail;
      // The app's title is what the user reads in its sidebar, so it titles the
      // row here — but only on the chat itself, never inherited by a sub-agent,
      // which would then read as the same conversation twice.
      const title = hostSessions.get(observation.providerSessionId)?.title;
      return {
        ...observation,
        ...(title ? { title } : undefined),
        ...(detail ? { detail } : undefined),
        applications: [...(observation.applications ?? []), application],
      };
    },
  });
}

interface ParsedSessionRecord {
  mtimeMs: number;
  size: number;
  cliSessionId?: string;
  context?: ClaudeDesktopSessionContext;
}

function sortedNames(entries: readonly { name: string }[]): string[] {
  return entries.map((entry) => entry.name).sort();
}

export interface ClaudeDesktopApplicationsOptions {
  sessionsDirectory?: string;
}

/** One workspace manager's claims, and the empty claim a failed read stands in with. */
export interface ClaudeDesktopApplications {
  read(): Promise<HostClaims>;
  readonly empty: HostClaims;
}

/**
 * Reads the Claude desktop app's own session store without opening any
 * transcript. An absent app, a store this build cannot read, or a failed
 * auxiliary read means an empty claim; failure can never make the provider's
 * observation disappear. Records are re-parsed only when their file changes,
 * because each one carries far more than the few fields read here.
 */
export function claudeDesktopApplications(
  options: ClaudeDesktopApplicationsOptions = {},
): ClaudeDesktopApplications {
  const sessionsDirectory = options.sessionsDirectory ?? defaultClaudeDesktopSessionsDirectory();
  const records = new Map<string, ParsedSessionRecord>();

  /**
   * Every session record under `<account>/<organization>/`, each level read
   * with `lstat` so a link out of the store is never followed, and each
   * bounded so a runaway directory costs a bounded pass.
   */
  const sessionFiles = async (): Promise<ReadonlySet<string>> => {
    const filePaths = new Set<string>();
    const accountNames = sortedNames(await readDirectory(sessionsDirectory)).slice(
      0,
      CLAUDE_DESKTOP_READER_DEFAULTS.MAXIMUM_ACCOUNT_DIRECTORIES,
    );
    for (const accountName of accountNames) {
      const account = await statDirectoryEntry(sessionsDirectory, accountName);
      if (!account?.stats.isDirectory()) continue;
      const organizationNames = sortedNames(await readDirectory(account.directoryPath)).slice(
        0,
        CLAUDE_DESKTOP_READER_DEFAULTS.MAXIMUM_ORGANIZATION_DIRECTORIES,
      );
      for (const organizationName of organizationNames) {
        const organization = await statDirectoryEntry(account.directoryPath, organizationName);
        if (!organization?.stats.isDirectory()) continue;
        const fileNames = sortedNames(await readDirectory(organization.directoryPath))
          .filter((name) => name.endsWith(CLAUDE_DESKTOP_SESSION_FILE_EXTENSION))
          .slice(0, CLAUDE_DESKTOP_READER_DEFAULTS.MAXIMUM_SESSION_FILES);
        for (const fileName of fileNames) {
          const file = await statDirectoryEntry(organization.directoryPath, fileName);
          if (!file?.stats.isFile()) continue;
          if (file.stats.size > CLAUDE_DESKTOP_READER_DEFAULTS.MAXIMUM_SESSION_FILE_BYTES) continue;
          filePaths.add(file.directoryPath);
        }
        if (filePaths.size >= CLAUDE_DESKTOP_READER_DEFAULTS.MAXIMUM_SESSION_FILES) {
          return filePaths;
        }
      }
    }
    return filePaths;
  };

  const recordAt = async (filePath: string): Promise<ParsedSessionRecord | undefined> => {
    const file = await statDirectoryEntry(path.dirname(filePath), path.basename(filePath));
    if (!file?.stats.isFile()) return undefined;
    const cached = records.get(filePath);
    if (cached && cached.mtimeMs === file.stats.mtimeMs && cached.size === file.stats.size) {
      return cached;
    }
    const parsed: ParsedSessionRecord = {
      mtimeMs: file.stats.mtimeMs,
      size: file.stats.size,
      ...parseSessionRecord(await readTextFile(filePath)),
    };
    records.set(filePath, parsed);
    return parsed;
  };

  return {
    async read() {
      const filePaths = await sessionFiles();
      const contexts = new Map<string, ClaudeDesktopSessionContext>();
      for (const filePath of filePaths) {
        const record = await recordAt(filePath);
        if (!record?.cliSessionId || !record.context) continue;
        // An imported transcript can stand behind two records, one archived
        // and one not; the open one is the one the app shows.
        const standing = contexts.get(record.cliSessionId);
        if (standing && standing.archived !== true && record.context.archived === true) continue;
        contexts.set(record.cliSessionId, record.context);
      }
      for (const filePath of records.keys()) {
        if (!filePaths.has(filePath)) records.delete(filePath);
      }
      return claudeDesktopClaims(
        contexts.size > 0 ? new Map([[PROVIDER_ID.CLAUDE_CODE, contexts]]) : new Map(),
      );
    },

    empty: claudeDesktopClaims(new Map()),
  };
}

/**
 * The few fields read out of one record. A file that is not JSON, or a JSON
 * document naming no transcript, is not a session record and annotates
 * nothing; the store keeps other files beside the sessions.
 */
function parseSessionRecord(
  contents: string | undefined,
): Pick<ParsedSessionRecord, "cliSessionId" | "context"> {
  const record = contents === undefined ? undefined : recordFromJson(contents);
  if (!record) return {};
  const cliSessionId = text(record[CLAUDE_DESKTOP_SESSION_FIELD.CLI_SESSION_ID]);
  if (!cliSessionId) return {};
  const sessionId = text(record[CLAUDE_DESKTOP_SESSION_FIELD.SESSION_ID]);
  const title = text(record[CLAUDE_DESKTOP_SESSION_FIELD.TITLE])?.slice(
    0,
    maximumSessionTitleLength,
  );
  const archived = record[CLAUDE_DESKTOP_SESSION_FIELD.IS_ARCHIVED] === true;
  return {
    cliSessionId,
    context: {
      ...(sessionId && CLAUDE_DESKTOP_SESSION_ID_PATTERN.test(sessionId)
        ? { desktopSessionId: sessionId }
        : undefined),
      ...(title ? { title } : undefined),
      ...(archived ? { archived } : undefined),
    },
  };
}

function recordFromJson(contents: string): WireRecord | undefined {
  try {
    return wireRecord(unparsedWire(JSON.parse(contents)));
  } catch {
    return undefined;
  }
}
