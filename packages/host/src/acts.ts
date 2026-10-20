import {
  type BrowserPage,
  browserAddressParamsSchema,
  browserPageSchema,
  browserPlaceParamsSchema,
  browserStepParamsSchema,
  browserViewParamsSchema,
} from "@luke/features/browser-acts";
import {
  type CodingAgentChatAnswerView,
  type CodingAgentChatWriteAnswerView,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerView,
  type CodingAgentInboxAttachmentView,
  type CodingAgentInboxMessagedView,
  type CodingAgentInboxReadAllView,
  type CodingAgentInboxReadStateView,
  type CodingAgentMessagesAnswerView,
  codingAgentAgentInboxParamsSchema,
  codingAgentChatAnswerViewSchema,
  codingAgentChatAttachmentParamsSchema,
  codingAgentChatParamsSchema,
  codingAgentChatPostParamsSchema,
  codingAgentChatWriteAnswerViewSchema,
  codingAgentInboxAnsweredViewSchema,
  codingAgentInboxAnswerParamsSchema,
  codingAgentInboxAnswerViewSchema,
  codingAgentInboxAttachmentParamsSchema,
  codingAgentInboxAttachmentViewSchema,
  codingAgentInboxCloseParamsSchema,
  codingAgentInboxMessagedViewSchema,
  codingAgentInboxMessageParamsSchema,
  codingAgentInboxParamsSchema,
  codingAgentInboxReadAllViewSchema,
  codingAgentInboxReadStateParamsSchema,
  codingAgentInboxReadStateViewSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentPictureParamsSchema,
} from "@luke/features/coding-agent-view";
import {
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
} from "@luke/features/feedback";
import { inboxReadAllRequestSchema } from "@luke/features/inbox-wire";
import { linearIssueSummarySchema } from "@luke/features/linear-wire";
import { PLAN_MARKDOWN_MAX_CHARS } from "@luke/features/plan-markdown";
import {
  type CodeLines,
  codeLinesSchema,
  type TasksCommentAnswer,
  type TasksCommentsAnswer,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksIssue,
  type TasksMoveAnswer,
  type TasksPageSourceAnswer,
  type TasksPagesAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPullRequest,
  type TasksRepositoriesAnswer,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetRepositoryAnswer,
  type TasksSkillsAnswer,
  type TasksStartAnswer,
  type TasksTreeAnswer,
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentAnswerSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsAnswerSchema,
  tasksCommentsParamsSchema,
  tasksEditAnswerSchema,
  tasksEditParamsSchema,
  tasksFileAnswerSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
  tasksIssueSchema,
  tasksMessagesParamsSchema,
  tasksMoveAnswerSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPageSourceAnswerSchema,
  tasksPagesAnswerSchema,
  tasksPagesParamsSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
  tasksPullRequestSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesAnswerSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsAnswerSchema,
  tasksRevisionsParamsSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSetRepositoryParamsSchema,
  tasksSkillsAnswerSchema,
  tasksSkillsParamsSchema,
  tasksStartAnswerSchema,
  tasksStartRequestSchema,
  tasksTreeAnswerSchema,
  tasksTreeParamsSchema,
  tasksWriteSectionParamsSchema,
} from "@luke/features/tasks-view";
import { workspaceInvitationSchema } from "@luke/features/workspace-invitation-wire";
import { formerMemberSchema, workspaceMemberSchema } from "@luke/features/workspace-wire";
import type { UpdateSnapshot } from "@luke/settings/update";
import type { MicrophoneRoute, MicrophoneStatus } from "@luke/voice/audio";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type UnparsedWireValue,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  isWireValue,
  type WireGuard,
  type WireGuardValue,
  wireResult,
} from "@luke/wire/wire-guard";
import { Schema as EffectSchema, Result } from "effect";
import { PORT_ACT_KIND, type PortActKind } from "./contract/kinds.js";

/**
 * Every effect a window may ask this build's main process for, named once.
 * There is no second way in: a press and a row's own control both mint one
 * of these kinds and hand it to `app:act`, whose router parses the kind's
 * payload, runs that kind's trust checks, and dispatches. Adding an effect is adding an entry here, its payload schema
 * below, its answer's guard beside it, and its one row in the router — a
 * command with no kind reaches nothing.
 *
 * A kind is what the window asks for, never what the main process does with
 * it: some are carried to the host over the operator client and some are the
 * desktop's own, and which is which is the router's business rather than the
 * vocabulary's.
 */
export const ACT_KIND = {
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
  /**
   * The panel's Tasks tab asking the host: the task list and the active
   * document read as the tab shows, one task made the active one, the open
   * task left, a task started on a repository, and a task renamed, given its
   * repository, pinned or unpinned, archived or brought back, or deleted. The view arrives on the document rather than as
   * an answer. The one write of a task's document from here is the
   * developer's edit of a field, `TASKS_EDIT`, which answers whether it
   * saved, conflicted with what Luke wrote meanwhile, or failed.
   */
  TASKS_REFRESH: "tasks.refresh",
  TASKS_SELECT: "tasks.select",
  TASKS_CLOSE: "tasks.close",
  TASKS_START: "tasks.start",
  TASKS_DELETE: "tasks.delete",
  TASKS_RENAME: "tasks.rename",
  TASKS_PIN: "tasks.pin",
  /** A repository pinned in the sidebar or unpinned, kept on the account; answers whether the service changed the pins. */
  TASKS_PIN_REPOSITORY: "tasks.pinRepository",
  /** One change to the sidebar's sections, kept on the account; answers whether the service took it. */
  TASKS_WRITE_SECTION: "tasks.writeSection",
  TASKS_ARCHIVE: "tasks.archive",
  /** The repository chip's read: the repositories the account reaches through the Luke GitHub App, as the service answers them now. */
  TASKS_REPOSITORIES: "tasks.repositories",
  /** A task given its repository on the service, or none; answers the repository as kept, or why it is unchanged. */
  TASKS_SET_REPOSITORY: "tasks.setRepository",
  /** A task moved on the service to another of the account's workspaces, its owner's alone; answers the workspace it now belongs to, or why it stands where it was. */
  TASKS_MOVE: "tasks.move",
  /** The developer's edit of the open task's document, saved on the service; answers saved, a conflict with the text as it stands now, or why nothing was saved. */
  TASKS_EDIT: "tasks.edit",
  /** A page of GitHub's opened in the browser: a repository, or where the Luke GitHub App is installed. No other address opens through it. */
  GITHUB_OPEN: "github.open",
  /** A web page opened in the default browser: a link a transcript's or an Inbox item's words hold, off GitHub. No address but an http or https one opens through it. */
  WEB_OPEN: "web.open",
  /** The page that connects the account's GitHub, asked of the service and opened in the browser; the connection arrives on the document once the panel comes forward again. */
  GITHUB_CONNECT: "github.connect",
  /** The account's GitHub disconnected on the service under the Mac's session; the connection arrives on the document at once. */
  GITHUB_DISCONNECT: "github.disconnect",
  /** The Tasks tab's microphone button: a call about the task the panel has open, opened, or its microphone toggled. */
  TASKS_TALK: "tasks.talk",
  /** The open task's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  TASKS_BOARD_SAVE: "tasks.boardSave",
  /** The Work tab scrolled back to its oldest turn: the open task's page of work before it, read from the service; the view arrives on the document. */
  TASKS_WORK_EARLIER: "tasks.workEarlier",
  /** The Call tab scrolled back to its oldest turn: the open task's page of conversation before it, read from the service; the view arrives on the document. */
  TASKS_CONVERSATION_EARLIER: "tasks.conversationEarlier",
  /** One page of a task's conversation, or a brain worker's under the call that started it, held open by the service while it runs; answered to the tab, never on the document. */
  TASKS_MESSAGES: "tasks.messages",
  /** A File tab's window of a file of the open task's repository, read from GitHub through the service and coloured by main; answered to the tab, never on the document. */
  TASKS_FILE: "tasks.file",
  /** A File tab's tree listing one folder of the open task's repository, read from GitHub through the service; answered to the tree, never on the document. */
  TASKS_TREE: "tasks.tree",
  /** The skills a developer may choose of a task's repository, read from GitHub through the service; answered to the asker, never on the document. */
  TASKS_SKILLS: "tasks.skills",
  /** One pull request of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_PULL_REQUEST: "tasks.pullRequest",
  /** One issue of a repository a workspace's installation reaches, by its number, read from GitHub through the service for a link to it to draw its title and state; null where there is none to draw; answered to the asker, never on the document. */
  TASKS_ISSUE: "tasks.issue",
  /** A fenced block of a transcript's markdown, coloured by main as the File tab's lines are: the code and its fence's language go, the lines come back; answered to the block, never on the document. */
  TASKS_COLOUR_CODE: "tasks.colourCode",
  /** A page of the open plan's history for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISIONS: "tasks.revisions",
  /** A revision of the open plan beside the one before it for its version history, read from the service; answered to the view, never on the document. */
  TASKS_REVISION: "tasks.revision",
  /** A revision of a plan restored as its content on the service; answers whether it was, and the document arrives as the service answered it. */
  TASKS_RESTORE: "tasks.restore",
  /** A page tab's source of one version of one of the plan's pages, read from the service as its frame's is and coloured by main as HTML; answered to the tab, never on the document. */
  TASKS_PAGE_SOURCE: "tasks.pageSource",
  /** One plan's pages, each by its newest version, read from the service for the Inbox's panel beside an item of that plan; answered to the view, never on the document. */
  TASKS_PAGES: "tasks.pages",
  /** One picture of the open plan as its bytes in base64, read from the service for the document drawing it; answered to the view, never on the document. */
  TASKS_PICTURE_READ: "tasks.pictureRead",
  /** A picture pasted, dropped, or chosen into the open plan's editor, kept on the service; answered with the id the text then names it by. */
  TASKS_PICTURE_KEEP: "tasks.pictureKeep",
  /**
   * The open plan's comment threads: read past a cursor (held open by the
   * service while nothing changed), one started on words of the plan, and
   * one thing done to one thread. The window holds what it draws.
   */
  TASKS_COMMENTS: "tasks.comments",
  TASKS_COMMENT_START: "tasks.commentStart",
  TASKS_COMMENT_ACT: "tasks.commentAct",
  /**
   * The task's inbox of what its coding agents need of the developer: read
   * past a cursor (held open by the service while nothing changed), and one
   * item answered against the revision the panel drew, under the panel's own
   * key. The window holds what it draws; nothing here does.
   */
  CODING_AGENTS_INBOX: "codingAgents.inbox",
  CODING_AGENTS_AGENT_INBOX: "codingAgents.agentInbox",
  CODING_AGENTS_INBOX_ANSWER: "codingAgents.inboxAnswer",
  /** One open item closed without an answer against the revision the panel drew, under the panel's own key. */
  CODING_AGENTS_INBOX_CLOSE: "codingAgents.inboxClose",
  /** A message on one item's thread, open or settled, under the panel's own key; it never answers the item. */
  CODING_AGENTS_INBOX_MESSAGE: "codingAgents.inboxMessage",
  /** One item marked read or unread for the account; it changes neither what the item asks nor whether it waits. */
  CODING_AGENTS_INBOX_READ_STATE: "codingAgents.inboxReadState",
  /** Every item of the account's Inbox marked read, in one workspace or in all; the dots alone. */
  CODING_AGENTS_INBOX_READ_ALL: "codingAgents.inboxReadAll",
  /** One image of an inbox item, fetched by the host under the account, so the window holds no bearer and no address. */
  CODING_AGENTS_INBOX_ATTACHMENT: "codingAgents.inboxAttachment",
  CODING_AGENTS_PICTURE: "codingAgents.picture",
  /**
   * A Browser tab's view, which main owns over the panel that asked
   * (`browser-views.ts`): opened on an address and answered how its page
   * stands, sent to another, stepped back, forward, reloaded or stopped,
   * placed over the tab's body or put out of sight, caught as a still while
   * something covers it, and closed with its tab. How the page goes on to
   * stand arrives on the panel's `onBrowserState`. Taken from a panel alone,
   * and only while the account has the Browser tab experiment on.
   */
  BROWSER_OPEN: "browser.open",
  BROWSER_NAVIGATE: "browser.navigate",
  BROWSER_STEP: "browser.step",
  BROWSER_PLACE: "browser.place",
  BROWSER_CAPTURE: "browser.capture",
  BROWSER_CLOSE: "browser.close",
  /**
   * The workspace's chat: read past a cursor (held open by the service
   * while nothing moved), and written to as the account's own member, a
   * post, an answer to an ask, a resolve, or how far it has read. The
   * window holds what it draws; nothing here does.
   */
  CODING_AGENTS_CHAT: "codingAgents.chat",
  CODING_AGENTS_CHAT_POST: "codingAgents.chatPost",
  CODING_AGENTS_CHAT_ATTACHMENT: "codingAgents.chatAttachment",
  MICROPHONE_REQUEST: "microphone.request",
  /**
   * Where the developer's voice would be captured from, read afresh: the act
   * probes the native watcher rather than answering the document, because the
   * route decides which device a press opens and macOS moves it between
   * presses.
   */
  MICROPHONE_ROUTE: "microphone.route",
  NOTIFICATIONS_OPEN_SETTINGS: "notifications.openSettings",
  /** A notification posted right away, whatever window is in front, to learn whether macOS shows Luke's. */
  NOTIFICATIONS_TEST: "notifications.test",
  /** A new message to the people who make Luke, in the system's mail app, to the address main holds. */
  CONTACT_EMAIL: "contact.email",
  WINDOW_FOCUS_PANEL: "window.focusPanel",
  WINDOW_COPY_TEXT: "window.copyText",
  WINDOW_SAVE_FILE: "window.saveFile",
  FEEDBACK_SEND: "feedback.send",
  /**
   * The kinds the window's act port answers rather than `app:act`
   * (`contract/kinds.ts`), spelled here beside the rest so a caller names
   * every act the same way.
   */
  ...PORT_ACT_KIND,
} as const;

/** A kind `app:act` carries: every kind but the ones the act port answers. */
export type ActKind = Exclude<(typeof ACT_KIND)[keyof typeof ACT_KIND], PortActKind>;

/**
 * One act payload's parser. The `s` combinators from `@luke/wire` satisfy
 * it, and every structural payload below is declared as one. It is the
 * reading alone rather than the whole `Schema` because no model is ever
 * offered an act: a JSON Schema node written here would be a second statement
 * of a rule the parser already holds, free to drift from it.
 */
interface ActSchema<Value> {
  read(value: UnparsedWireValue): SchemaRead<Value>;
}

/** One kind's whole declaration: what its payload takes, what its answer is, and what its refusal says. */
interface ActDeclaration<Payload, Result> {
  readonly payload: ActSchema<Payload>;
  readonly result: WireGuard<Result>;
  readonly refusal: string;
}

function malformed(path: SchemaPath = []): SchemaRead<never> {
  return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path };
}

/**
 * A kind that carries nothing. The schema admits absence alone, so a payload
 * sent to a kind that takes none is refused at the boundary rather than
 * silently dropped.
 */
const noPayload: ActSchema<undefined> = {
  read: (value) => (value === undefined ? { ok: true, value: undefined } : malformed()),
};

/**
 * A whole payload whose shape its own domain already parses, where restating
 * it as a field table here would be a second statement of the same rule free
 * to drift from the parser that admits the value.
 */
function guarded<Value>(admits: (value: UnparsedWireValue) => boolean): ActSchema<Value> {
  return {
    read: (value) =>
      // SAFETY: the domain parser above is what this payload's type is defined by.
      admits(value) ? { ok: true, value: value as Value } : malformed(),
  };
}

/**
 * A payload named field by field, each field admitted by the parser its own
 * domain owns. What `record` is for a payload whose fields are texts and
 * counts, for the payloads whose fields are whole domain values instead.
 */
function fields<Value>(guards: {
  readonly [key: string]: (value: UnparsedWireValue) => boolean;
}): ActSchema<Value> {
  const named = Object.keys(guards);
  return guarded<Value>((value) => {
    if (!isRecord(value)) return false;
    for (const key of Object.keys(value)) if (!named.includes(key)) return false;
    return named.every((key) => guards[key]?.(value[key]) === true);
  });
}

/** An `ActSchema` read through an Effect `Schema`, so `.read()` answers the same word and path `readEither` does. */
function actSchema<Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>): ActSchema<Value> {
  const read = readEither(schema);
  return {
    read: (value) =>
      Result.match(read(value), {
        onFailure: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onSuccess: (value) => ({ ok: true, value }),
      }),
  };
}

/**
 * What a workspace act whose role does not allow it is refused with, in place
 * of its kind's own sentence: a member renaming the workspace, setting its
 * photo, or removing someone, or an owner removed or leaving.
 */
export const WORKSPACE_NOT_PERMITTED_REFUSAL =
  "Your role in this workspace does not allow that." as const;

const _workspaceMembersSchema = EffectSchema.Array(workspaceMemberSchema);
const _formerMembersSchema = EffectSchema.Array(formerMemberSchema);

const _linearIssuesSchema = EffectSchema.Array(linearIssueSummarySchema);

const _workspaceInvitationsSchema = EffectSchema.Array(workspaceInvitationSchema);

/** What a GitHub disconnect is refused with where GitHub is the account's only way to sign in. */
export const GITHUB_LAST_SIGN_IN_REFUSAL =
  "GitHub is the only way you sign in to this Luke account, so it cannot be disconnected." as const;

/** What a Linear read is refused with where the workspace's Linear could not be read. */
export const LINEAR_UNAVAILABLE_REFUSAL =
  "Linear is not connected to this workspace, or it stopped answering. An owner or admin can connect it." as const;

/** What an invitation is refused with where the address is already in the workspace or already invited. */
export const ALREADY_INVITED_REFUSAL =
  "That address is already in this workspace or invited." as const;

/**
 * Whether a value reads under a schema at all, for a result the payload's own
 * row only checks admits. Every schema read here is a Gateway answer, so a key
 * a newer host added is dropped rather than refused: which keys a read tolerates
 * is the read's to say now that a declaration carries no parse options of its own.
 */
const isReadable =
  <Value, Encoded>(schema: EffectSchema.Codec<Value, Encoded>) =>
  (value: UnparsedWireValue): boolean =>
    Result.isSuccess(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));

/** A payload's field table as a struct, refusing a key it did not name. */
function record<Fields extends EffectSchema.Struct.Fields>(
  fields: Fields,
): ActSchema<EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>> {
  type Value = EffectSchema.Schema.Type<EffectSchema.Struct<Fields>>;
  const struct = EffectSchema.Struct(fields);
  return actSchema(EffectSchema.make<EffectSchema.Codec<Value, UnparsedWireValue>>(struct.ast));
}

/** An identifier's ends, admitted as written rather than trimmed, and refused when it carries nothing. */
function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/** An identifier's ends, admitted as written and admitting nothing at all. */
function exactTextAllowingEmpty(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(EffectSchema.isMaxLength(max));
}

/**
 * An identifier that has to match the one it names elsewhere — a task or an
 * account — so its ends are admitted as written rather than trimmed into a
 * value the host would not hold.
 */
const exactId = exactText(512);

/**
 * The longest fenced block a transcript asks main to colour. Note that a
 * longer one is drawn plain rather than cut, because colouring costs main
 * a pass over every character and a block that long is a log, not a snippet.
 */
export const COLOURED_CODE_MAX_CHARS = 20_000;

/**
 * The longest text a File tab copies or saves of its file: the service
 * reads a file of a megabyte at most, and its text, a character to a byte
 * at least, is no longer.
 */
const FILE_TEXT_MAX_CHARS = 1024 * 1024;

/** A file's name as a save offers it: one name, no folder, so the dialog alone says where it goes. */
const savedFileName = exactText(255).check(EffectSchema.isPattern(/^[^/\\]+$/u));

/** The longest language name a fence may give for its block to be coloured. */
export const FENCE_LANGUAGE_MAX_CHARS = 32;

/** The one host the browser is sent to from a task: a repository's page, or the App's installation page. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** An address on GitHub, and nowhere else: what a repository link, the installation link, or Luke's own issues open. */
const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

/** Whether `github.open` takes an address, so a link drawn as a press is one the act will open. */
export const isGitHubAddress: (address: string) => boolean = EffectSchema.is(githubAddress);

/** An absolute web address's scheme, which is all `web.open` lets through to the browser. */
const WEB_ADDRESS = /^https?:\/\//iu;

/**
 * An address on the web, wherever it is: an absolute http or https address
 * the URL parser reads. Note that the scheme is the whole of the check,
 * because the browser is the one thing it opens in, and a `file:`,
 * `javascript:`, or another app's scheme would hand the address to
 * something else.
 */
const webAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(WEB_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

/** Whether `web.open` takes an address, so a link drawn as a press is one the act will open. */
export const isWebAddress: (address: string) => boolean = EffectSchema.is(webAddress);

const answersNothing = wireResult<void>();

/**
 * A press: a kind that carries nothing and answers nothing, which is what
 * most of them are. The sentence is the only thing such a row has to say.
 */
const press = (refusal: string): ActDeclaration<undefined, void> => ({
  payload: noPayload,
  result: answersNothing,
  refusal,
});

/** Connect GitHub and Disconnect, which open one page of the service's and are refused alike. */
const GITHUB_PAGE_PRESS = press("Could not open GitHub's connection page on this system.");

/**
 * Every act, one row per kind, and everything this build says about a kind in
 * that one row: the parser its payload has to pass, the guard its answer has
 * to pass, and the sentence its refusal carries. One row rather than three
 * tables, so a kind is read and added in one place and a kind missing any of
 * the three does not build.
 *
 * The payload's parser is the whole of what the boundary admits: it runs in
 * the main process before the act is dispatched and again in the router, so a
 * caller inside the main process cannot reach a row with a payload the window
 * could not have sent. The answer's guard is checked where the answer is
 * read — in the router before the outcome is minted, and in the window that
 * asked before its caller sees a value — and a kind whose answer has a domain
 * reader of its own names it, while the rest carry the structured-clone shape
 * alone, which is all a `void` or a snapshot the host composed needs. The
 * refusal is fixed by the build, so what reaches the window is something its
 * row can draw rather than whatever message an exception happened to carry.
 */
export const ACT = {
  [ACT_KIND.UPDATE_CHECK]: {
    payload: noPayload,
    result: wireResult<UpdateSnapshot>(),
    refusal: "Could not check for updates on this system.",
  },
  [ACT_KIND.UPDATE_INSTALL]: press("Could not install that update on this system."),
  [ACT_KIND.UPDATE_OPEN_RELEASE]: press("Could not open the releases page."),
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: press("Could not open the changelog."),
  [ACT_KIND.TASKS_REFRESH]: press("Could not read your tasks on this system."),
  [ACT_KIND.TASKS_SELECT]: {
    payload: record({ taskId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not open that task on this system.",
  },
  [ACT_KIND.TASKS_CLOSE]: press("Could not leave that task on this system."),
  [ACT_KIND.TASKS_START]: {
    payload: actSchema(tasksStartRequestSchema),
    result: wireResult<TasksStartAnswer>(isReadable(tasksStartAnswerSchema)),
    refusal: "Could not start that task on this system.",
  },
  [ACT_KIND.TASKS_DELETE]: {
    payload: record({ taskId: exactId }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not delete that task on this system.",
  },
  [ACT_KIND.TASKS_RENAME]: {
    payload: actSchema(tasksRenameParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not rename that task on this system.",
  },
  [ACT_KIND.TASKS_PIN]: {
    payload: actSchema(tasksPinParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not pin that task on this system.",
  },
  [ACT_KIND.TASKS_PIN_REPOSITORY]: {
    payload: actSchema(tasksPinRepositoryParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not pin that repository on this system.",
  },
  [ACT_KIND.TASKS_WRITE_SECTION]: {
    payload: actSchema(tasksWriteSectionParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not change that section on this system.",
  },
  [ACT_KIND.TASKS_ARCHIVE]: {
    payload: actSchema(tasksArchiveParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not archive that task on this system.",
  },
  [ACT_KIND.TASKS_REPOSITORIES]: {
    payload: actSchema(tasksRepositoriesParamsSchema),
    result: wireResult<TasksRepositoriesAnswer>(isReadable(tasksRepositoriesAnswerSchema)),
    refusal: "Could not read your GitHub repositories on this system.",
  },
  [ACT_KIND.TASKS_SET_REPOSITORY]: {
    payload: actSchema(tasksSetRepositoryParamsSchema),
    result: wireResult<TasksSetRepositoryAnswer>(isReadable(tasksSetRepositoryAnswerSchema)),
    refusal: "Could not change that task's repository on this system.",
  },
  [ACT_KIND.TASKS_MOVE]: {
    payload: actSchema(tasksMoveParamsSchema),
    result: wireResult<TasksMoveAnswer>(isReadable(tasksMoveAnswerSchema)),
    refusal: "Could not move that task on this system.",
  },
  [ACT_KIND.TASKS_EDIT]: {
    payload: actSchema(tasksEditParamsSchema),
    result: wireResult<TasksEditAnswer>(isReadable(tasksEditAnswerSchema)),
    refusal: "Could not save that edit on this system.",
  },
  [ACT_KIND.GITHUB_OPEN]: {
    payload: record({ url: githubAddress }),
    result: answersNothing,
    refusal: "Could not open GitHub on this system.",
  },
  [ACT_KIND.WEB_OPEN]: {
    payload: record({ url: webAddress }),
    result: answersNothing,
    refusal: "Could not open that link on this system.",
  },
  [ACT_KIND.GITHUB_CONNECT]: GITHUB_PAGE_PRESS,
  [ACT_KIND.GITHUB_DISCONNECT]: press("Could not disconnect GitHub on this system."),
  [ACT_KIND.TASKS_TALK]: press("Could not talk about that task on this system."),
  [ACT_KIND.TASKS_BOARD_SAVE]: {
    payload: actSchema(tasksBoardSaveParamsSchema),
    result: answersNothing,
    refusal: "Could not save the board on this system.",
  },
  [ACT_KIND.TASKS_FILE]: {
    payload: actSchema(tasksFileParamsSchema),
    result: wireResult<TasksFileAnswer>(isReadable(tasksFileAnswerSchema)),
    refusal: "Could not read that file on this system.",
  },
  [ACT_KIND.TASKS_TREE]: {
    payload: actSchema(tasksTreeParamsSchema),
    result: wireResult<TasksTreeAnswer>(isReadable(tasksTreeAnswerSchema)),
    refusal: "Could not list that folder on this system.",
  },
  [ACT_KIND.TASKS_SKILLS]: {
    payload: actSchema(tasksSkillsParamsSchema),
    result: wireResult<TasksSkillsAnswer>(isReadable(tasksSkillsAnswerSchema)),
    refusal: "Could not read this repository's skills on this system.",
  },
  [ACT_KIND.TASKS_PULL_REQUEST]: {
    payload: actSchema(tasksPullRequestParamsSchema),
    result: wireResult<TasksPullRequest>(isReadable(tasksPullRequestSchema)),
    refusal: "Could not read that pull request on this system.",
  },
  [ACT_KIND.TASKS_ISSUE]: {
    payload: actSchema(tasksIssueParamsSchema),
    result: wireResult<TasksIssue>(isReadable(tasksIssueSchema)),
    refusal: "Could not read that issue on this system.",
  },
  [ACT_KIND.TASKS_COLOUR_CODE]: {
    payload: record({
      language: exactText(FENCE_LANGUAGE_MAX_CHARS),
      code: exactText(COLOURED_CODE_MAX_CHARS),
    }),
    result: wireResult<CodeLines>(isReadable(codeLinesSchema)),
    refusal: "Could not colour that code on this system.",
  },
  [ACT_KIND.TASKS_REVISIONS]: {
    payload: actSchema(tasksRevisionsParamsSchema),
    result: wireResult<TasksRevisionsAnswer>(isReadable(tasksRevisionsAnswerSchema)),
    refusal: "Could not read that plan's history on this system.",
  },
  [ACT_KIND.TASKS_REVISION]: {
    payload: actSchema(tasksRevisionParamsSchema),
    result: wireResult<TasksRevisionAnswer>(isReadable(tasksRevisionAnswerSchema)),
    refusal: "Could not read that version on this system.",
  },
  [ACT_KIND.TASKS_RESTORE]: {
    payload: actSchema(tasksRevisionParamsSchema),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not restore that version on this system.",
  },
  [ACT_KIND.TASKS_PICTURE_READ]: {
    payload: actSchema(tasksPictureParamsSchema),
    result: wireResult<TasksPictureAnswer>(isReadable(tasksPictureAnswerSchema)),
    refusal: "Could not read that picture on this system.",
  },
  [ACT_KIND.TASKS_COMMENTS]: {
    payload: actSchema(tasksCommentsParamsSchema),
    result: wireResult<TasksCommentsAnswer>(isReadable(tasksCommentsAnswerSchema)),
    refusal: "Could not read the task's comments on this system.",
  },
  [ACT_KIND.TASKS_COMMENT_START]: {
    payload: actSchema(tasksCommentStartParamsSchema),
    result: wireResult<TasksCommentAnswer>(isReadable(tasksCommentAnswerSchema)),
    refusal: "Could not comment on the task on this system.",
  },
  [ACT_KIND.TASKS_COMMENT_ACT]: {
    payload: actSchema(tasksCommentActParamsSchema),
    result: wireResult<TasksCommentAnswer>(isReadable(tasksCommentAnswerSchema)),
    refusal: "Could not change the task's comment on this system.",
  },
  [ACT_KIND.TASKS_PICTURE_KEEP]: {
    payload: actSchema(tasksPictureKeepParamsSchema),
    result: wireResult<TasksPictureKeepAnswer>(isReadable(tasksPictureKeepAnswerSchema)),
    refusal: "Could not keep that picture on this system.",
  },
  [ACT_KIND.TASKS_PAGE_SOURCE]: {
    payload: actSchema(tasksPageParamsSchema),
    result: wireResult<TasksPageSourceAnswer>(isReadable(tasksPageSourceAnswerSchema)),
    refusal: "Could not read that page's source on this system.",
  },
  [ACT_KIND.TASKS_PAGES]: {
    payload: actSchema(tasksPagesParamsSchema),
    result: wireResult<TasksPagesAnswer>(isReadable(tasksPagesAnswerSchema)),
    refusal: "Could not read that plan's pages on this system.",
  },
  [ACT_KIND.TASKS_WORK_EARLIER]: press("Could not read that task's earlier work on this system."),
  [ACT_KIND.TASKS_CONVERSATION_EARLIER]: press(
    "Could not read that task's earlier conversation on this system.",
  ),
  [ACT_KIND.TASKS_MESSAGES]: {
    payload: actSchema(tasksMessagesParamsSchema),
    result: wireResult<CodingAgentMessagesAnswerView>(
      isReadable(codingAgentMessagesAnswerViewSchema),
    ),
    refusal: "Could not read that task's conversation on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX]: {
    payload: actSchema(codingAgentInboxParamsSchema),
    result: wireResult<CodingAgentInboxAnswerView>(isReadable(codingAgentInboxAnswerViewSchema)),
    refusal: "Could not read the task's inbox on this system.",
  },
  [ACT_KIND.CODING_AGENTS_AGENT_INBOX]: {
    payload: actSchema(codingAgentAgentInboxParamsSchema),
    result: wireResult<CodingAgentInboxAnswerView>(isReadable(codingAgentInboxAnswerViewSchema)),
    refusal: "Could not read the agent's inbox on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: {
    payload: actSchema(codingAgentInboxAnswerParamsSchema),
    result: wireResult<CodingAgentInboxAnsweredView>(
      isReadable(codingAgentInboxAnsweredViewSchema),
    ),
    refusal: "Could not answer the inbox item on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_CLOSE]: {
    payload: actSchema(codingAgentInboxCloseParamsSchema),
    result: wireResult<CodingAgentInboxAnsweredView>(
      isReadable(codingAgentInboxAnsweredViewSchema),
    ),
    refusal: "Could not close the inbox item on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: {
    payload: actSchema(codingAgentInboxMessageParamsSchema),
    result: wireResult<CodingAgentInboxMessagedView>(
      isReadable(codingAgentInboxMessagedViewSchema),
    ),
    refusal: "Could not send the message on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: {
    payload: actSchema(codingAgentInboxReadStateParamsSchema),
    result: wireResult<CodingAgentInboxReadStateView>(
      isReadable(codingAgentInboxReadStateViewSchema),
    ),
    refusal: "Could not mark the inbox item on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: {
    payload: actSchema(inboxReadAllRequestSchema),
    result: wireResult<CodingAgentInboxReadAllView>(isReadable(codingAgentInboxReadAllViewSchema)),
    refusal: "Could not mark the inbox read on this system.",
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: {
    payload: actSchema(codingAgentInboxAttachmentParamsSchema),
    result: wireResult<CodingAgentInboxAttachmentView>(
      isReadable(codingAgentInboxAttachmentViewSchema),
    ),
    refusal: "Could not read the inbox item's image on this system.",
  },
  [ACT_KIND.CODING_AGENTS_PICTURE]: {
    payload: actSchema(codingAgentPictureParamsSchema),
    result: wireResult<CodingAgentInboxAttachmentView>(
      isReadable(codingAgentInboxAttachmentViewSchema),
    ),
    refusal: "Could not read the agent's picture on this system.",
  },
  [ACT_KIND.BROWSER_OPEN]: {
    payload: actSchema(browserAddressParamsSchema),
    result: wireResult<BrowserPage>(isReadable(browserPageSchema)),
    refusal: "Could not open that page.",
  },
  [ACT_KIND.BROWSER_NAVIGATE]: {
    payload: actSchema(browserAddressParamsSchema),
    result: answersNothing,
    refusal: "Could not open that page.",
  },
  [ACT_KIND.BROWSER_STEP]: {
    payload: actSchema(browserStepParamsSchema),
    result: answersNothing,
    refusal: "Could not move the page.",
  },
  [ACT_KIND.BROWSER_PLACE]: {
    payload: actSchema(browserPlaceParamsSchema),
    result: answersNothing,
    refusal: "Could not show the page.",
  },
  [ACT_KIND.BROWSER_CAPTURE]: {
    payload: actSchema(browserViewParamsSchema),
    // A still of the page as a data address, or none where the view stands nowhere.
    result: wireResult<string | null>((value) => value === null || isWireString(value)),
    refusal: "Could not draw the page.",
  },
  [ACT_KIND.BROWSER_CLOSE]: {
    payload: actSchema(browserViewParamsSchema),
    result: answersNothing,
    refusal: "Could not close the page.",
  },
  [ACT_KIND.CODING_AGENTS_CHAT]: {
    payload: actSchema(codingAgentChatParamsSchema),
    result: wireResult<CodingAgentChatAnswerView>(isReadable(codingAgentChatAnswerViewSchema)),
    refusal: "Could not read the workspace's chat on this system.",
  },
  [ACT_KIND.CODING_AGENTS_CHAT_POST]: {
    payload: actSchema(codingAgentChatPostParamsSchema),
    result: wireResult<CodingAgentChatWriteAnswerView>(
      isReadable(codingAgentChatWriteAnswerViewSchema),
    ),
    refusal: "Could not write to the workspace's chat on this system.",
  },
  [ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT]: {
    payload: actSchema(codingAgentChatAttachmentParamsSchema),
    result: wireResult<CodingAgentInboxAttachmentView>(
      isReadable(codingAgentInboxAttachmentViewSchema),
    ),
    refusal: "Could not read the chat message's picture on this system.",
  },
  [ACT_KIND.MICROPHONE_REQUEST]: {
    payload: noPayload,
    result: wireResult<MicrophoneStatus>(),
    refusal: "Could not ask for the microphone on this system.",
  },
  [ACT_KIND.MICROPHONE_ROUTE]: {
    payload: noPayload,
    result: wireResult<MicrophoneRoute | undefined>(),
    refusal: "Could not read the microphone route on this system.",
  },
  [ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: press("Could not open the notification settings."),
  [ACT_KIND.NOTIFICATIONS_TEST]: press("Could not post a notification on this system."),
  [ACT_KIND.CONTACT_EMAIL]: press("Could not open a new email on this system."),
  [ACT_KIND.WINDOW_FOCUS_PANEL]: press("Could not focus the panel on this system."),
  [ACT_KIND.WINDOW_COPY_TEXT]: {
    // A task's whole document and a File tab's whole file are copied
    // through this act, so it admits the longer of the two the service
    // holds, and an empty document copies as the empty text it is.
    payload: record({
      words: exactTextAllowingEmpty(Math.max(PLAN_MARKDOWN_MAX_CHARS, FILE_TEXT_MAX_CHARS)),
    }),
    result: answersNothing,
    refusal: "Could not copy that to the clipboard on this system.",
  },
  [ACT_KIND.WINDOW_SAVE_FILE]: {
    // A File tab's file, saved where the developer chooses in the system's
    // save dialog; answers whether it was saved rather than the dialog cancelled.
    payload: record({ name: savedFileName, text: exactTextAllowingEmpty(FILE_TEXT_MAX_CHARS) }),
    result: wireResult<boolean>(isWireBoolean),
    refusal: "Could not save that file on this system.",
  },
  [ACT_KIND.FEEDBACK_SEND]: {
    payload: fields<{ submission: FeedbackSubmission }>({
      submission: (value) => feedbackSubmission(value) !== undefined,
    }),
    result: wireResult<FeedbackResult>(),
    refusal: "Could not send that on this system.",
  },
} as const satisfies Record<ActKind, ActDeclaration<unknown, unknown>>;

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT)[Kind]["payload"]>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT)[Kind]["result"]>;

/**
 * One command as it crosses: the kind, and the payload its kind takes. A kind
 * that carries nothing has no `payload` key at all, so a payload sent to one
 * is a shape this type cannot describe and the boundary refuses.
 */
export type Act = {
  [Kind in ActKind]: ActPayload<Kind> extends undefined
    ? { readonly kind: Kind }
    : { readonly kind: Kind; readonly payload: ActPayload<Kind> };
}[ActKind];

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

const ACT_KINDS: readonly string[] = Object.keys(ACT);

function isActKind(value: UnparsedWireValue): value is ActKind {
  return isWireString(value) && ACT_KINDS.includes(value);
}

/**
 * One act as its kind's own schema admits it, or nothing. The whole envelope
 * is read: an unnamed kind, a key beside `kind` and `payload`, a payload a
 * kind takes none of, and a payload its schema refuses are each refused here.
 */
export function parsedAct(value: UnparsedWireValue): Act | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (key !== "kind" && key !== "payload") return undefined;
  const kind = value.kind;
  if (!isActKind(kind)) return undefined;
  const read = ACT[kind].payload.read(value.payload);
  if (!read.ok) return undefined;
  // SAFETY: the kind's own schema admitted this payload, which is the pairing Act declares.
  return (read.value === undefined ? { kind } : { kind, payload: read.value }) as Act;
}

/** Whether an answer is one of the three outcomes, whatever its kind's own value is. */
export function isActOutcome(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) return Object.keys(value).length === 1;
  if (value.status === ACT_OUTCOME_STATUS.REFUSED) {
    return Object.keys(value).length === 2 && isWireString(value.reason);
  }
  if (value.status !== ACT_OUTCOME_STATUS.DONE) return false;
  for (const key of Object.keys(value)) if (key !== "status" && key !== "value") return false;
  return isWireValue(value.value);
}
