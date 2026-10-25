import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentCallsAnswerView,
  type CodingAgentChangesAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentListAnswer,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentReviewOptionsAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CONTEXT_WINDOW,
  type CodingAgentAttachment,
  type CodingAgentChangesPeople,
  type CodingAgentOrigin,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import type { CatalogModel, ModelChoice, ModelProvider } from "@luke/features/models-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActPayload } from "@luke/host/contract";
import { STATUS_TONE } from "@luke/ui";
import {
  type PendingValues,
  pendingSettled,
  pendingShown,
  pendingValue,
  pendingWithout,
  type SameValue,
} from "@luke/ui/pending-values";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActHandle } from "../act.js";
import {
  DRAFT_PLACE,
  type Draft,
  type KeptDraft,
  type NewAgentPlace,
  useDraftWriter,
  useNewAgentDraft,
} from "../composer-drafts.js";
import { usePendingNow } from "../pending-clock.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { TOAST_HOLD, undoToast, useToast, useWithdrawToast } from "../toast.js";
import { useChatOn } from "./chat-gate.js";
import {
  type AgentRun,
  ARCHIVE_NOT_READY,
  archiveWords,
  choiceRequest,
  DELETE_WORDS,
  openingLineOf,
  RENAME_FAILED,
  SERVERS_FAILED,
  type SentLine,
  START_FAILED_AWAY,
  START_NEEDS_REPOSITORY,
  STOP_FAILED,
  startFailureNote,
  withAgent,
  withAgentRun,
} from "./coding-agent-model.js";
import { type AgentFork, continueFork, forkStart } from "./fork-model.js";
import {
  type ByPullRequestTab,
  pullRequestAsked,
  withPullRequestTab,
} from "./pull-request-number.js";
import { keptSkills } from "./repository-skills.js";
import type { SkillSource } from "./skill-picker.js";
import type { CallsReader } from "./use-agent-calls.js";
import type { MessageSender } from "./use-agent-composer.js";
import type { ChoiceWriter } from "./use-agent-model.js";
import { type PullRequestReader, useTaskPullRequests } from "./use-agent-pull-request.js";
import type { ServersWriter } from "./use-agent-servers.js";
import {
  type TranscriptFollower,
  type TranscriptReader,
  windowTranscriptFollower,
} from "./use-agent-transcript.js";
import { type InboxFollower, windowInboxFollower } from "./use-followed-inboxes.js";
import type {
  InboxAnswerer,
  InboxImageReader,
  InboxMessenger,
  InboxThreadStarter,
} from "./use-task-inbox.js";

/** A pull request's chapters the port refused to answer, as the tab hears any answer that never came. */
const CHAPTERS_UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

/** No words to listen for, one array so a render that has none hands down the same one. */
const NO_KEYWORDS: readonly string[] = [];
/**
 * use-coding-agents.ts -- the open task's coding agents as one control: the agents and their status, the Start button, a draft agent started on a prompt, the Stop, a message to one, a change of one's model, and the models the menus offer.
 *
 * The agents are read when a task opens, again after a Start or a Stop,
 * and as the task's column's "+" opens, and never on a clock; an agent's status moves between those reads only
 * as its own transcript page reports it, or as the service answers a
 * message to it, which is the agent running. A Start mints a key of its own
 * for the press, so a service that did not answer is asked again under the
 * same key on the next press of the same choice and answers the agent the
 * first press made rather than a second one; a press of another choice is
 * another request with a key of its own. The models the menu offers and
 * the account's default are read when the menu asks, so the menu shows the
 * catalog as it stands and the default as Settings last wrote it; a model or
 * effort picked in the Start menu is what that button's next Start runs on,
 * never the account's default; one picked on an agent's chip is written
 * on that agent alone, for its next step, and the agent the service answers
 * takes its place in the list, as does the agent a rename answers. A page
 * of an agent's transcript carries its title too, which is how the title
 * generated as the agent started reaches a tab the list opened before it
 * landed.
 *
 * A draft is an agent the developer opened from the column's "+" and has
 * not yet sent anything: it exists only here, so a draft let go leaves
 * nothing behind on the service. Its first message starts the agent with
 * those words as its task, in the task's place, under the draft's own key,
 * so a send asked again after the service did not answer is the same
 * agent; the agent's tab then opens as a Start's does. Each task has at
 * most one draft, held with the words written in it and the choice made on
 * its chip, so a draft keeps them while its tab is away and while the
 * developer visits another plan. Its words and files are the plan's kept
 * draft (`../composer-drafts.ts`), under the draft's key, so its words
 * outlast a relaunch too, and a plan holding them opens on its draft's tab
 * again, under the same key. A draft let go while it holds words or files
 * goes at once, and a toast offers Undo, which puts it back under the same
 * key, its chips, words, and files with it, and shows its tab again.
 *
 * New task's Agent mode starts its agent with its task, in the task's one
 * start (`use-tasks-tab.ts`): an agent that landed joins the list of the
 * task it started on where that task stands open (`onTaskStarted`), drawn
 * at once with the words it was started on as its first line (`opening`),
 * before the task's list or the agent's transcript is read, and one
 * the service refused leaves the task a draft holding the words, the files,
 * and the model New task's chip named, with why (`onHandDraft`), under the
 * key that start carried, so its tab's Retry is an agent's own Start on the
 * task and answers the agent the first start made where it made one.
 *
 * An agent may be archived on its own, which the service does only once a
 * turn it still runs is stopped. The list is read with the archived agents
 * among the rest and split here: `agents` holds those standing, which is
 * every tab, row, and menu of the task, and `archived` the rest, which the
 * summary keeps folded away with an Unarchive on each. A rename, an archive,
 * and an unarchive are drawn at once, before the service answers, over
 * every list that names the agent (`pending`, `withPendingAgents`), and put
 * back if it refuses; each stands until a view carries it, carries a third
 * value, no longer holds the agent, or its time runs out
 * (`@luke/ui/pending-values`). Once an archive lands, a toast offers Undo.
 *
 * An agent may be continued in a new one, which is a Start on the task
 * `from` that agent on its whole transcript, with the developer's words, where
 * they wrote some, as its note. Each agent continued holds a key of its own
 * until its Start lands, so a press asked again after the service did not
 * answer opens the agent the first press made; words or files of another
 * press are another request under a key of its own. Its tab opens as a
 * Start's does.
 */

/** The words New task started an agent on: the key its start carried, the prompt, and the files. */
interface StartedWords {
  readonly key: string;
  readonly prompt: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

/** The line an agent was started on, by the agent. */
interface OpeningLine {
  readonly agentId: string;
  readonly line: SentLine;
}

/** Who an agent's pull request names, as its Changes tab last read them, and the pull request's page they were read for. */
export interface HeldPeople {
  readonly url: string;
  readonly people: CodingAgentChangesPeople;
}

/** Everything the Start button, the tabs, and the agent tab draw and press. */
export interface CodingAgentsControl {
  /** The signed-in account's id, whose own agents carry no "Started by"; none while signed out, or for an identity stored without one. */
  me: string | undefined;
  /** Whether the window offers Chat (`chat-gate.ts`): what a chat notice in an agent's transcript is drawn and copied as, a card from its sender or the plain line it is. */
  chatOn: boolean;
  /** The open task's agents in the order started, an archived one left out, or nothing before the first read lands. */
  agents: readonly CodingAgentSummary[] | undefined;
  /** The open task's archived agents in the order started, or nothing before the first read lands. */
  archived: readonly CodingAgentSummary[] | undefined;
  /** The workspace the one agent read as its page belongs to; none on a task, where the task says it, and before the page's read lands. */
  workspaceId?: string | undefined;
  /** The repository of the one agent read as its page, `owner/name`, on the same terms as its workspace. */
  agentRepository?: string | undefined;
  /** The automation's run that started the one agent read as its page; none on a plan, for an agent started by hand, and before the page's read lands. */
  origin?: CodingAgentOrigin | undefined;
  /** The agent tabs the panel may show, by agent id; nothing before the first read lands. */
  agentIds: readonly string[] | undefined;
  /** Every agent of the task by id, an archived one among them, which its Inbox stands on, since an archived agent's items still stand; nothing before the first read lands. */
  heldIds: readonly string[] | undefined;
  /** Whether the last read of the list did not land. */
  listFailed: boolean;
  /** Whether the last read answered that the agent read by its id is not there for the reader: deleted, or of a workspace they are not in. */
  listMissing: boolean;
  /** Reads the list again: after a read that failed, or as the column's "+" opens, so it says where each agent stands now. */
  onRetryList: () => void;
  /** The models the menu offers, as last read; nothing before the menu first asks. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the last read of the models did not land, so the menu says so with Retry rather than reading for ever. */
  modelsFailed: boolean;
  /** Reads the models now, for a menu opening or the menu's Retry. */
  readModels: () => void;
  /** Reads the account's default now, for a menu opening or the Settings page. */
  readDefault: () => Promise<CodingAgentDefaultAnswer>;
  /** The open task's draft agent; nothing while it has none. */
  draft: AgentDraft | undefined;
  /** Opens a draft agent on the open task, or answers the one it has, by its key. */
  onNewDraft: () => string;
  /**
   * Forks one of the task's agents at one of its messages into the open
   * task's draft, opening one where it has none, or answers the draft it
   * joined, by its key: its words and files stay, and its chips start on
   * the source's model and effort and its MCP servers.
   */
  onForkDraft: (fork: AgentFork) => string;
  /**
   * Opens the open task's draft as a continue of one of its agents on its
   * whole transcript, or answers the draft it joined, by its key: the words
   * and files given are laid in after any the draft held, and its chips
   * start on the source's model and effort and its MCP servers. Nothing is
   * sent until the draft is.
   */
  onContinueDraft: (
    sourceId: string,
    words: string,
    attachments: readonly CodingAgentAttachment[],
  ) => string;
  /** Lets the open task's draft's fork go, leaving an ordinary draft with its words and chips. */
  onDropFork: () => void;
  /** Writes the open task's draft: the words in its box, the choice on its chip, the MCP servers it switched off, or that the refusal it was handed was let go. */
  onDraftChange: (
    change: Partial<Pick<AgentDraft, "prompt" | "choice" | "disabledServers" | "refused">>,
  ) => void;
  /**
   * Hands a task New task just started, whose agent the service refused, a
   * draft agent under the key that start carried, holding the words, the
   * files, the choice made on New task's chip, and why it was refused, which
   * its tab shows under the box with Retry.
   */
  onHandDraft: (taskId: string, handed: HandedDraft) => void;
  /**
   * Takes an agent New task started with its task, and the words it was
   * started on: it joins the list where that task stands open, or stands
   * as that task's whole list until the list is read, which is read again,
   * and its words are its first line until its transcript reads one back.
   */
  onTaskStarted: (taskId: string, agent: CodingAgentSummary, words: StartedWords) => void;
  /** The first line of the agent New task last started, drawn as the developer's until its transcript reads a line of theirs back (`unreadOpeningLine`). */
  opening: OpeningLine | undefined;
  /** Changes the open task's draft's files from those it holds as the change lands. */
  onDraftAttachments: (
    next: (held: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
  /**
   * Lets the draft go; nothing was started, so nothing is left behind. One
   * that held words or files raises a toast whose Undo puts it back and
   * shows its tab (`onDraftRestored`).
   */
  onDiscardDraft: (draftId: string) => void;
  /**
   * Starts the draft's agent with the words as its prompt, never the task,
   * and the files attached to them, on the choice where one was made and else the account's default,
   * with the MCP servers the draft switched off; the
   * agent's tab opens as a Start's does. Answers why it did not start, or
   * nothing once it did.
   */
  startPrompt: (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly CodingAgentAttachment[],
    disabledServers?: readonly string[],
  ) => Promise<Failure | undefined>;
  /**
   * Starts the draft's fork: from its source at its message, under the
   * draft's key, with the box's words and files as a note where it holds
   * any, the MCP servers the draft switched off, and the choice
   * where one was made; the agent's tab opens as a Start's does. Answers
   * why it did not start, or nothing once it did.
   */
  startFork: (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly CodingAgentAttachment[],
    disabledServers?: readonly string[],
  ) => Promise<Failure | undefined>;
  /** Brings back the archived agent a surface draws alone, as its own page does; none from here, where every agent is a task's. */
  onUnarchive: (() => void | Promise<void>) | undefined;
  /** Continues one agent in a new one on its whole transcript, the developer's words and files as its note, its tab opening as a Start's does; present exactly while a Start could run. */
  continueAgent: AgentContinuer | undefined;
  start: {
    /** Whether a Start could run now: the task names a repository. */
    available: boolean;
    /** Why it cannot, said on the button, while it cannot. */
    reason: string | undefined;
    /** Whether a Start is out. */
    busy: boolean;
    /** Why the last Start did not start, or the last change of model did not take, said beside the button until the next. */
    note: Failure | undefined;
    /** Whether this button's own last Start started its agent, so a draft's or a call's start, which hold it busy too, never reads as its own. */
    succeeded: boolean;
    /** Starts an agent on the choice given, or on the account's default with none. */
    onPress: (choice?: ModelChoice) => void;
    /** The agent a Start on the open task is still making, its tab standing under the press's key until the service answers; none while none is out. */
    pending?: StartingAgent | undefined;
  };
  /**
   * A draft's Call: starts the draft's agent for a call to open into, on
   * eve whatever the account's routing would choose. A draft holding words
   * or files starts on them under its own key, as a send does, marked
   * `call`; an empty one starts blank under a key of the press's own, which
   * needs no repository. Either runs on the draft's chips, lets the draft go
   * once it lands, and opens the agent's tab as a Start's does. Answers the
   * agent, or why it did not start. Present exactly while a task is open.
   */
  startCall: ((draft: AgentDraft) => Promise<DraftCallStart>) | undefined;
  /** Stops one agent; the list is read again once the service answers. */
  onStop: (agentId: string) => Promise<void>;
  /** Takes one agent back to just before one of the developer's lines, stopping it first, and takes the agent as the service answers it. */
  onRewind: (agentId: string, messageId: string) => Promise<CodingAgentAgentAnswer>;
  /** Sends one agent a message under the key the composer made, and takes the agent's status from the answer. */
  onMessage: MessageSender;
  /** Changes one agent's model and effort for its next step, and takes the agent as the service answers it. */
  onChoose: ChoiceWriter;
  /** Switches one agent's MCP servers for its next turn on, and takes the agent as the service answers it; a refusal is said in a toast. */
  onSwitchServers: ServersWriter;
  /** Opens Settings on its Integrations page, where an MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page at the provider's harness row, where the developer's key for it is; at the page's top where none is known. */
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  /** The names and archives given here that no view carries yet, which every list naming an agent draws over its own (`withPendingAgents`). */
  pending: PendingAgents;
  /** Renames one agent, drawn at once and taking the agent as the service answers it; answers whether the rename took. */
  onRename: (agentId: string, title: string) => Promise<boolean>;
  /**
   * Archives one agent, a turn it still runs stopped first, or brings it
   * back, drawn at once unless `drawn` waits on the answer, taking the agent
   * as the service answers it and offering Undo in a toast; a refusal puts
   * it back and is answered rather than said, for the caller to say in its
   * dialog or a toast of its own.
   */
  onArchive: (agentId: string, archived: boolean, drawn?: ArchiveDrawn) => Promise<ActionResult>;
  /**
   * Deletes one agent for good, a turn it still runs stopped first, taking
   * it out of the list and saying so in a toast; a refusal is answered
   * rather than said, for the dialog that asked to say.
   */
  onDelete: (agentId: string) => Promise<ActionResult>;
  /** Reads the task's agents again now, answering the one named as it stands, or nothing where the read did not land or holds no such agent. */
  readAgent: (agentId: string) => Promise<CodingAgentSummary | undefined>;
  /** An agent's transcript page said where it stands now. */
  onStatus: (agentId: string, run: AgentRun) => void;
  /** An agent's transcript page said what it is titled now, which the list read before the title landed did not. */
  onTitle: (agentId: string, title: string | null) => void;
  /** One read of an agent's transcript past a cursor at once, as Copy transcript asks it. */
  readTranscript: TranscriptReader;
  /** One read of the calls into an agent, each with its lines and its record, which its tab places among its rows. */
  readCalls: CallsReader;
  /** How a shown tab follows its transcript and hears its pages pushed. */
  transcripts: TranscriptFollower;
  /** One read of what an agent published, as its tab asks it, its answer kept in `pullRequests`. */
  readPullRequest: PullRequestReader;
  /** Each of the task's agents' pull requests, by agent, of those that have one (`useTaskPullRequests`). */
  pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** Each pull request a Pull request tab names by its number, by agent and then by number (`pull-request-number.ts`), as `readNumberedPullRequest` last read it. */
  numberedPullRequests: ByPullRequestTab<CodingAgentPullRequest>;
  /** One read of the pull request of an agent's repository by its number, its answer kept in `numberedPullRequests`; whether it named one. */
  readNumberedPullRequest: (agentId: string, number: number) => Promise<boolean>;
  /** One read of an agent's changes, its pull request's files, as its Changes tab asks it, or of the pull request of its repository by the number given (`pull-request-number.ts`); who its own names kept in `changesPeople`. */
  readChanges: (agentId: string, number?: number) => Promise<CodingAgentChangesAnswerView>;
  /**
   * One read of a pull request's chapters, as its Chapters tab asks it: the
   * agent's own pull request, or the one of its repository by the number
   * given (`pull-request-number.ts`). Answers its head now, whether chapters
   * can be generated, and the workspace's newest chapters, whatever head they
   * were made for; or why there are none, a port that refused included.
   */
  readChapters: (agentId: string, number?: number) => Promise<PullRequestChaptersAnswerView>;
  /**
   * The same pull request's chapters generated for its head now, or the
   * generation already under way; answers once the generation lands, which
   * may take minutes, as `readChapters` answers.
   */
  generateChapters: (agentId: string, number?: number) => Promise<PullRequestChaptersAnswerView>;
  /** Who each agent's pull request names, by agent, as its Changes tab last read them, with the pull request they were read for; none for an agent whose changes were not read, or name no pull request. */
  changesPeople: ReadonlyMap<string, HeldPeople>;
  /** One read of an agent's pull request itself as its Pull request tab's overview draws it: its description, branches, mergeability, and people. */
  readOverviewPullRequest: (
    agentId: string,
    number?: number,
  ) => Promise<CodingAgentOverviewPullRequestAnswerView>;
  /** One read of what the reviewer and label pickers of an agent's Pull request tab offer. */
  readReviewOptions: (agentId: string) => Promise<CodingAgentReviewOptionsAnswerView>;
  /** One read of the checks on an agent's pull request's head, as its overview draws them. */
  readOverviewChecks: (
    agentId: string,
    number?: number,
  ) => Promise<CodingAgentOverviewChecksAnswerView>;
  /** One read of an agent's pull request's conversation and where its reviewers stand, as its overview draws them. */
  readOverviewConversation: (
    agentId: string,
    number?: number,
  ) => Promise<CodingAgentOverviewConversationAnswerView>;
  /** One read of which of an agent's pull request's files the member marked viewed on GitHub, on their own GitHub sign-in. */
  readPullRequestViewed: (
    agentId: string,
    number?: number,
  ) => Promise<CodingAgentPullRequestViewedAnswerView>;
  /** The words a dictation into an agent's box is likely to say, read off the open task. */
  keywords: readonly string[];
  /** The skills of the open plan's repository a `/` in an agent's box offers, read once for the plan (`repository-skills.ts`), or of the agent's own where no plan is open; nothing while neither names a repository. */
  readSkills: SkillSource | undefined;
  /** How a task's or an agent's inbox is followed, and heard pushed, as the Inbox tab draws it. */
  inboxFollower: InboxFollower;
  /** One answer to an inbox item, as a card sends it. */
  answerInbox: InboxAnswerer;
  /** One message on an inbox item's thread, as its box sends it. */
  messageInbox: InboxMessenger;
  /** One thread started with an agent, as the Inbox's New thread sends it. */
  startInboxThread: InboxThreadStarter;
  /** One read of an inbox item's image, as its card asks it. */
  readInboxImage: InboxImageReader;
}

/**
 * An agent not yet started: the key its first message starts it under, the
 * words written so far, the files attached to them, the choice made on its
 * chip, none while it runs on the account's default, or on its source's
 * where it is a fork, the MCP servers switched off for it, and the agent
 * and message it forks, where it is a fork (`fork-model.ts`).
 */
export interface AgentDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly fork?: AgentFork | undefined;
  /** Why the service refused the agent of a draft New task handed over (`onHandDraft`), which its tab shows under the box until the next send. */
  readonly refused?: Failure | undefined;
}

/** What a draft's Call answers: the agent it started, for the call to open into, or why it did not start. */
export type DraftCallStart = { readonly agentId: string } | { readonly failure: Failure };

/** What a draft agent holds beside its words and files: its key, what its chips chose, the fork it is, and why New task's start of it was refused. */
type DraftChoices = Pick<AgentDraft, "id" | "choice" | "disabledServers" | "fork" | "refused">;

/** The plan's draft agent: the key and chips held, with the words and files kept for it, or the words kept under their own key where nothing is held, as after a relaunch. */
function taskDraft(
  held: DraftChoices | undefined,
  kept: KeptDraft<NewAgentPlace> | undefined,
): AgentDraft | undefined {
  const id = held?.id ?? kept?.place.draftId;
  if (id === undefined) return undefined;
  return {
    id,
    prompt: kept?.text ?? "",
    attachments: kept?.attachments ?? [],
    choice: held?.choice,
    disabledServers: held?.disabledServers ?? [],
    // Note that a fork is kept with the words too, so a relaunch keeps the draft a fork.
    ...forkOf(held === undefined ? kept?.place.fork : held.fork),
    ...(held?.refused === undefined ? undefined : { refused: held.refused }),
  };
}

/** What New task hands a task it started whose agent was refused: the key that start carried, the prompt, its files, the choice its chip made, none for the account's default, and why. */
interface HandedDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly refused: Failure;
}

/** A draft's fork as an optional key, absent where it forks nothing. */
function forkOf(fork: AgentFork | undefined): { readonly fork?: AgentFork } {
  return fork === undefined ? {} : { fork };
}

/** Nothing laid in after a draft's own words as they move. */
const NOTHING_CARRIED: Pick<Draft, "text" | "attachments"> = { text: "", attachments: [] };

/** The agent a Start is still making: the key its press minted, which its tab stands under until the service answers, and the model it was chosen on, none for the account's default. */
export interface StartingAgent {
  readonly key: string;
  readonly model: string | undefined;
}

/** What the toast says as a draft holding words or files is let go. */
const DRAFT_CLOSED = "Draft closed";

/** A draft let go while it held words or files, kept for its Undo: the plan it stood on, its key and chips, and its words and files. */
interface ClosedDraft {
  readonly on: string;
  readonly choices: DraftChoices;
  readonly words: Pick<Draft, "text" | "attachments">;
}

/** What a draft holds beside its words and files, as the drafts hold it. */
function choicesOf(draft: AgentDraft): DraftChoices {
  const { id, choice, disabledServers, fork, refused } = draft;
  return {
    id,
    choice,
    disabledServers,
    ...forkOf(fork),
    ...(refused === undefined ? undefined : { refused }),
  };
}

/** Whether a draft holds no words or files. */
function holdsNoWords(draft: AgentDraft): boolean {
  return draft.prompt === "" && draft.attachments.length === 0;
}

/** Whether a draft holds nothing at all: no words or files, no fork, and its chips as they open. */
function holdsNothing(draft: AgentDraft): boolean {
  return (
    holdsNoWords(draft) &&
    draft.fork === undefined &&
    draft.choice === undefined &&
    draft.disabledServers.length === 0 &&
    draft.refused === undefined
  );
}

/** The draft as it would be let go, kept for its Undo, or nothing where it holds no words or files. */
function closedDraft(on: string, draft: AgentDraft): ClosedDraft | undefined {
  if (holdsNoWords(draft)) return undefined;
  return {
    on,
    choices: choicesOf(draft),
    words: { text: draft.prompt, attachments: draft.attachments },
  };
}

/** A Start on its way or asked again: the task, the key the press minted, and the choice it was for. */
interface PendingStart {
  taskId: string;
  key: string;
  choice: ModelChoice | undefined;
}

/** Starts a new agent on the open task from one of its agents' whole transcript, with the developer's words and the files attached to them as its note where given; answers why it did not start, or nothing once it did. */
export type AgentContinuer = (
  agentId: string,
  note?: string,
  attachments?: readonly CodingAgentAttachment[],
) => Promise<Failure | undefined>;

/** A continue on its way or asked again: the task or the page's agent it was pressed on, the key the press minted, and the note and files it carried. */
interface PendingContinue {
  on: string;
  key: string;
  note: string | undefined;
  attachments: readonly CodingAgentAttachment[];
}

/** Whether two presses carry the same files, the same ones in the same order. */
function sameFiles(
  a: readonly CodingAgentAttachment[],
  b: readonly CodingAgentAttachment[],
): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

/** Why a Start cannot run on the open task, while it cannot: it names no repository. */
function startReason(taskId: string | undefined, repository: string | null): string | undefined {
  if (taskId === undefined) return undefined;
  return repository === null ? START_NEEDS_REPOSITORY : undefined;
}

/** A list as read: the plan's agents, or the one agent read as its page, with its workspace, its repository, and the run that started it. */
type PageList = CodingAgentListAnswer & {
  readonly workspaceId?: string;
  readonly repository?: string;
  readonly origin?: CodingAgentOrigin;
};

/**
 * The read a list is taken from: the task's agents, archived ones among
 * them, where a task is open, and else the one agent named, read as its
 * page and held as a list of one, with the workspace it belongs to.
 */
function listRead(
  act: ActHandle["act"],
  taskId: string | undefined,
  agentId: string | undefined,
): Promise<PageList> {
  if (taskId !== undefined) {
    return act(ACT_KIND.CODING_AGENTS_LIST, { taskId, includeArchived: true });
  }
  // Note that a page names no automation by null where a summary leaves the key out.
  return act(ACT_KIND.CODING_AGENTS_PAGE, { agentId: agentId ?? "" }).then((answer): PageList => {
    if ("failure" in answer) return answer;
    const { automationId, origin, ...agent } = answer.agent;
    return {
      agents: [automationId === null ? agent : { ...agent, automationId }],
      workspaceId: answer.agent.workspaceId,
      ...(answer.agent.repository === null ? undefined : { repository: answer.agent.repository }),
      ...(origin === undefined ? undefined : { origin }),
    };
  });
}

/**
 * One agent read by its id as its own page reads it, wherever it stands,
 * on a task or on none; nothing where it could not be read. A surface that
 * holds no list of its own, such as the sidebar's row of an agent with no
 * task, reads it so before it archives it unasked.
 */
export function readAgentById(
  act: ActHandle["act"],
  agentId: string,
): Promise<CodingAgentSummary | undefined> {
  return listRead(act, undefined, agentId).then(
    (answer) => ("failure" in answer ? undefined : answer.agents[0]),
    () => undefined,
  );
}

/** What one agent's transcript pages said of it before its task's list was read: its run, its title, or both. */
interface HeardOfAgent {
  readonly run?: AgentRun;
  readonly title?: string | null;
}

/** Keeps what a page said of an agent beside what earlier pages said, the latest of each. */
function heardOf(heard: Map<string, HeardOfAgent>, agentId: string, said: HeardOfAgent): void {
  heard.set(agentId, { ...heard.get(agentId), ...said });
}

/** The list's agents with what their pages said before it was read laid over them. */
function withHeard(
  agents: readonly CodingAgentSummary[],
  heard: ReadonlyMap<string, HeardOfAgent>,
): readonly CodingAgentSummary[] {
  let laid = agents;
  for (const [agentId, { run, title }] of heard) {
    if (run !== undefined) laid = withAgentRun(laid, agentId, run);
    if (title !== undefined) {
      laid = laid.map((agent) => (agent.id === agentId ? { ...agent, title } : agent));
    }
  }
  return laid;
}

/** Whether two choices ask the same of a Start, read as `choiceRequest` sends them: only the standard window is a window apart. */
function sameChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return (
    a?.model === b?.model &&
    a?.effort === b?.effort &&
    (a?.contextWindow === CONTEXT_WINDOW.STANDARD) ===
      (b?.contextWindow === CONTEXT_WINDOW.STANDARD)
  );
}

/**
 * When an archive is drawn: at once, before the service answers, or once
 * it has, as a dialog that asked does, since the agent leaving would take
 * the dialog, and the refusal it would say, with it.
 */
export const ARCHIVE_DRAWN = {
  AT_ONCE: "at-once",
  ON_ANSWER: "on-answer",
} as const;

export type ArchiveDrawn = (typeof ARCHIVE_DRAWN)[keyof typeof ARCHIVE_DRAWN];

/**
 * The names and archives given here that no view carries yet, by agent id:
 * a rename's title, and an archive's time or null for an unarchive.
 */
export interface PendingAgents {
  readonly titles: PendingValues<string, string | null>;
  readonly archives: PendingValues<string, number | null>;
}

/** What a name or archive given here is laid over and waits on: an agent as any list holds it. */
type NamedAgent = Pick<CodingAgentSummary, "id" | "title" | "archivedAt">;

/** No name given here and waiting on a view. */
const NO_PENDING_TITLES: PendingValues<string, string | null> = new Map();

/** No archive given here and waiting on a view. */
const NO_PENDING_ARCHIVES: PendingValues<string, number | null> = new Map();

/** Whether two titles are one. */
const sameTitle: SameValue<string | null> = (a, b) => a === b;

/** Whether two archive stamps say the same: archived, at whatever time, or not. */
const sameArchive: SameValue<number | null> = (a, b) => (a === null) === (b === null);

/** When an agent a view holds was archived, null while it stands; none where the view holds no such agent. */
function archiveOf(agent: NamedAgent | undefined): number | null | undefined {
  return agent === undefined ? undefined : (agent.archivedAt ?? null);
}

/** One agent with the name and archive given here laid over it, each where one stands. */
function pendingAgent<A extends NamedAgent>(
  agent: A,
  title: string | null | undefined,
  archive: number | null | undefined,
): A {
  const named = title === undefined ? agent : { ...agent, title };
  if (archive === undefined) return named;
  if (archive !== null) return { ...named, archivedAt: archive };
  const { archivedAt: _archivedAt, ...standing } = named;
  return standing as A;
}

/**
 * The agents a list holds with every name and archive given here that the
 * list does not yet carry laid over them, so each surface draws the press at
 * once from its own list: the task's, an agent's page, or the sidebar's.
 */
export function withPendingAgents<A extends NamedAgent>(
  list: readonly A[],
  pending: PendingAgents,
): readonly A[] {
  if (pending.titles.size === 0 && pending.archives.size === 0) return list;
  const byId = new Map(list.map((agent) => [agent.id, agent] as const));
  const titles = pendingShown(
    pendingSettled(pending.titles, (id) => byId.get(id)?.title, sameTitle, undefined),
  );
  const archives = pendingShown(
    pendingSettled(pending.archives, (id) => archiveOf(byId.get(id)), sameArchive, undefined),
  );
  if (titles.size === 0 && archives.size === 0) return list;
  return list.map((agent) => pendingAgent(agent, titles.get(agent.id), archives.get(agent.id)));
}

export function useCodingAgents(input: {
  acts: Pick<ActHandle, "act">;
  /** The open task, or none. */
  taskId: string | undefined;
  /**
   * The one agent read by its id where no task is open, as the agent page
   * reads an agent with no task: the list holds that agent alone, so every
   * answer that moves it moves the page's agent too.
   */
  agentId?: string | undefined;
  /** The open task's repository, or null while it names none. */
  repository: string | null;
  /**
   * Every agent on a task, the archived ones left out, as the task list
   * followed live carries them; none where it is not followed, or does not
   * list the open task.
   */
  listedAgents?: readonly CodingAgentSummary[] | undefined;
  /**
   * The agents another list draws from this control's presses, as the
   * sidebar's agents with no task are, which a name or archive given here
   * waits on beside the control's own; none where only its own list draws.
   */
  viewedAgents?: readonly NamedAgent[] | undefined;
  /** Opens Settings on its Integrations page. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page. */
  /** The signed-in account's id, whose own agents carry no "Started by". */
  me?: string | undefined;
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  /** Called with the agent a Start made, so its tab opens. */
  onStarted: (agentId: string) => void;
  /** Called with the plan and key of a draft an Undo put back, so its tab opens again. */
  onDraftRestored?: (on: string, draftId: string) => void;
  /** The words a dictation into an agent's box is likely to say; none where nothing is open. */
  keywords?: readonly string[];
  /** Mints one press's key. */
  mintKey?: () => string;
}): CodingAgentsControl {
  const chatOn = useChatOn();
  const { taskId, agentId, repository } = input;
  const { act } = input.acts;
  const mintKey = input.mintKey ?? (() => crypto.randomUUID());
  // Note that the list is held under the agent too, where it is the page's one agent, so another agent's page holds nothing of the last.
  const [list, setList] = useState<{
    taskId: string | undefined;
    agentId: string | undefined;
    agents: readonly CodingAgentSummary[] | undefined;
    failed: boolean;
    missing?: boolean;
    workspaceId?: string | undefined;
    repository?: string | undefined;
    origin?: CodingAgentOrigin | undefined;
  }>({ taskId: undefined, agentId: undefined, agents: undefined, failed: false });
  const listOf = taskId === undefined ? agentId : undefined;
  const ours = (was: { taskId: string | undefined; agentId: string | undefined }) =>
    was.taskId === taskId && was.agentId === listOf;
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  // Where a Start from an agent and a draft stand: the open task, or the page's agent where no task
  // is open, whose Start the service puts where that agent is (its task, or its workspace).
  const startsOn = taskId ?? agentId;
  // Whether a Start from one of the agents could run: on a task naming a repository, or on an agent's
  // page, where the service reads the repository off the agent started from.
  const startsFrom = startsOn !== undefined && (taskId === undefined || repository !== null);
  // Each place's draft's key and chip, by the plan's id or the page's agent's; its words and files are kept apart.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftChoices>>(new Map());
  const heldDraft = startsOn === undefined ? undefined : drafts.get(startsOn);
  const keptDraft = useNewAgentDraft(startsOn, heldDraft?.id);
  const writer = useDraftWriter();
  const draft = startsOn === undefined ? undefined : taskDraft(heldDraft, keptDraft);
  const [note, setNote] = useState<{ taskId: string; note: Failure } | undefined>(undefined);
  const [startLanded, setStartLanded] = useState(false);
  const [reads, setReads] = useState(0);
  // The agent New task last started, its task, and the line it was started on.
  const [started, setStarted] = useState<
    { taskId: string; agent: CodingAgentSummary; line: SentLine } | undefined
  >(undefined);
  const pending = useRef<PendingStart | undefined>(undefined);
  // The Start out now on a task, whose tab stands under its key until it answers.
  const [pressed, setPressed] = useState<{ taskId: string; starting: StartingAgent } | undefined>(
    undefined,
  );
  // The agents Starts made on a task whose list was not read as they landed, which stand among its agents until the list is.
  const [unlisted, setUnlisted] = useState<
    { taskId: string; agents: readonly CodingAgentSummary[] } | undefined
  >(undefined);
  // Each agent continued's press, by the agent's id, held until its Start lands.
  const continues = useRef(new Map<string, PendingContinue>());
  const toast = useToast();
  const failed = useCallback(
    (words: string) => toast({ words, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED }),
    [toast],
  );
  // Note that the acts and the opening are read through a ref, because the
  // tab hands new closures on every render and a read is owed to the task
  // opening, not to a render.
  const latest = useRef(input);
  latest.current = input;

  // The list is this task's: another task's, or none, is nothing to draw.
  // Note that the agent New task just started stands as its task's list until
  // that list is read, so its tab draws at once rather than after the read.
  const read = ours(list) ? list.agents : undefined;
  const seed = useMemo(() => (started === undefined ? undefined : [started.agent]), [started]);
  const held = read ?? (taskId !== undefined && started?.taskId === taskId ? seed : undefined);
  const opening = useMemo(
    () => (started === undefined ? undefined : { agentId: started.agent.id, line: started.line }),
    [started],
  );
  // Note that until the list is read, the task's agents the followed task list carries stand as its
  // live agents, so the column draws at once; the read adds the archived ones, which only it holds.
  const { listedAgents } = input;
  const listedHere = useMemo(
    () =>
      taskId === undefined ? undefined : listedAgents?.filter((agent) => agent.planId === taskId),
    [listedAgents, taskId],
  );
  const shown = held ?? listedHere;
  // Note that the agents Starts made before the list was read stand beside what is shown, whatever
  // the followed task list carries yet, so their tabs never leave between the answer and the list.
  const landedHere =
    read === undefined && unlisted?.taskId === taskId ? unlisted?.agents : undefined;
  const standing = useMemo(() => {
    const missing = landedHere?.filter(
      (landed) => shown?.some((agent) => agent.id === landed.id) !== true,
    );
    return missing === undefined || missing.length === 0 ? shown : [...(shown ?? []), ...missing];
  }, [shown, landedHere]);
  // A name or archive given here stands over every list that names the agent until a view carries
  // it, and lets go once none holds the agent, as after a sign-out. The clock is read only while
  // one waits.
  const [titles, setTitles] = useState(NO_PENDING_TITLES);
  const [archives, setArchives] = useState(NO_PENDING_ARCHIVES);
  const given = useMemo((): PendingAgents => ({ titles, archives }), [titles, archives]);
  const pendingNow = usePendingNow(titles.size > 0 || archives.size > 0);
  const { viewedAgents } = input;
  useEffect(() => {
    const viewedOf = (agentId: string) =>
      standing?.find((agent) => agent.id === agentId) ??
      viewedAgents?.find((agent) => agent.id === agentId);
    setTitles((was) => pendingSettled(was, (id) => viewedOf(id)?.title, sameTitle, pendingNow));
    setArchives((was) =>
      pendingSettled(was, (id) => archiveOf(viewedOf(id)), sameArchive, pendingNow),
    );
  }, [standing, viewedAgents, pendingNow]);
  const drawn = useMemo(
    () => (standing === undefined ? undefined : withPendingAgents(standing, given)),
    [standing, given],
  );
  const agents = useMemo(() => drawn?.filter((agent) => agent.archivedAt === undefined), [drawn]);
  // Note that a Start out on the task stands among its tabs under the press's key, the task's
  // agents known or not, since it is the tab the press opens.
  const pressedHere = pressed?.taskId === taskId ? pressed?.starting : undefined;
  const agentIds = useMemo(() => {
    const ids = agents?.map((agent) => agent.id);
    return pressedHere === undefined ? ids : [...(ids ?? []), pressedHere.key];
  }, [agents, pressedHere]);
  const archivedAgents = useMemo(
    () =>
      held === undefined ? undefined : drawn?.filter((agent) => agent.archivedAt !== undefined),
    [held, drawn],
  );
  const listFailed = ours(list) && list.failed;
  const listMissing = ours(list) && list.missing === true;
  // What transcript pages said of their agents before the list was read: a
  // tab follows its agent from the id alone, so a page may land first, and
  // it knows the agent's run and title better than the list's answer does,
  // which is laid under it once a read of it lands (`withHeard`). What was
  // heard is kept through a read that failed, and is the open task's, or
  // the page's agent's, alone: another's list lets it go.
  const subject = taskId ?? agentId;
  const heardBeforeList = useRef<{ subject: string | undefined; heard: Map<string, HeardOfAgent> }>(
    { subject, heard: new Map() },
  );
  if (heardBeforeList.current.subject !== subject) {
    heardBeforeList.current = { subject, heard: new Map() };
  }
  const listedNow = useRef(false);
  listedNow.current = read !== undefined;

  // Read when the task opens, or the page's agent where no task is, and again when a Start or a Stop asks (`reads`).
  useEffect(() => {
    if (taskId === undefined && agentId === undefined) return;
    let live = true;
    listRead(latest.current.acts.act, taskId, agentId).then(
      (answer) => {
        if (!live) return;
        const { heard } = heardBeforeList.current;
        if (!("failure" in answer)) heardBeforeList.current.heard = new Map();
        setList((was) =>
          "failure" in answer
            ? {
                taskId,
                agentId: listOf,
                agents: ours(was) ? was.agents : undefined,
                failed: true,
                missing: answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND,
                workspaceId: ours(was) ? was.workspaceId : undefined,
                repository: ours(was) ? was.repository : undefined,
                origin: ours(was) ? was.origin : undefined,
              }
            : {
                taskId,
                agentId: listOf,
                agents: withHeard(answer.agents, heard),
                failed: false,
                workspaceId: answer.workspaceId,
                repository: answer.repository,
                origin: answer.origin,
              },
        );
      },
      () => {
        // A read that failed keeps the agents already drawn: their tabs stand until a read lands.
        if (live)
          setList((was) => ({
            taskId,
            agentId: listOf,
            agents: ours(was) ? was.agents : undefined,
            failed: true,
            workspaceId: ours(was) ? was.workspaceId : undefined,
            repository: ours(was) ? was.repository : undefined,
            origin: ours(was) ? was.origin : undefined,
          }));
      },
    );
    return () => {
      live = false;
    };
  }, [taskId, agentId, reads]);

  const readAgain = useCallback(() => setReads((count) => count + 1), []);

  const readModels = useCallback(() => {
    // The menu reads again while a read is out, so a Retry shows its reading.
    setModelsFailed(false);
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer: CodingAgentModelsAnswer) => {
        if ("failure" in answer) setModelsFailed(true);
        else {
          setModels(answer.models);
          setModelsFailed(false);
        }
      },
      () => setModelsFailed(true),
    );
  }, [act]);

  const readDefault = useCallback(
    (): Promise<CodingAgentDefaultAnswer> =>
      act(ACT_KIND.CODING_AGENTS_DEFAULT_READ).catch(
        (): CodingAgentDefaultAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      ),
    [act],
  );

  /** The list with an agent started on the task joined to it, where it is that task's and read. */
  const joined = (on: string, agent: CodingAgentSummary) =>
    setList((was) =>
      was.taskId === on && was.agents !== undefined
        ? {
            ...was,
            agents: was.agents.some((each) => each.id === agent.id)
              ? was.agents
              : [...was.agents, agent],
          }
        : was,
    );

  /** One Start asked of the service on the task, or, from the page's agent, where that agent is, held as under way until it answers. */
  const askStart = (
    on: string,
    asked: Omit<PortActPayload<typeof ACT_KIND.CODING_AGENTS_START>, "taskId">,
  ): Promise<CodingAgentAgentAnswer> => {
    setStarting(true);
    // Note that every Start holds the toolbar's busy, so each lets go of the last one's landing; only the toolbar's own sets it again.
    setStartLanded(false);
    // Note that a Start from the page's agent names no task, so the service puts it where that agent is.
    const where = on === taskId ? { taskId: on } : undefined;
    return act(ACT_KIND.CODING_AGENTS_START, { ...where, ...asked })
      .catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }))
      .then((answer) => {
        setStarting(false);
        return answer;
      });
  };

  /**
   * A Start that landed: the agent joins the list and its tab opens. Note
   * that one landing after the developer left the task opens no tab on the
   * task now open, and that the list is read again only where it was not
   * read yet, the agent standing among the task's agents until it is, since
   * a read already standing is joined the agent at once and one still out
   * may answer from before the Start.
   */
  const landed = (on: string, agent: CodingAgentSummary) => {
    if ((latest.current.taskId ?? latest.current.agentId) !== on) return;
    joined(on, agent);
    latest.current.onStarted(agent.id);
    if (listedNow.current) return;
    setUnlisted((was) => ({
      taskId: on,
      agents: [...(was?.taskId === on ? was.agents : []), agent],
    }));
    readAgain();
  };

  const pressStart = (choice?: ModelChoice) => {
    if (taskId === undefined || repository === null || starting) return;
    // The key is the press's own, and a press asked again after the service
    // did not answer carries the one it minted, so the service answers the
    // agent it may already have started rather than a second one.
    const held = pending.current;
    const key =
      held !== undefined && held.taskId === taskId && sameChoice(held.choice, choice)
        ? held.key
        : mintKey();
    pending.current = { taskId, key, choice };
    setNote(undefined);
    // The agent's tab opens on the press, under its key, and gives way to the agent once it is made.
    setPressed({ taskId, starting: { key, model: choice?.model } });
    latest.current.onStarted(key);
    askStart(taskId, {
      idempotencyKey: key,
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    }).then((answer) => {
      setPressed((was) => (was?.starting.key === key ? undefined : was));
      if ("failure" in answer) {
        // Only a service that never answered is asked again under the same key.
        if (answer.failure !== CODING_AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;
        setNote({ taskId, note: startFailureNote(answer, taskId) });
        // The note waits beside the task's Start; a developer who left the
        // task while it was out hears of it now.
        if (latest.current.taskId !== taskId) failed(START_FAILED_AWAY);
        return;
      }
      pending.current = undefined;
      setStartLanded(true);
      landed(taskId, answer.agent);
    });
  };

  // Note that an empty draft's press mints its own key, because a blank
  // agent is a new one each time it is asked for, while words go under the
  // draft's key, so a Call asked again opens the agent the first started.
  const startCall = async (held: AgentDraft): Promise<DraftCallStart> => {
    if (taskId === undefined)
      return { failure: { reason: FAILURE_REASON.OTHER, text: START_NEEDS_REPOSITORY } };
    const prompt = held.prompt.trim();
    const { choice, attachments, disabledServers } = held;
    const words = hasWordsOrFiles(prompt, attachments);
    if (words && repository === null) {
      return { failure: { reason: FAILURE_REASON.OTHER, text: START_NEEDS_REPOSITORY } };
    }
    const answer = await askStart(taskId, {
      ...(words
        ? {
            idempotencyKey: held.id,
            prompt,
            ...(attachments.length === 0 ? undefined : { attachments }),
            call: true,
          }
        : { idempotencyKey: mintKey(), blank: true }),
      ...(disabledServers.length === 0 ? undefined : { disabledServers }),
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });
    if ("failure" in answer) return { failure: startFailureNote(answer, taskId) };
    withDraft(taskId, undefined);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === held.id);
    landed(taskId, answer.agent);
    return { agentId: answer.agent.id };
  };

  // Note that a press carries the key its agent's last press minted while the
  // service has not answered it and the words and files are the same, so a
  // press asked again opens the agent the first may already have started.
  const continueAgent: AgentContinuer = async (sourceId, note, attachments = []) => {
    if (startsOn === undefined || !startsFrom) return undefined;
    const held = continues.current.get(sourceId);
    const carried = note !== undefined || attachments.length > 0 ? (note ?? "") : undefined;
    const key =
      held !== undefined &&
      held.on === startsOn &&
      held.note === carried &&
      sameFiles(held.attachments, attachments)
        ? held.key
        : mintKey();
    continues.current.set(sourceId, { on: startsOn, key, note: carried, attachments });
    const answer = await askStart(startsOn, {
      idempotencyKey: key,
      from: { agentId: sourceId },
      ...(carried === undefined ? undefined : { note: carried }),
      ...(attachments.length === 0 ? undefined : { attachments }),
    });
    if ("failure" in answer) {
      // Only a service that never answered is asked again under the same key.
      if (answer.failure !== CODING_AGENT_CALL_FAILURE.UNANSWERED) {
        continues.current.delete(sourceId);
      }
      if ((latest.current.taskId ?? latest.current.agentId) !== startsOn) failed(START_FAILED_AWAY);
      return startFailureNote(answer, taskId ?? null);
    }
    continues.current.delete(sourceId);
    landed(startsOn, answer.agent);
    return undefined;
  };

  /** The drafts with the plan's key and chips set to `next`, or let go where it is nothing. */
  const withDraft = (on: string, next: DraftChoices | undefined) =>
    setDrafts((was) => {
      const held = new Map(was);
      if (next === undefined) held.delete(on);
      else held.set(on, next);
      return held;
    });

  /** Lets a draft agent go by its key, its words and files with it. */
  const letGo = (draftId: string) => {
    for (const [on, held] of drafts) if (held.id === draftId) withDraft(on, undefined);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
  };

  const onNewDraft = (): string => {
    if (draft !== undefined) return draft.id;
    const id = mintKey();
    if (taskId !== undefined) {
      withDraft(taskId, { id, choice: undefined, disabledServers: [] });
    }
    return id;
  };

  /**
   * Where a draft's words are kept: under its key, beside the fork it is.
   * Note that an agent page's draft is kept with its agent's id as the
   * `planId`, so the drafted plans list that id too; no task has it, so no
   * row reads it as drafted.
   */
  const wordsPlace = (on: string, id: string, fork: AgentFork | undefined): NewAgentPlace => ({
    kind: DRAFT_PLACE.NEW_AGENT,
    planId: on,
    draftId: id,
    ...forkOf(fork),
  });

  /**
   * The open task's draft's words and files kept again under `id` and
   * `fork`, and no longer where they were, with the words and files
   * `carried` laid in after them, a blank line between the two.
   */
  const moveWords = (
    on: string,
    id: string,
    fork: AgentFork | undefined,
    carried: Pick<Draft, "text" | "attachments"> = NOTHING_CARRIED,
  ) => {
    const text = [draft?.prompt ?? "", carried.text].filter((each) => each !== "").join("\n\n");
    const attachments = [...(draft?.attachments ?? []), ...carried.attachments];
    if (draft !== undefined) {
      const was = draft.id;
      writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === was);
    }
    writer.update(wordsPlace(on, id, fork), (kept) => ({ ...kept, text, attachments }));
  };

  // Note that a fork joins the draft the task holds, so words already
  // written stay, under a key of the fork's own, because a Start the draft
  // sent and never heard answered is answered again under its old key; its
  // chips are put back on the source's, which a fork runs on unless the
  // developer picks otherwise.
  const onForkDraft = (fork: AgentFork): string => {
    const id = mintKey();
    if (startsOn === undefined) return id;
    const source = held?.find((agent) => agent.id === fork.agentId);
    moveWords(startsOn, id, fork);
    withDraft(startsOn, {
      id,
      choice: undefined,
      disabledServers: source?.disabledServers ?? [],
      fork,
    });
    return id;
  };

  // Note that a continue joins the task's draft as a fork does, under a key
  // of its own for the same reason, unless the draft already continues the
  // same agent and nothing is laid in, when it keeps its key, so a Start it
  // sent and never heard answered is answered with the agent it made; words
  // or files laid in make another request, which that agent never had.
  const onContinueDraft = (
    sourceId: string,
    words: string,
    attachments: readonly CodingAgentAttachment[],
  ): string => {
    const joins = draft?.fork?.agentId === sourceId && draft.fork.messageId === undefined;
    const adds = words.trim() !== "" || attachments.length > 0;
    const id = joins && !adds && draft !== undefined ? draft.id : mintKey();
    if (startsOn === undefined) return id;
    const source = held?.find((agent) => agent.id === sourceId);
    const fork = continueFork(sourceId);
    moveWords(startsOn, id, fork, { text: words.trim(), attachments });
    withDraft(startsOn, {
      id,
      choice: joins ? draft?.choice : undefined,
      disabledServers: joins ? (draft?.disabledServers ?? []) : (source?.disabledServers ?? []),
      fork,
    });
    return id;
  };

  // Note that an agent's page starts nothing but from its agent, so a fork let go there lets its draft go.
  const onDropFork = () => {
    if (draft === undefined) return;
    if (taskId === undefined) {
      letGo(draft.id);
      return;
    }
    moveWords(taskId, draft.id, undefined);
    withDraft(taskId, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
    });
  };

  /** The open plan's draft's words and files moved on from those kept for it. */
  const writeWords = (next: (was: Draft) => Draft) => {
    if (startsOn === undefined || draft === undefined) return;
    writer.update(wordsPlace(startsOn, draft.id, draft.fork), next);
  };

  const onDraftChange = (
    change: Partial<Pick<AgentDraft, "prompt" | "choice" | "disabledServers" | "refused">>,
  ) => {
    if (startsOn === undefined || draft === undefined) return;
    const { prompt, ...choices } = change;
    if (prompt !== undefined) writeWords((was) => ({ ...was, text: prompt }));
    if (Object.keys(choices).length === 0) return;
    withDraft(startsOn, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...(draft.fork === undefined ? undefined : { fork: draft.fork }),
      ...(draft.refused === undefined ? undefined : { refused: draft.refused }),
      ...choices,
    });
  };

  // Note that the words are kept as any draft's are, under the task New
  // task started and the key handed, so they outlast the tab, and the task
  // opens on the draft's tab until the agent starts. The key is the one
  // New task's start carried, so a Retry whose agent that start made after
  // all answers it rather than a second one.
  const onHandDraft = (on: string, handed: HandedDraft) => {
    writer.update(wordsPlace(on, handed.id, undefined), (was) => ({
      ...was,
      text: handed.prompt,
      attachments: handed.attachments,
    }));
    withDraft(on, {
      id: handed.id,
      choice: handed.choice,
      disabledServers: [],
      refused: handed.refused,
    });
  };

  // Note that the task New task started may not stand open yet as its start
  // answers, and the list read as it opens holds the agent already. A list
  // not yet read for the task is the agent alone until it is, so its tab
  // draws at once rather than after the read.
  const onTaskStarted = (on: string, agent: CodingAgentSummary, words: StartedWords) => {
    setStarted({ taskId: on, agent, line: openingLineOf(words) });
    if (latest.current.taskId !== on) return;
    joined(on, agent);
    readAgain();
  };

  // Note that the files are changed from the draft as it stands when the
  // change lands, because a file's read lands after the render that began it.
  const onDraftAttachments = (
    next: (held: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => writeWords((was) => ({ ...was, attachments: next(was.attachments) }));

  // Note that a draft holding words or files is let go at once, as every
  // act that can be taken back is, and its toast's Undo puts it back.
  const onDiscardDraft = (draftId: string) => {
    const closed =
      startsOn === undefined || draft?.id !== draftId ? undefined : closedDraft(startsOn, draft);
    letGo(draftId);
    if (closed === undefined) return;
    undoable.current = closed.choices.id;
    toast({
      ...undoToast(DRAFT_CLOSED, () => restoreNow.current(closed)),
      subject: closed.choices.id,
    });
  };

  // The closed draft whose Undo stands, withdrawn as the plan it was closed on leaves.
  const undoable = useRef<string | undefined>(undefined);
  const withdrawToast = useWithdrawToast();
  useEffect(
    () => () => {
      if (undoable.current !== undefined) withdrawToast(undoable.current);
      undoable.current = undefined;
    },
    [startsOn, withdrawToast],
  );

  // Note that Undo stands only while the plan the draft was closed on is
  // open, so the draft standing in its place now is one this hook reads. A
  // blank one, as a column left with no tab opens, gives way to the draft
  // closed; one holding words, files, a fork, or chips of its own keeps them,
  // the closed draft's words and files laid in after its own, under a key of
  // its own, as a continue's are, since that is another request.
  const restoreDraft = (closed: ClosedDraft) => {
    const { on, choices, words } = closed;
    if (on !== startsOn) return;
    undoable.current = undefined;
    const standing = draft?.id === choices.id ? undefined : draft;
    const keeps = standing !== undefined && !holdsNothing(standing);
    const id = keeps ? mintKey() : choices.id;
    if (keeps) {
      moveWords(on, id, standing.fork, words);
      withDraft(on, { ...choicesOf(standing), id });
    } else {
      if (standing !== undefined) letGo(standing.id);
      writer.update(wordsPlace(on, id, choices.fork), (was) => ({ ...was, ...words }));
      withDraft(on, choices);
    }
    latest.current.onDraftRestored?.(on, id);
  };
  const restoreNow = useRef(restoreDraft);
  restoreNow.current = restoreDraft;

  // Note that the draft's key is the Start's every time it is sent, because
  // nothing a refused send asked was made, and a send whose answer was lost
  // is answered with the agent it already made.
  const startPrompt = async (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly CodingAgentAttachment[],
    disabledServers: readonly string[] = [],
  ): Promise<Failure | undefined> => {
    if (taskId === undefined || repository === null)
      return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_REPOSITORY };
    const answer = await askStart(taskId, {
      idempotencyKey: draftId,
      prompt,
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(disabledServers.length === 0 ? undefined : { disabledServers }),
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });
    if ("failure" in answer) return startFailureNote(answer, taskId);
    withDraft(taskId, undefined);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
    landed(taskId, answer.agent);
    return undefined;
  };

  // Note that a fork is sent under the draft's key as a prompt is, for the same reason.
  const startFork = async (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly CodingAgentAttachment[],
    disabledServers: readonly string[] = [],
  ): Promise<Failure | undefined> => {
    if (startsOn === undefined || !startsFrom)
      return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_REPOSITORY };
    const asked = forkStart({
      draftId,
      fork,
      words,
      attachments,
      choice,
      disabledServers,
    });
    const answer = await askStart(startsOn, asked);
    if ("failure" in answer) return startFailureNote(answer, taskId ?? null);
    withDraft(startsOn, undefined);
    writer.drop((kept) => kept.kind === DRAFT_PLACE.NEW_AGENT && kept.draftId === draftId);
    landed(startsOn, answer.agent);
    return undefined;
  };

  // A refused Stop leaves the button as it was, so it says so in a toast.
  const onStop = async (agentId: string): Promise<void> => {
    const answer = await act(ACT_KIND.CODING_AGENTS_STOP, { agentId }).catch(() => undefined);
    if (answer !== undefined && !("failure" in answer)) {
      setList((was) =>
        was.agents === undefined
          ? was
          : { ...was, agents: withAgentRun(was.agents, agentId, answer.agent) },
      );
    } else {
      failed(STOP_FAILED);
    }
    readAgain();
  };

  const onRewind = useCallback(
    async (agentId: string, messageId: string): Promise<CodingAgentAgentAnswer> => {
      const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_REWIND, {
        agentId,
        messageId,
      }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      if (!("failure" in answer)) {
        setList((was) =>
          was.agents === undefined
            ? was
            : { ...was, agents: withAgentRun(was.agents, agentId, answer.agent) },
        );
      }
      return answer;
    },
    [act],
  );

  const onMessage = useCallback<MessageSender>(
    async (agentId, text, clientKey, attachments) => {
      // Note that a message that opens the agent's sandbox anew while its image is prepared is
      // taken at once, its relaunch waiting on the image in the service, so it is asked once.
      const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_MESSAGE, {
        agentId,
        text,
        clientKey,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      if (!("failure" in answer)) {
        setList((was) =>
          was.agents === undefined
            ? was
            : { ...was, agents: withAgentRun(was.agents, agentId, answer.agent) },
        );
      }
      return answer;
    },
    [act],
  );

  // Note that only the newest change of each agent's model is taken into the
  // list, because two changes may answer out of order and the older answer
  // would otherwise stand over the choice the developer made last.
  const chooses = useRef(new Map<string, number>());
  const onChoose = useCallback<ChoiceWriter>(
    async (agentId, choice) => {
      const change = (chooses.current.get(agentId) ?? 0) + 1;
      chooses.current.set(agentId, change);
      const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_CHOOSE, {
        agentId,
        ...choiceRequest(choice),
      }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      if (!("failure" in answer) && chooses.current.get(agentId) === change) {
        setList((was) =>
          was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
        );
      }
      return answer;
    },
    [act],
  );

  // Note that each agent's switches are sent one after another, each once the
  // one before it has answered, because a switch writes the whole list and two
  // writes in flight may land in either order, which would leave the service
  // holding the older list for the next turn. Only the newest switch's answer is
  // taken into the list, and only its refusal is said, in a toast, as the
  // switches fall back.
  const switches = useRef(new Map<string, { count: number; sent: Promise<unknown> }>());
  const onSwitchServers = useCallback<ServersWriter>(
    async (agentId, disabledServers) => {
      const before = switches.current.get(agentId);
      const change = (before?.count ?? 0) + 1;
      const sent = (before?.sent ?? Promise.resolve()).then(() =>
        act(ACT_KIND.CODING_AGENTS_SERVERS, { agentId, disabledServers }).catch(
          (): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
        ),
      );
      switches.current.set(agentId, { count: change, sent });
      const answer: CodingAgentAgentAnswer = await sent;
      if (switches.current.get(agentId)?.count !== change) return answer;
      if ("failure" in answer) {
        failed(SERVERS_FAILED);
        return answer;
      }
      setList((was) =>
        was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
      );
      return answer;
    },
    [act, failed],
  );

  // The agent as the views the control's presses reach carry it, before anything given here.
  const viewedAgent = (agentId: string) =>
    shown?.find((agent) => agent.id === agentId) ??
    viewedAgents?.find((agent) => agent.id === agentId);

  // A rename's field closes as the edit ends, and the new name is drawn at once, so a second
  // rename may be out before the first answers; as with a change of model, only the newest one's
  // answer is taken into the list, and only the newest one's refusal is said, in a toast, as the
  // name it replaced comes back.
  const renames = useRef(new Map<string, number>());
  const onRename = async (agentId: string, title: string): Promise<boolean> => {
    const rename = (renames.current.get(agentId) ?? 0) + 1;
    renames.current.set(agentId, rename);
    const asked = pendingValue(titles.get(agentId), title, viewedAgent(agentId)?.title, sameTitle);
    setTitles((was) => new Map(was).set(agentId, asked));
    const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_RENAME, {
      agentId,
      title,
    }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
    const newest = renames.current.get(agentId) === rename;
    if ("failure" in answer) {
      setTitles((was) => pendingWithout(was, agentId, asked));
      if (newest) failed(RENAME_FAILED);
      return false;
    }
    if (newest) {
      setList((was) =>
        was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
      );
    }
    return true;
  };

  // Note that the archive is read through a ref from its toast's Undo,
  // because the press lands renders after the toast was raised. The agent
  // moves at once, and back where the service refuses, unless a dialog that asked waits on it.
  const onArchive = async (
    agentId: string,
    archived: boolean,
    drawn: ArchiveDrawn = ARCHIVE_DRAWN.AT_ONCE,
  ): Promise<ActionResult> => {
    const asked = pendingValue(
      archives.get(agentId),
      archived ? Date.now() : null,
      archiveOf(viewedAgent(agentId)),
      sameArchive,
    );
    if (drawn === ARCHIVE_DRAWN.AT_ONCE) setArchives((was) => new Map(was).set(agentId, asked));
    const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_ARCHIVE, {
      agentId,
      archived,
    }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
    const words = archiveWords(archived);
    if ("failure" in answer) {
      setArchives((was) => pendingWithout(was, agentId, asked));
      const notReady = answer.failure === CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : words.refused,
      };
    }
    setList((was) =>
      was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
    );
    toast(undoToast(words.done, () => archiveNow.current(agentId, !archived).then(sayRefusal)));
    readAgain();
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const archiveNow = useRef(onArchive);
  archiveNow.current = onArchive;

  const onDelete = async (agentId: string): Promise<ActionResult> => {
    const answer = await act(ACT_KIND.CODING_AGENTS_DELETE, { agentId }).catch(() => ({
      failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
    }));
    if ("failure" in answer) {
      const notReady = answer.failure === CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : DELETE_WORDS.refused,
      };
    }
    setList((was) =>
      was.agents === undefined
        ? was
        : { ...was, agents: was.agents.filter((agent) => agent.id !== agentId) },
    );
    // Note that the list is read again, which drops a read already out that still holds the agent.
    readAgain();
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const sayRefusal = (result: ActionResult) => {
    if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) failed(result.reason);
  };

  const readAgent = useCallback(
    async (named: string): Promise<CodingAgentSummary | undefined> => {
      if (taskId === undefined && agentId === undefined) return undefined;
      const answer = await listRead(act, taskId, agentId).catch(() => undefined);
      if (answer === undefined || "failure" in answer) return undefined;
      // Note that the page's workspace, repository, and run come with the read, as the list's own read takes them.
      setList((was) =>
        ours(was)
          ? {
              taskId,
              agentId: listOf,
              agents: answer.agents,
              failed: false,
              workspaceId: answer.workspaceId,
              repository: answer.repository,
              origin: answer.origin,
            }
          : was,
      );
      return answer.agents.find((agent) => agent.id === named);
    },
    [act, taskId, agentId],
  );

  const onTitle = useCallback((agentId: string, title: string | null) => {
    if (!listedNow.current) heardOf(heardBeforeList.current.heard, agentId, { title });
    setList((was) =>
      was.agents === undefined ||
      !was.agents.some((agent) => agent.id === agentId && agent.title !== title)
        ? was
        : {
            ...was,
            agents: was.agents.map((agent) => (agent.id === agentId ? { ...agent, title } : agent)),
          },
    );
  }, []);

  // Every transcript page says where its agent stands, mostly as it stood:
  // the list is kept as it was then, so the window is not drawn again for it.
  const onStatus = useCallback((agentId: string, run: AgentRun) => {
    if (!listedNow.current) heardOf(heardBeforeList.current.heard, agentId, { run });
    setList((was) => {
      if (was.agents === undefined) return was;
      const agents = withAgentRun(was.agents, agentId, run);
      return agents === was.agents ? was : { ...was, agents };
    });
  }, []);

  const readTranscript = useCallback<TranscriptReader>(
    (params) => act(ACT_KIND.CODING_AGENTS_MESSAGES, params),
    [act],
  );

  const readCalls = useCallback<CallsReader>(
    (agentId) =>
      act(ACT_KIND.CODING_AGENTS_CALLS, { agentId }).catch(
        (): CodingAgentCallsAnswerView => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      ),
    [act],
  );

  const readPullRequestOnce = useCallback<PullRequestReader>(
    (agentId) => act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId }),
    [act],
  );
  // Note that an archived agent's pull request is read too, after every other agent's, since the
  // summary offers it as any other and the task list pushes none of an archived agent's.
  const published = useTaskPullRequests(taskId, held, readPullRequestOnce, held);

  // A pull request a tab names by its number is kept by agent and number,
  // apart from the agents' own, so it never stands for what an agent
  // published. Each read of one is numbered, so only the latest one's answer
  // is kept, and an older read landing late never takes back a newer one.
  const [numberedPullRequests, setNumberedPullRequests] = useState<
    ByPullRequestTab<CodingAgentPullRequest>
  >(() => new Map());
  const numberedAsks = useRef(new Map<string, Map<number, number>>());
  const readNumberedPullRequest = useCallback<CodingAgentsControl["readNumberedPullRequest"]>(
    (agentId, number) => {
      const ofAgent = numberedAsks.current.get(agentId) ?? new Map<number, number>();
      numberedAsks.current.set(agentId, ofAgent);
      const ask = (ofAgent.get(number) ?? 0) + 1;
      ofAgent.set(number, ask);
      return act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, pullRequestAsked(agentId, number)).then(
        (answer) => {
          if ("failure" in answer) return false;
          if (ofAgent.get(number) === ask) {
            const tab = { changes: agentId, number };
            setNumberedPullRequests((was) =>
              withPullRequestTab(was, tab, answer.pullRequest ?? undefined),
            );
          }
          return answer.pullRequest !== null;
        },
      );
    },
    [act],
  );

  // Note that who a pull request names is kept beside the agent, with the
  // pull request it was read for, so its Changes card says them wherever it
  // hangs once its tab has read them, and never for another pull request.
  // Each agent's reads are numbered, so only its newest read's answer is kept,
  // as the tab draws only its newest.
  const [changesPeople, setChangesPeople] = useState<ReadonlyMap<string, HeldPeople>>(
    () => new Map(),
  );
  const changesAsked = useRef(new Map<string, number>());
  const readChanges = useCallback<CodingAgentsControl["readChanges"]>(
    (agentId, number) => {
      // Note that another pull request's people are not this agent's, so they are never kept beside it.
      if (number !== undefined) {
        return act(ACT_KIND.CODING_AGENTS_CHANGES, pullRequestAsked(agentId, number));
      }
      const ask = (changesAsked.current.get(agentId) ?? 0) + 1;
      changesAsked.current.set(agentId, ask);
      return act(ACT_KIND.CODING_AGENTS_CHANGES, { agentId }).then((answer) => {
        if (changesAsked.current.get(agentId) !== ask || !("pullRequest" in answer)) return answer;
        const read = answer.pullRequest;
        setChangesPeople((was) => {
          const next = new Map(was);
          if (read === null) {
            next.delete(agentId);
          } else {
            const { url, files: _files, truncated: _truncated, ...people } = read;
            next.set(agentId, { url, people });
          }
          return next;
        });
        return answer;
      });
    },
    [act],
  );

  const readChapters = useCallback<CodingAgentsControl["readChapters"]>(
    (agentId, number) =>
      act(ACT_KIND.CHAPTERS_READ, pullRequestAsked(agentId, number)).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [act],
  );

  const generateChapters = useCallback<CodingAgentsControl["generateChapters"]>(
    (agentId, number) =>
      act(ACT_KIND.CHAPTERS_GENERATE, pullRequestAsked(agentId, number)).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [act],
  );

  const readOverviewPullRequest = useCallback<CodingAgentsControl["readOverviewPullRequest"]>(
    (agentId, number) =>
      act(ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST, pullRequestAsked(agentId, number)),
    [act],
  );

  const readReviewOptions = useCallback<CodingAgentsControl["readReviewOptions"]>(
    (agentId) => act(ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS, { agentId }),
    [act],
  );

  const readOverviewChecks = useCallback<CodingAgentsControl["readOverviewChecks"]>(
    (agentId, number) =>
      act(ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS, pullRequestAsked(agentId, number)),
    [act],
  );

  const readOverviewConversation = useCallback<CodingAgentsControl["readOverviewConversation"]>(
    (agentId, number) =>
      act(ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION, pullRequestAsked(agentId, number)),
    [act],
  );

  const readPullRequestViewed = useCallback<CodingAgentsControl["readPullRequestViewed"]>(
    (agentId, number) =>
      act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED, pullRequestAsked(agentId, number)),
    [act],
  );

  const inboxFollower = windowInboxFollower;

  const answerInbox = useCallback<InboxAnswerer>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_ANSWER, params),
    [act],
  );

  const messageInbox = useCallback<InboxMessenger>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, params),
    [act],
  );

  const startInboxThread = useCallback<InboxThreadStarter>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_START, params),
    [act],
  );

  // Note that the skills are kept for the plan and its repository as they
  // stand, so another plan, or the plan moved to another repository, reads
  // afresh; an agent no plan holds reads its repository's through the
  // workspace it belongs to, once the read of it has named that workspace.
  const workspaceId = ours(list) ? list.workspaceId : undefined;
  const agentRepository = ours(list) ? list.repository : undefined;
  // Note that a plan or an agent with no repository still reads its member's installed skills, and
  // that the plan's repository stays a dependency, so a plan moved to another repository reads afresh.
  const readSkills = useMemo(() => {
    if (taskId !== undefined) {
      return keptSkills(() => act(ACT_KIND.TASKS_SKILLS, { planId: taskId }));
    }
    if (workspaceId === undefined) return undefined;
    return keptSkills(() =>
      act(
        ACT_KIND.TASKS_SKILLS,
        agentRepository === undefined
          ? { workspaceId }
          : { workspaceId, repository: agentRepository },
      ),
    );
  }, [act, taskId, workspaceId, agentRepository, repository]);

  // A start reads the agents as they stand when it is pressed, so the doors to it stand across draws.
  const steadyStartPrompt = useSteadyDoor(startPrompt);
  const steadyStartFork = useSteadyDoor(startFork);
  const steadyContinueAgent = useSteadyDoor(continueAgent);

  const readInboxImage = useCallback<InboxImageReader>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT, params),
    [act],
  );

  // Handed back steady, so a part drawn from the agents holds while they do (`memo`).
  return useSteadyDoors({
    chatOn,
    agents,
    archived: archivedAgents,
    workspaceId,
    agentRepository,
    origin: ours(list) ? list.origin : undefined,
    agentIds,
    heldIds: held?.map((agent) => agent.id),
    draft,
    onNewDraft,
    onForkDraft,
    onContinueDraft,
    onDropFork,
    onDraftChange,
    onHandDraft,
    onTaskStarted,
    opening,
    onDraftAttachments,
    onDiscardDraft,
    startPrompt: steadyStartPrompt,
    startFork: steadyStartFork,
    listFailed,
    listMissing,
    onRetryList: readAgain,
    models,
    modelsFailed,
    readModels,
    readDefault,
    onUnarchive: undefined,
    continueAgent: startsFrom ? steadyContinueAgent : undefined,
    start: {
      available: taskId !== undefined && repository !== null,
      reason: startReason(taskId, repository),
      busy: starting,
      note: note !== undefined && note.taskId === taskId ? note.note : undefined,
      succeeded: startLanded,
      onPress: pressStart,
      pending: pressedHere,
    },
    startCall: taskId !== undefined ? startCall : undefined,
    onStop,
    onRewind,
    onMessage,
    onChoose,
    onSwitchServers,
    onOpenIntegrations: () => latest.current.onOpenIntegrations(),
    me: input.me,
    onOpenApiKeys: (provider) => latest.current.onOpenApiKeys(provider),
    pending: given,
    onRename,
    onArchive,
    onDelete,
    readAgent,
    onStatus,
    onTitle,
    readTranscript,
    readCalls,
    transcripts: windowTranscriptFollower,
    readPullRequest: published.read,
    pullRequests: published.pullRequests,
    numberedPullRequests,
    readNumberedPullRequest,
    readChanges,
    changesPeople,
    readChapters,
    generateChapters,
    readOverviewPullRequest,
    readReviewOptions,
    readOverviewChecks,
    readOverviewConversation,
    readPullRequestViewed,
    keywords: input.keywords ?? NO_KEYWORDS,
    readSkills,
    inboxFollower,
    answerInbox,
    messageInbox,
    startInboxThread,
    readInboxImage,
  });
}
