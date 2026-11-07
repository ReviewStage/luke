import { Schema as EffectSchema } from "effect";
import { agentMessagesAnswerSchema } from "./agent-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * live-wire.ts -- a read the desktop follows over Neon Realtime: the sealed statements the service answers, and the rows they deliver.
 *
 * Neon's guide is followed as written: the service builds each statement
 * with the account's id in it and seals it ("Sealing authorized queries"),
 * the desktop fetches the sealed statements from an endpoint ("Fetch from an
 * API endpoint"), subscribes to them at the address the answer names, and
 * renews them before they expire ("Renew the sealed query"). A sealed
 * statement is a short-lived bearer: it is held where the account's own
 * bearer is, in the desktop's host, and never carried on to a window.
 *
 * The rows are the wire's own entries, since the service writes each live
 * statement to select every column under the key the wire reads it by and
 * each instant as epoch milliseconds. Realtime keeps no order, so the
 * reader orders them as the held read does.
 */

/**
 * The address a live read is answered at where it was read rather than
 * sealed: the reader asked to poll, or Realtime could not seal it. Each
 * statement then carries its rows, and nothing subscribes.
 */
export const LIVE_POLL_URL = "vespin-poll:";

/**
 * How a reader asks for a live read's rows inline rather than sealed, while
 * Realtime fails it; where they last stood (`AFTER`); for a read whose
 * parts it follows by cursor, the cursor it holds them at (`CURSOR`), past
 * which those parts are answered rather than whole; and, for a read that
 * answers deltas, the sync id it holds every row at (`SYNC`), past which it
 * is answered what moved alone, held until something does.
 */
export const LIVE_POLL = {
  QUERY: "poll",
  ON: "true",
  AFTER: "after",
  CURSOR: "cursor",
  SYNC: "sync",
} as const;

/**
 * The query every live read names the account it was started for under, as
 * Neon's guide says a page sends its user ("When the session changes"): the
 * service answers a session of anyone else, or a read naming none, as
 * signed out.
 */
export const LIVE_USER_QUERY = "userId";

/** A live read the service refused as signed out: no session, or one of another account than the read names. */
export const LIVE_SIGNED_OUT = { failure: "signed-out" } as const;

const LIVE_SOCKET_PATH = "/api/live/socket";

/**
 * The one WebSocket a signed-in host sends its live polls over, in place of
 * a held request per read. It is no subscription: an ask is one poll, named
 * by the path and query (`READ_PREFIX` onward) its HTTP poll would GET, and
 * its answer is that poll's status and body as the HTTP poll would answer
 * them, so a read's key, `after`, and `cursor` travel as they always have
 * and a new socket resumes nothing. The socket is opened under the account's
 * credential, the desktop's bearer or the page's cookie
 * (`@repo/service/http/relay-upgrade`), which every ask is answered under,
 * whatever its frame says.
 *
 * Every frame is a JSON text frame. An ask refuses a key it did not name,
 * and the service closes the socket on one that does not read; an answer is
 * read dropping any key a newer service added.
 */
export const LIVE_SOCKET = {
  PATH: LIVE_SOCKET_PATH,
  /** Where the path of every read an ask names begins: the socket's own directory, which every live read's path shares (`service-paths.ts`). */
  READ_PREFIX: LIVE_SOCKET_PATH.slice(0, LIVE_SOCKET_PATH.lastIndexOf("/") + 1),
} as const;

/** The most characters an ask's path may carry: a read's ids, account, digest, and cursor are well under it. */
const LIVE_SOCKET_PATH_MAX_CHARS = 8 * 1024;

/** Any origin, for reading a path alone: an ask's origin is the service's own, never its frame's. */
const PATH_BASE = "http://live.invalid";

/**
 * Whether a path names a live read: under `READ_PREFIX` as written, which
 * leaves it no scheme or host of its own, and once its dot segments are
 * resolved, encoded ones among them.
 */
function isLiveReadPath(path: string): boolean {
  if (!path.startsWith(LIVE_SOCKET.READ_PREFIX) || !URL.canParse(path, PATH_BASE)) return false;
  return new URL(path, PATH_BASE).pathname.startsWith(LIVE_SOCKET.READ_PREFIX);
}

/** Which ask an answer is to: the host's own count, unique among its socket's open asks. */
const liveSocketAskIdSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

/** One poll a host asks over its socket: the path and query its HTTP poll would GET. */
export const liveSocketAskSchema = EffectSchema.Struct({
  id: liveSocketAskIdSchema,
  path: EffectSchema.String.check(
    EffectSchema.isMaxLength(LIVE_SOCKET_PATH_MAX_CHARS),
    EffectSchema.makeFilter(isLiveReadPath),
  ),
});

export type LiveSocketAsk = typeof liveSocketAskSchema.Type;

/** One poll answered over the socket: the status and body its HTTP poll would have answered, the body as the text it was. */
export const liveSocketAnswerSchema = EffectSchema.Struct({
  id: liveSocketAskIdSchema,
  status: EffectSchema.Int,
  body: EffectSchema.String,
});

export type LiveSocketAnswer = typeof liveSocketAnswerSchema.Type;

/**
 * Where a polled read's rows stand as one value: each part's digest, in
 * the parts' name order. A reader sends the one it last saw as `after`, and
 * the service holds the poll until the rows move past it. Note that a part
 * answered past a cursor (`cursor`) is left out, because its reader holds it
 * at the cursor instead, and its rows are only what moved past it.
 */
export function liveDigestOf(
  queries: Readonly<Record<string, { readonly digest?: string; readonly cursor?: unknown }>>,
): string | undefined {
  const parts = Object.keys(queries)
    .filter((part) => queries[part]?.cursor === undefined)
    .toSorted();
  const digests = parts.map((part) => queries[part]?.digest);
  return digests.every((digest) => digest !== undefined) ? digests.join(",") : undefined;
}

/**
 * Where a part a reader follows by cursor stands: the cursor its rows were
 * read past, absent where they are its rows whole, as for a reader whose
 * cursor a rewind left behind; and the cursor to read past next, where
 * every row read stands at least.
 */
const liveCursorAnswerSchema = EffectSchema.Struct({
  past: EffectSchema.optionalKey(EffectSchema.String),
  next: EffectSchema.String,
});

/**
 * Where a part a reader follows by sync id stands: the id its rows were read
 * past, absent where they are its rows whole, as for a reader too far
 * behind; and the id to read past next, below which every write has ended
 * and shows in the rows a reader holds once it joins these on.
 */
const liveSyncAnswerSchema = EffectSchema.Struct({
  past: EffectSchema.optionalKey(EffectSchema.String),
  next: EffectSchema.String,
});

/** One sealed statement as the service answers it, which Realtime's client subscribes to and renews with. */
export const sealedLiveQuerySchema = EffectSchema.Struct({
  capability: EffectSchema.String,
  queryFingerprint: EffectSchema.String,
  /** When the seal expires, in epoch milliseconds; the reader renews it before. */
  expiresAt: countedNumber,
  /**
   * The statement's rows as they stand, answered only at `LIVE_POLL_URL`.
   * They travel as JSON text, since a row has no wire form until its
   * reader decodes it.
   */
  rows: EffectSchema.optionalKey(
    EffectSchema.fromJsonString(EffectSchema.Array(EffectSchema.Unknown)),
  ),
  /**
   * Where the statement's rows stand, answered only at `LIVE_POLL_URL`: a
   * poll held past `after` that ends with nothing moved carries the digest
   * and no rows.
   */
  digest: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The ids of the transactions whose writes woke the held poll this
   * answers, on every part it answers, since each was read after them: none
   * where nothing woke it but its clock. A writer confirms a write once the
   * read that shows it carries the write's txid.
   */
  txids: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  /**
   * The snapshot the statement's rows, or its digest, were read at, as
   * Postgres spells one (`xmin:xmax:xip,…`), answered only at
   * `LIVE_POLL_URL`: a writer confirms a write once every part of an answer
   * was read at a snapshot its transaction is visible in, whatever woke the
   * poll. Absent from a service before it.
   */
  snapshot: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * Where a part the reader follows by cursor (`LIVE_POLL.CURSOR`) stands,
   * answered only to a reader that named one: its rows are then only those
   * written or amended past `past`, which the reader joins onto the rows it
   * holds, or its rows whole where `past` is absent.
   */
  cursor: EffectSchema.optionalKey(liveCursorAnswerSchema),
  /**
   * Where the part stands for a reader that named a sync id
   * (`LIVE_POLL.SYNC`), answered only to such a reader: its rows are then
   * only those past `past` moved, which replace the reader's rows of the
   * same id, or its rows whole where `past` is absent.
   */
  sync: EffectSchema.optionalKey(liveSyncAnswerSchema),
  /** The ids of the part's rows that moved past `sync.past` and stand no longer for the reader, which it drops; answered only beside `sync.past`. */
  gone: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
});

export type SealedLiveQueryWire = typeof sealedLiveQuerySchema.Type;

/** The query a transcript read is asked at once by rather than held, and the one word it takes. */
export const TRANSCRIPT_NOW_QUERY = { WAIT: "wait", NONE: "none" } as const;

/**
 * A page of the transcript read at once rather than held, for a reader
 * following its live statements: the page the held read answers, and
 * whether that read would have held on it for more, which is when the
 * reader waits for the statements to move, or for the clock to reach an
 * edge the rows cannot say, before it reads again.
 */
export const transcriptNowAnswerSchema = EffectSchema.Struct({
  ...agentMessagesAnswerSchema.fields,
  holds: EffectSchema.Boolean,
  /**
   * Where it would hold, how many milliseconds from now the clock alone may
   * end that, which no row changing says: an agent passing the grace its
   * first turn had to land in, or the window of a title it waits on
   * closing. The reader reads again then. Absent where only a row may, and
   * from a service older than it.
   */
  wakeIn: EffectSchema.optionalKey(countedNumber),
});

export type TranscriptNowAnswer = typeof transcriptNowAnswerSchema.Type;

/**
 * Each read moved onto the host's app state, by the one name that
 * identifies it from the service's live read (`bindLiveRead`) to the
 * panel's live reads' queries (`live-reads.ts`).
 */
export const LIVE_READ = {
  /** The account's preferences row, its default agent, chapters model, and Slack notifications as stored, by the account: the service's `accountPreferences` query, held for the signed-in session into the sync engine's pool, every write to one drawn over it the moment it is asked. */
  ACCOUNT_PREFERENCES: "accountPreferences",
  /** The run of an automation that started one agent, by the agent: the service's `agentOriginLive` query, held for the windows that show the agent's page and a few they showed lately. */
  AGENT_ORIGINS: "agentOrigins",
  /** Every inbox item the account reaches. */
  INBOX_ITEMS: "inboxItems",
  /** One plan's inbox, or one agent's, by its holder: the service's `taskInbox` or `agentInbox` query, by the holder's kind, held for the windows that chose it and a few they chose lately. */
  HOLDER_INBOX: "holderInbox",
  /** The skills the account sees in one workspace, the workspace's and its own, by the workspace: the service's `installedSkills` query, held for the windows that draw Settings › Skills and a few they drew lately. */
  INSTALLED_SKILLS: "installedSkills",
  /** Where each of the account's integrations stands, by the account: the service's `integrationStatuses` read, with GitHub's standing fetched beside it, held while a window draws an integration. */
  INTEGRATIONS: "integrationStatuses",
  /** The tools one integration server offers the account's agents, by the server: fetched by the host while a window holds it. */
  INTEGRATION_TOOLS: "integrationTools",
  /** What GitHub holds of the pull request or issue a link names, by the workspace it is read through and then the link's own address: fetched by the host while a chip holds it. */
  LINK_STANDINGS: "linkStandings",
  /** One workspace's memories, by the workspace: the service's `workspaceMemories` query, held for the windows that draw Settings › Memory and a few they drew lately. */
  MEMORIES: "workspaceMemories",
  /** The models a coding agent may run on as the account is offered them, and its devices a task may run on, by the account: fetched by the host while a window holds it, and asked again as a window comes forward, and as the account's provider keys move. */
  MODELS: "models",
  /** One task's pages, or one agent's on no task, by what they stand on: the service's `taskPagesLive` or `agentPagesLive` query, by its kind, held for the windows that chose it and a few they chose lately. */
  PAGES: "pages",
  /** The account's own provider keys and plans, as hints and statuses and never a key, by the account: fetched by the host while a window holds it, and laid from each write's own answer. */
  PROVIDER_KEYS: "providerKeys",
  /** One agent's pull request as its Pull request tab draws it, by the agent and then the pull request's number, or the agent's own: fetched by the host while a window holds it. */
  PULL_REQUEST: "pullRequest",
  /** The account's own GitHub token as its login, hint, and status, never the token, by the account: fetched by the host while a window holds it, and laid from each save's and removal's own answer. */
  GITHUB_TOKEN: "githubToken",
  /** One agent's pull request's newest chapters, by the agent and the pull request's number: the service's `pullRequestChaptersLive` query. */
  PULL_REQUEST_CHAPTERS: "pullRequestChapters",
  /** The checks on one agent's pull request's head, keyed and fetched as `PULL_REQUEST`. */
  PULL_REQUEST_CHECKS: "pullRequestChecks",
  /** One agent's pull request's conversation and where its reviewers stand, keyed and fetched as `PULL_REQUEST`. */
  PULL_REQUEST_CONVERSATION: "pullRequestConversation",
  /** What one agent published, its pull request as the service last read it from GitHub, keyed and fetched as `PULL_REQUEST`. */
  PULL_REQUEST_PUBLISHED: "pullRequestPublished",
  /** Which of one agent's pull request's files the member marked viewed on GitHub, read on their own GitHub sign-in, keyed and fetched as `PULL_REQUEST`. */
  PULL_REQUEST_VIEWED: "pullRequestViewed",
  /** What the reviewer and label pickers of one agent's Pull request tab offer, its repository's labels, assignable users, and teams, keyed and fetched as `PULL_REQUEST`. */
  REVIEW_OPTIONS: "reviewOptions",
  /** One task's comments, its description's own threads or one page's: the service's `taskCommentsLive` query. */
  DESCRIPTION_COMMENTS: "taskComments",
  /** One task's description history, by the task: the service's `taskHistoryLive` query for its newest page, then the older pages its version history read past it, held for the windows that show it and a few they showed lately. */
  HISTORY: "taskHistory",
  /** One task's cloud Browser tabs, every one of its agents', or one agent's, by what they are listed for: the service's `taskBrowserTabsLive` or `agentBrowserTabsLive` query, by its kind, held for the windows whose side panel lists them and a few they listed lately. */
  BROWSER_TABS: "browserTabs",
  /** The repositories the account reaches in one workspace, or in every one where a list names none, by the workspace: fetched by the host while a window holds it. */
  REPOSITORY_LISTS: "repositoryLists",
  /** When each of the account's own devices last beat, by the account: fetched by the host while a window holds it, and again every `MAC_PRESENCE.POLL_MS`. */
  DEVICE_PRESENCE: "devicePresence",
  /** The account's hosts, by the account: the service's `hostsRead`, declared as `HOSTS_READ`, held while Settings › Hosts draws them and a while after. */
  HOSTS: "hosts",
  /** One workspace's pending invitations, by the workspace: the service's `workspaceInvitations` query, held for an owner's or an admin's windows that draw them and a few they drew lately. */
  WORKSPACE_INVITATIONS: "workspaceInvitations",
  /** Which machine This Mac is and the device its host's record names, by the account: read by the host as it starts and every few seconds after, held for the session, and never in a browser tab, which has no This Mac. */
  THIS_MAC_HOST: "thisMacHost",
  /** One agent's transcript, or one of its workers', by the agent and then the worker's call or the agent's own: the service's `agentTranscriptRead` with the pages read beside it, held for the windows whose tab shows it and a few they showed lately, which stop following while no window holds them. */
  TRANSCRIPT: "transcripts",
  /** One workspace's members and who its work names but left, by the workspace: the service's `workspaceMembers` query, held for the windows that draw its people and a few they drew lately. */
  WORKSPACE_MEMBERS: "workspaceMembers",
  /** One workspace's Sentry installations and Slack bot, by the workspace: the service's `workspaceIntegrations` query, held for the windows that draw Settings › Workspace's integrations or an automation's editor, and a few they drew lately. */
  WORKSPACE_INTEGRATIONS: "workspaceIntegrations",
  /** The channels of one workspace's Slack team, by the workspace: Slack's own list, fetched by the host while an owner's or an admin's window holds it. */
  SLACK_CHANNELS: "slackChannels",
  /** The repositories members added to one workspace on their own GitHub tokens, those its App reaches left out, by the workspace: fetched by the host while a window holds it, and laid from each addition's and removal's own answer. */
  TOKEN_REPOSITORIES: "tokenRepositories",
  /** Each listed workspace's photo as a `data:` URL under the version the workspaces carry, by the workspace: fetched by the host once per version as the version it lists moves, held for the session. */
  WORKSPACE_PHOTOS: "workspacePhotos",
  /** Our own tools one agent is offered, and whether its `run_on_mac` is on, by the agent: fetched by the host while a window holds it. */
  WORKSPACE_TOOLS: "workspaceTools",
  /** The outside MCP clients the account allowed, with the server's address, by the account: fetched by the host while Settings › MCP holds it. */
  MCP_CLIENTS: "mcpClients",
  /** One workspace's automations, by the workspace: the service's `automations` query, held for the windows that draw them and a few they drew lately. */
  AUTOMATIONS: "automations",
  /** Every run of one workspace's automations the account reads, by the workspace: the service's `automationWorkspaceRuns` query, held as the automations are. */
  AUTOMATION_WORKSPACE_RUNS: "automationWorkspaceRuns",
  /** One automation's runs, by the automation: the service's `automationRuns` query, held as the automations are. */
  AUTOMATION_RUNS: "automationRuns",
  /**
   * One task's description, by the task, held for the windows that opened it and a
   * few they opened lately. Note that no live query carries its text: the
   * host follows the task's record (`taskRecordLive`), whose description mark moves
   * with each save, and reads the description again where it moved past the copy held.
   */
  DESCRIPTION_DOCUMENT: "descriptionDocument",
} as const;

export type LiveRead = (typeof LIVE_READ)[keyof typeof LIVE_READ];

/**
 * The account's inbox items as one read follows them (`/api/live/inbox-items`):
 * the query naming the instant the reader holds every item changed since,
 * in epoch milliseconds (`SINCE`); the parts its poll is held on alone
 * (`HELD_ON`), so a reader whose `since` moved with no item moving is held
 * still; and how far back a settled item is carried (`SETTLED_WINDOW_MILLIS`),
 * an open one always.
 */
export const ACCOUNT_INBOX_ITEMS = {
  SINCE: "since",
  HELD_ON: ["stamps"],
  SETTLED_WINDOW_MILLIS: 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Where a polled read's named parts stand as one value (`liveDigestOf` over
 * those parts alone): what a reader of a read held on some of its parts
 * sends as `after`.
 */
export function liveDigestOn(
  queries: Readonly<Record<string, { readonly digest?: string; readonly cursor?: unknown }>>,
  parts: readonly string[],
): string | undefined {
  return liveDigestOf(Object.fromEntries(parts.map((part) => [part, queries[part] ?? {}])));
}
