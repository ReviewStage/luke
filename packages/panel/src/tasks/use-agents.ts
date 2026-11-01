import {
  AGENT_CALL_FAILURE,
  type AgentChangesAnswerView,
  type AgentDefaultAnswer,
  type AgentListAnswer,
  type AgentModelsAnswer,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentReviewOptionsAnswerView,
  ARCHIVE_DRAWN,
  type ArchiveDrawn,
} from "@luke/features/agent-view";
import {
  type AgentAttachment,
  type AgentChangesPeople,
  type AgentOrigin,
  type AgentPullRequest,
  type AgentSummary,
  CONTEXT_WINDOW,
  type TasklessAgent,
} from "@luke/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import type {
  CatalogModel,
  MacOffer,
  ModelChoice,
  ModelProvider,
} from "@luke/features/models-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import type { ListedPullRequest, TaskMode } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActPayload } from "@luke/host/contract";
import { EXPERIMENT } from "@luke/settings";
import { STATUS_TONE } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActedResult, type ActHandle, type AgentActAnswer, unreachedAs } from "../act.js";
import {
  DRAFT_PLACE,
  type Draft,
  type KeptDraft,
  type NewAgentPlace,
  useDraftWriter,
  useNewAgentDraft,
} from "../composer-drafts.js";
import type { ShownFailure } from "../failure-report.js";
import { rendererPause } from "../renderer-runtime.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { TOAST_HOLD, undoToast, useToast, useWithdrawToast } from "../toast.js";
import { useExperiment } from "../use-app-state.js";
import {
  ARCHIVE_NOT_READY,
  archiveWords,
  choiceRequest,
  continueFailureNote,
  DELETE_WORDS,
  openingLineOf,
  RENAME_FAILED,
  type RefusingDevice,
  SERVERS_FAILED,
  type SentLine,
  START_FAILED_AWAY,
  START_NEEDS_REPOSITORY,
  STOP_FAILED,
  startFailureNote,
} from "./agent-model.js";
import { type AgentFork, continueFork, forkStart } from "./fork-model.js";
import {
  type ByPullRequestTab,
  pullRequestAsked,
  withPullRequestTab,
} from "./pull-request-number.js";
import { keptSkills } from "./repository-skills.js";
import type { SkillSource } from "./skill-picker.js";
import type { MessageSender } from "./use-agent-composer.js";
import type { ChoiceWriter } from "./use-agent-model.js";
import { type PullRequestReader, useListedPullRequests } from "./use-agent-pull-request.js";
import type { ServersWriter } from "./use-agent-servers.js";
import {
  type TranscriptFollower,
  type TranscriptReader,
  windowTranscriptFollower,
} from "./use-agent-transcript.js";
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

/** Why a Start did not start, with the answer that said so, which a shown failure reports. */
type StartFailure = Failure & { readonly cause?: unknown };

/** An agent's act that never answered, settled as unanswered with the error beneath. */
const agentUnreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** No words to listen for, one array so a render that has none hands down the same one. */
const NO_KEYWORDS: readonly string[] = [];

/** How long a read of the models may stay out before it is said as failed, past the host's own ten-second bound on the call it makes. */
const MODELS_READ_BOUND_MS = 15_000;
/**
 * use-agents.ts -- the open task's coding agents as one control: the agents and their status, a Start, a draft agent started on a prompt, the Stop, a message to one, a change of one's model, and the models the menus offer.
 *
 * The agents are the task list's, followed live in the host, which carries
 * every agent of the task, archived ones among them, and draws a rename, an
 * archive, a change of model, or a switch of MCP servers the moment it is
 * asked, kept until the list carries it (`@luke/host`'s
 * `task-list-collections.ts`), and a Start's agent before the Start answers.
 * Where no task is open, the agent named is read as its own page, for its
 * workspace, its repository, and the run that started it, and the list's
 * row of it stands over that read once the list carries it. A Start mints a key of its own
 * for the press, so a service that did not answer is asked again under the
 * same key on the next press of the same choice and answers the agent the
 * first press made rather than a second one; a press of another choice is
 * another request with a key of its own. The models the menu offers and
 * the account's default are read when the menu asks, so the menu shows the
 * catalog as it stands and the default as Settings last wrote it; a model or
 * effort picked in the Start menu is what that button's next Start runs on,
 * never the account's default; one picked on an agent's chip is written
 * on that agent alone, for its next step.
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
 * and the model picked on New task's chip, where one was, with why
 * (`onHandDraft`), under the key that start carried, so its tab's Retry is
 * an agent's own Start on the task and answers the agent the first start
 * made where it made one.
 *
 * An agent may be archived on its own, which the service does only once a
 * turn it still runs is stopped. The archived agents are split from the
 * rest here: `agents` holds those standing, which is every tab, row, and
 * menu of the task, and `archived` the rest, which the summary keeps folded
 * away with an Unarchive on each. Once an archive lands, a toast offers Undo.
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
  readonly attachments: readonly AgentAttachment[];
  /** When Start was pressed, which the agent's first line is stamped with. */
  readonly sentAt: number;
}

/** The line an agent was started on, by the agent. */
interface OpeningLine {
  readonly agentId: string;
  readonly line: SentLine;
}

/** Who an agent's pull request names, as its Changes tab last read them, and the pull request's page they were read for. */
export interface HeldPeople {
  readonly url: string;
  readonly people: AgentChangesPeople;
}

/** Everything the "+" menu, the tabs, and the agent tab draw and press. */
export interface AgentsControl {
  /** The signed-in account's id, whose own agents carry no "Started by"; none while signed out, or for an identity stored without one. */
  me: string | undefined;
  /** The open task's agents in the order started, an archived one left out, or nothing before the task list carries the task. */
  agents: readonly AgentSummary[] | undefined;
  /** The open task's archived agents in the order started, or nothing before the task list carries the task. */
  archived: readonly AgentSummary[] | undefined;
  /** Every agent the followed task list carries, on any task or none, the archived ones among them, which names an agent of another task that wrote on the open task's plan; none where the list is not followed or does not list the open task. */
  listed?: readonly AgentSummary[] | undefined;
  /** The workspace the one agent read as its page belongs to; none on a task, where the task says it, and before the page's read lands. */
  workspaceId?: string | undefined;
  /** The repository of the one agent read as its page, `owner/name`, on the same terms as its workspace. */
  agentRepository?: string | undefined;
  /** The automation's run that started the one agent read as its page; none on a plan, for an agent started by hand, and before the page's read lands. */
  origin?: AgentOrigin | undefined;
  /** The agent tabs the panel may show, by agent id; nothing before the task list carries the task. */
  agentIds: readonly string[] | undefined;
  /** Every agent of the task by id, an archived one among them, which its Inbox stands on, since an archived agent's items still stand; nothing before the task list carries the task. */
  heldIds: readonly string[] | undefined;
  /** Whether the last read of the page's agent did not land, and the task list carries it not either. */
  listFailed: boolean;
  /** Whether the last read answered that the agent read by its id is not there for the reader: deleted, or of a workspace they are not in. */
  listMissing: boolean;
  /** Reads the page's agent again after a read that failed; a task's agents are the task list's, which follows itself. */
  onRetryList: () => void;
  /** The models the menu offers, as last read; nothing before the menu first asks. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the last read of the models did not land, so the menu says so with Retry rather than reading for ever. */
  modelsFailed: boolean;
  /** Where the newest read of the models stands, at the generation it took, which New task waits on. */
  modelsRead: ModelsRead;
  /** The member's devices a task's Runs on may name, as the last read of the models offered them: none listed where it offered none, and nothing before a read lands. */
  macs: readonly MacOffer[] | undefined;
  /** Reads the models now, for a menu opening or the menu's Retry. */
  readModels: () => void;
  /** Reads the account's default now, for a menu opening or the Settings page. */
  readDefault: () => Promise<AgentDefaultAnswer>;
  /** How the open task, or the page's agent's task, is worked, which says what its members start of their own (`startsOwnAgents`); none for an agent of no task, or before the task list names it. */
  mode: TaskMode | undefined;
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
    attachments: readonly AgentAttachment[],
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
  onTaskStarted: (taskId: string, agent: AgentSummary, words: StartedWords) => void;
  /** The first line of the agent New task last started, drawn as the developer's until its transcript reads a line of theirs back (`unreadOpeningLine`). */
  opening: OpeningLine | undefined;
  /** Changes the open task's draft's files from those it holds as the change lands. */
  onDraftAttachments: (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
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
    attachments: readonly AgentAttachment[],
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
    attachments: readonly AgentAttachment[],
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
    /** Starts an agent on the choice given, or on the account's default with none; answers why it did not start, with the answer that said so as its cause, or nothing once it did or while it could not be pressed. */
    onPress: (choice?: ModelChoice) => Promise<StartFailure | undefined>;
    /** The agent a Start on the open task is still making, its tab standing under the press's key until the service answers; none while none is out. */
    pending?: StartingAgent | undefined;
  };
  /** Stops one agent, answering whether the service took the Stop, which the task list then carries; a refusal is said in a toast. */
  onStop: (agentId: string) => Promise<boolean>;
  /** Takes one agent back to just before one of the developer's lines, stopping it first. */
  onRewind: (agentId: string, messageId: string) => Promise<AgentActAnswer>;
  /** Sends one agent a message under the key the composer made. */
  onMessage: MessageSender;
  /** Changes one agent's model and effort for its next step, drawn at once by the host. */
  onChoose: ChoiceWriter;
  /** Switches one agent's MCP servers for its next turn on, drawn at once by the host; a refusal is said in a toast. */
  onSwitchServers: ServersWriter;
  /** Opens Settings on its Integrations page, where an MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page at the provider's harness row, where the developer's key for it is; at the page's top where none is known. */
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  /** Whether an archive asked here is still out, the agent it took coming back should the service refuse it. */
  archiving: boolean;
  /** Renames one agent, drawn at once by the host; answers whether the rename took. */
  onRename: (agentId: string, title: string) => Promise<boolean>;
  /**
   * Archives one agent, a turn it still runs stopped first, or brings it
   * back, drawn at once by the host unless `drawn` waits on the answer, and
   * offering Undo in a toast; a refusal puts it back and is answered rather
   * than said, for the caller to say in its dialog or a toast of its own.
   */
  /** Archives or unarchives an agent, answering whether it was kept, with what refused it beneath a refusal. */
  onArchive: (agentId: string, archived: boolean, drawn?: ArchiveDrawn) => Promise<ActedResult>;
  /**
   * Deletes one agent for good, a turn it still runs stopped first, taking
   * it out of the list and saying so in a toast; a refusal is answered
   * rather than said, for the dialog that asked to say.
   */
  onDelete: (agentId: string) => Promise<ActedResult>;
  /** Reads one agent again now by its id, as its own page reads it, answering it as it stands, or nothing where the read did not land. */
  readAgent: (agentId: string) => Promise<AgentSummary | undefined>;
  /** One read of an agent's transcript past a cursor at once, as Copy transcript asks it. */
  readTranscript: TranscriptReader;
  /** How a shown tab follows its transcript and hears its pages pushed. */
  transcripts: TranscriptFollower;
  /** One read of what an agent published, as its tab asks it; the service writes what it found on the agent's row, which `pullRequests` then carries. */
  readPullRequest: PullRequestReader;
  /** Each of the task's agents' pull requests, by agent, of those that have one, as the task list carries them (`useListedPullRequests`). */
  pullRequests: ReadonlyMap<string, AgentPullRequest>;
  /** Each pull request a Pull request tab names by its number, by agent and then by number (`pull-request-number.ts`), as `readNumberedPullRequest` last read it. */
  numberedPullRequests: ByPullRequestTab<AgentPullRequest>;
  /** One read of the pull request of an agent's repository by its number, its answer kept in `numberedPullRequests`; whether it named one. */
  readNumberedPullRequest: (agentId: string, number: number) => Promise<boolean>;
  /** One read of an agent's changes, its pull request's files, as its Changes tab asks it, or of the pull request of its repository by the number given (`pull-request-number.ts`); who its own names kept in `changesPeople`. */
  readChanges: (agentId: string, number?: number) => Promise<AgentChangesAnswerView>;
  /**
   * One read of a pull request's chapters, as its Chapters tab asks it, by
   * the number its own read of the pull request found. Answers whether
   * chapters can be generated, and the workspace's newest chapters, whatever
   * head they were made for; or why there are none, a port that refused
   * included.
   */
  readChapters: (agentId: string, number: number) => Promise<PullRequestChaptersAnswerView>;
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
  ) => Promise<AgentOverviewPullRequestAnswerView>;
  /** One read of what the reviewer and label pickers of an agent's Pull request tab offer. */
  readReviewOptions: (agentId: string) => Promise<AgentReviewOptionsAnswerView>;
  /** One read of the checks on an agent's pull request's head, as its overview draws them. */
  readOverviewChecks: (agentId: string, number?: number) => Promise<AgentOverviewChecksAnswerView>;
  /** One read of an agent's pull request's conversation and where its reviewers stand, as its overview draws them. */
  readOverviewConversation: (
    agentId: string,
    number?: number,
  ) => Promise<AgentOverviewConversationAnswerView>;
  /** One read of which of an agent's pull request's files the member marked viewed on GitHub, on their own GitHub sign-in. */
  readPullRequestViewed: (
    agentId: string,
    number?: number,
  ) => Promise<AgentPullRequestViewedAnswerView>;
  /** The words a dictation into an agent's box is likely to say, read off the open task. */
  keywords: readonly string[];
  /** The skills of the open plan's repository a `/` in an agent's box offers, read once for the plan (`repository-skills.ts`), or of the agent's own where no plan is open; nothing while neither names a workspace, or while the Skills experiment is off. */
  readSkills: SkillSource | undefined;
  /** One answer to an inbox item, as a card sends it. */
  answerInbox: InboxAnswerer;
  /** One message on an inbox item's thread, as its box sends it. */
  messageInbox: InboxMessenger;
  /** One thread started with an agent, as an Inbox item's box sends it when its checkbox is ticked. */
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
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly fork?: AgentFork | undefined;
  /** Why the service refused the agent of a draft New task handed over (`onHandDraft`), which its tab shows under the box until the next send. */
  readonly refused?: Failure | undefined;
}

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

/** What New task hands a task it started whose agent was refused: the key that start carried, the prompt, its files, the choice picked on its chip, none where the chip was left on the account's default, which the draft's tab then reads afresh, and why. */
interface HandedDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
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
export function holdsNothing(draft: AgentDraft): boolean {
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
  attachments?: readonly AgentAttachment[],
) => Promise<Failure | undefined>;

/** A continue on its way or asked again: the task or the page's agent it was pressed on, the key the press minted, and the note and files it carried. */
interface PendingContinue {
  on: string;
  key: string;
  note: string | undefined;
  attachments: readonly AgentAttachment[];
}

/** Whether two presses carry the same files, the same ones in the same order. */
function sameFiles(a: readonly AgentAttachment[], b: readonly AgentAttachment[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

/** Why a Start cannot run on the open task, while it cannot: it names no repository. */
function startReason(taskId: string | undefined, repository: string | null): string | undefined {
  if (taskId === undefined) return undefined;
  return repository === null ? START_NEEDS_REPOSITORY : undefined;
}

/** A list as read: the plan's agents, or the one agent read as its page, with its workspace, its repository, and the run that started it. */
type PageList = AgentListAnswer & {
  readonly workspaceId?: string;
  readonly repository?: string;
  readonly origin?: AgentOrigin;
};

/**
 * The one agent named, read as its page and held as a list of one, with the
 * workspace it belongs to, its repository, and the run that started it.
 */
function pageRead(act: ActHandle["act"], agentId: string): Promise<PageList> {
  // Note that a page names no automation by null where a summary leaves the key out.
  return act(ACT_KIND.AGENTS_PAGE, { agentId }).then((answer): PageList => {
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
): Promise<AgentSummary | undefined> {
  return pageRead(act, agentId).then(
    (answer) => ("failure" in answer ? undefined : answer.agents[0]),
    () => undefined,
  );
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

/** Where the newest read of the models stands: none asked yet, under way, landed, or failed or out past its bound. */
export const MODELS_READ = {
  UNREAD: "unread",
  READING: "reading",
  READ: "read",
  FAILED: "failed",
} as const;

export type ModelsReadState = (typeof MODELS_READ)[keyof typeof MODELS_READ];

/**
 * The newest read of the models, stamped with the generation that read
 * took, so a reader can tell a read made since it looked from one before,
 * whatever the list it lands holds: two reads listing no device hand the
 * same empty list through the steady doors.
 */
export interface ModelsRead {
  readonly state: ModelsReadState;
  readonly generation: number;
}

export function useAgents(input: {
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
  /** How a task is worked, by its id, as the task list names it; none before the list names the task. */
  modeOf?: ((taskId: string) => TaskMode | undefined) | undefined;
  /**
   * Every agent the task list followed live carries, on a task or with
   * none, the archived ones among them; none where it is not followed, or
   * does not list the open task.
   */
  listedAgents?: readonly AgentSummary[] | undefined;
  /**
   * The page's agent as the task list carries it, with its workspace and
   * its repository, where the caller draws nothing of the run that started
   * it, which the agent's own read alone carries: the page is then not read.
   */
  listedPage?: Pick<TasklessAgent, "id" | "workspaceId" | "repository"> | undefined;
  /**
   * The pull request of every agent the task list followed live carries,
   * on a task or with none, the archived ones among them; none where it is
   * not followed.
   */
  listedPullRequests?: readonly ListedPullRequest[] | undefined;
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
  /** The device the open task runs its agents on, which a refused Start names; none for the cloud. */
  device?: RefusingDevice | undefined;
}): AgentsControl {
  const { taskId, agentId, repository } = input;
  const { act } = input.acts;
  const mintKey = input.mintKey ?? (() => crypto.randomUUID());
  // The page's one agent as read, held under the agent, so another agent's page holds nothing of the last.
  const [list, setList] = useState<{
    agentId: string | undefined;
    agents: readonly AgentSummary[] | undefined;
    failed: boolean;
    missing?: boolean;
    workspaceId?: string | undefined;
    repository?: string | undefined;
    origin?: AgentOrigin | undefined;
  }>({ agentId: undefined, agents: undefined, failed: false });
  // Note that an agent the list carries with its workspace and repository is not read as a page, so choosing it reads nothing.
  const listedPage =
    taskId === undefined && input.listedPage?.id === agentId ? input.listedPage : undefined;
  const listOf = taskId === undefined && listedPage === undefined ? agentId : undefined;
  const ours = (was: { agentId: string | undefined }) =>
    listOf !== undefined && was.agentId === listOf;
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [macs, setMacs] = useState<readonly MacOffer[] | undefined>(undefined);
  const [modelsRead, setModelsRead] = useState<ModelsRead>({
    state: MODELS_READ.UNREAD,
    generation: 0,
  });
  const modelsGeneration = useRef(0);
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
  const [reads, setReads] = useState(0);
  // The agent New task last started, its task, and the line it was started on.
  const [started, setStarted] = useState<
    { taskId: string; agent: AgentSummary; line: SentLine } | undefined
  >(undefined);
  const pending = useRef<PendingStart | undefined>(undefined);
  // The Start out now on a task, whose tab stands under its key until it answers.
  const [pressed, setPressed] = useState<{ taskId: string; starting: StartingAgent } | undefined>(
    undefined,
  );
  // Each agent continued's press, by the agent's id, held until its Start lands.
  const continues = useRef(new Map<string, PendingContinue>());
  const toast = useToast();
  const failed = useCallback(
    (words: string, failure: ShownFailure) =>
      toast({ words, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED, failure }),
    [toast],
  );
  // Note that the acts and the opening are read through a ref, because the
  // tab hands new closures on every render and a read is owed to the task
  // opening, not to a render.
  const latest = useRef(input);
  latest.current = input;

  // The page's read, or the agent New task just started on the open task, which stands until the
  // list carries it, so its tab draws at once.
  const read = ours(list) ? list.agents : undefined;
  const seed = useMemo(() => (started === undefined ? undefined : [started.agent]), [started]);
  const held = read ?? (taskId !== undefined && started?.taskId === taskId ? seed : undefined);
  const opening = useMemo(
    () => (started === undefined ? undefined : { agentId: started.agent.id, line: started.line }),
    [started],
  );
  // The task's agents as the followed task list carries them, or the page's agent; none where it carries neither.
  const { listedAgents } = input;
  const listedHere = useMemo(() => {
    if (taskId !== undefined) return listedAgents?.filter((agent) => agent.planId === taskId);
    const page = listedAgents?.filter((agent) => agent.id === agentId);
    return page?.length === 0 ? undefined : page;
  }, [listedAgents, taskId, agentId]);
  // Note that an agent the page's read or New task holds stands beside the list's until the list
  // first carries it, and leaves with it once it no longer does, so a tab never leaves between the two.
  const subject = taskId ?? agentId;
  const carried = useRef({ subject, ids: new Set<string>() });
  if (carried.current.subject !== subject) carried.current = { subject, ids: new Set() };
  for (const agent of listedHere ?? []) carried.current.ids.add(agent.id);
  const standing = useMemo(() => {
    if (listedHere === undefined) return held;
    const arriving = held?.filter((agent) => !carried.current.ids.has(agent.id)) ?? [];
    return arriving.length === 0 ? listedHere : [...listedHere, ...arriving];
  }, [listedHere, held]);
  const agents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt === undefined),
    [standing],
  );
  // Note that a Start out on the task stands among its tabs under the press's key, the task's
  // agents known or not, since it is the tab the press opens.
  const pressedHere = pressed?.taskId === taskId ? pressed?.starting : undefined;
  const agentIds = useMemo(() => {
    const ids = agents?.map((agent) => agent.id);
    return pressedHere === undefined ? ids : [...(ids ?? []), pressedHere.key];
  }, [agents, pressedHere]);
  const archivedAgents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt !== undefined),
    [standing],
  );
  // The task the agents stand on: the open one, or the page's agent's as the list or the page's own read names it.
  const modeTask = taskId ?? standing?.[0]?.planId ?? undefined;
  const mode = modeTask === undefined ? undefined : input.modeOf?.(modeTask);
  const listFailed = ours(list) && list.failed && listedHere === undefined;
  const listMissing = ours(list) && list.missing === true;
  // The archives asked here and still out.
  const [archivesOut, setArchivesOut] = useState(0);

  // The page's agent read as the page opens, where no task is, and again when a delete or a Retry asks (`reads`).
  useEffect(() => {
    if (listOf === undefined) return;
    let live = true;
    const kept = (was: typeof list) => (was.agentId === listOf ? was : undefined);
    pageRead(latest.current.acts.act, listOf).then(
      (answer) => {
        if (!live) return;
        setList((was) =>
          "failure" in answer
            ? {
                ...kept(was),
                agentId: listOf,
                agents: kept(was)?.agents,
                failed: true,
                missing: answer.failure === AGENT_CALL_FAILURE.NOT_FOUND,
              }
            : {
                agentId: listOf,
                agents: answer.agents,
                failed: false,
                workspaceId: answer.workspaceId,
                repository: answer.repository,
                origin: answer.origin,
              },
        );
      },
      () => {
        // A read that failed keeps the agent already drawn: its tab stands until a read lands.
        if (live)
          setList((was) => ({
            ...kept(was),
            agentId: listOf,
            agents: kept(was)?.agents,
            failed: true,
          }));
      },
    );
    return () => {
      live = false;
    };
  }, [listOf, reads]);

  const readAgain = useCallback(() => setReads((count) => count + 1), []);

  /**
   * Reads the models, stamping the read with a generation of its own. Note
   * that only the newest read settles where the read stands, though any read
   * that lands lists what it read, and that one still out past its bound is
   * said as failed, so nothing waits on it for ever; should it land after,
   * it settles as read.
   */
  const readModels = useCallback(() => {
    modelsGeneration.current += 1;
    const generation = modelsGeneration.current;
    const settle = (state: ModelsReadState) =>
      setModelsRead((was) =>
        was.generation === generation &&
        (state === MODELS_READ.READ || was.state === MODELS_READ.READING)
          ? { state, generation }
          : was,
      );
    // The menu reads again while a read is out, so a Retry shows its reading.
    setModelsRead({ state: MODELS_READ.READING, generation });
    act(ACT_KIND.AGENTS_MODELS).then(
      (answer: AgentModelsAnswer) => {
        if ("failure" in answer) return settle(MODELS_READ.FAILED);
        setModels(answer.models);
        setMacs(answer.macs ?? []);
        settle(MODELS_READ.READ);
      },
      () => settle(MODELS_READ.FAILED),
    );
    rendererPause(MODELS_READ_BOUND_MS).then(() => settle(MODELS_READ.FAILED));
  }, [act]);

  const readDefault = useCallback(
    (): Promise<AgentDefaultAnswer> =>
      act(ACT_KIND.AGENTS_DEFAULT_READ).catch(
        (): AgentDefaultAnswer => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
      ),
    [act],
  );

  /** One Start asked of the service on the task, or, from the page's agent, where that agent is, held as under way until it answers. */
  const askStart = (
    on: string,
    asked: Omit<PortActPayload<typeof ACT_KIND.AGENTS_START>, "taskId">,
  ): Promise<AgentActAnswer> => {
    setStarting(true);
    // Note that a Start from the page's agent names no task, so the service puts it where that agent is.
    const where = on === taskId ? { taskId: on } : undefined;
    return act(ACT_KIND.AGENTS_START, { ...where, ...asked })
      .catch(agentUnreached)
      .then((answer) => {
        setStarting(false);
        return answer;
      });
  };

  /**
   * A Start that landed: its tab opens on the agent the task list already
   * carries. Note that one landing after the developer left the task opens
   * no tab on the task now open.
   */
  const landed = (on: string, agent: AgentSummary) => {
    if ((latest.current.taskId ?? latest.current.agentId) !== on) return;
    latest.current.onStarted(agent.id);
  };

  const pressStart = async (choice?: ModelChoice): Promise<StartFailure | undefined> => {
    if (taskId === undefined || repository === null || starting) return undefined;
    // The key is the press's own, and a press asked again after the service
    // did not answer carries the one it minted, so the service answers the
    // agent it may already have started rather than a second one.
    const held = pending.current;
    const key =
      held !== undefined && held.taskId === taskId && sameChoice(held.choice, choice)
        ? held.key
        : mintKey();
    pending.current = { taskId, key, choice };
    // The agent's tab opens on the press, under its key, and gives way to the agent once it is made.
    setPressed({ taskId, starting: { key, model: choice?.model } });
    latest.current.onStarted(key);
    const answer = await askStart(taskId, {
      idempotencyKey: key,
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });
    setPressed((was) => (was?.starting.key === key ? undefined : was));
    if ("failure" in answer) {
      // Only a service that never answered is asked again under the same key.
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;
      return { ...startFailureNote(answer, taskId, input.device), cause: answer };
    }
    pending.current = undefined;
    landed(taskId, answer.agent);
    return undefined;
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
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) {
        continues.current.delete(sourceId);
      }
      if ((latest.current.taskId ?? latest.current.agentId) !== startsOn) {
        failed(START_FAILED_AWAY, {
          surface: FAILURE_SURFACE.AGENT_START,
          cause: answer,
          about: { agentId: sourceId },
        });
      }
      return continueFailureNote(answer, taskId ?? null);
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
    const source = standing?.find((agent) => agent.id === fork.agentId);
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
    attachments: readonly AgentAttachment[],
  ): string => {
    const joins = draft?.fork?.agentId === sourceId && draft.fork.messageId === undefined;
    const adds = words.trim() !== "" || attachments.length > 0;
    const id = joins && !adds && draft !== undefined ? draft.id : mintKey();
    if (startsOn === undefined) return id;
    const source = standing?.find((agent) => agent.id === sourceId);
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
  // answers. Until the task list carries its agent, the agent stands as its
  // task's, so its tab draws at once rather than after the list.
  const onTaskStarted = (on: string, agent: AgentSummary, words: StartedWords) => {
    setStarted({ taskId: on, agent, line: openingLineOf(words) });
  };

  // Note that the files are changed from the draft as it stands when the
  // change lands, because a file's read lands after the render that began it.
  const onDraftAttachments = (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
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
    attachments: readonly AgentAttachment[],
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
    if ("failure" in answer) return startFailureNote(answer, taskId, input.device);
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
    attachments: readonly AgentAttachment[],
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
  const onStop = async (agentId: string): Promise<boolean> => {
    const answer = await act(ACT_KIND.AGENTS_STOP, { agentId }).catch(agentUnreached);
    const took = !("failure" in answer);
    if (!took) {
      failed(STOP_FAILED, {
        surface: FAILURE_SURFACE.AGENT_STOP,
        cause: answer,
        about: { agentId },
      });
    }
    return took;
  };

  const onRewind = useCallback(
    (agentId: string, messageId: string): Promise<AgentActAnswer> =>
      act(ACT_KIND.AGENTS_REWIND, { agentId, messageId }).catch(agentUnreached),
    [act],
  );

  const onMessage = useCallback<MessageSender>(
    async (agentId, text, clientKey, attachments) => {
      // Note that a message that opens the agent's sandbox anew while its image is prepared is
      // taken at once, its relaunch waiting on the image in the service, so it is asked once.
      const answer: AgentActAnswer = await act(ACT_KIND.AGENTS_MESSAGE, {
        agentId,
        text,
        clientKey,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).catch(agentUnreached);
      return answer;
    },
    [act],
  );

  // A change of model is drawn by the host the moment it is asked, and taken back should the service refuse it.
  const onChoose = useCallback<ChoiceWriter>(
    (agentId, choice) =>
      act(ACT_KIND.AGENTS_CHOOSE, { agentId, ...choiceRequest(choice) }).catch(agentUnreached),
    [act],
  );

  // Note that the host sends each agent's switches one after another, in the
  // order asked, because a switch writes the whole list and two writes in
  // flight may land in either order. Only the newest switch's refusal is
  // said, in a toast, as the switches fall back.
  const switches = useRef(new Map<string, number>());
  const onSwitchServers = useCallback<ServersWriter>(
    async (agentId, disabledServers) => {
      const change = (switches.current.get(agentId) ?? 0) + 1;
      switches.current.set(agentId, change);
      const answer: AgentActAnswer = await act(ACT_KIND.AGENTS_SERVERS, {
        agentId,
        disabledServers,
      }).catch(agentUnreached);
      if ("failure" in answer && switches.current.get(agentId) === change) {
        failed(SERVERS_FAILED, {
          surface: FAILURE_SURFACE.AGENT_SERVERS,
          cause: answer,
          about: { agentId },
        });
      }
      return answer;
    },
    [act, failed],
  );

  // A rename's field closes as the edit ends, and the host draws the new name at once, so a second
  // rename may be out before the first answers; only the newest one's refusal is said, in a toast,
  // as the name it replaced comes back.
  const renames = useRef(new Map<string, number>());
  const onRename = async (agentId: string, title: string): Promise<boolean> => {
    const rename = (renames.current.get(agentId) ?? 0) + 1;
    renames.current.set(agentId, rename);
    const answer: AgentActAnswer = await act(ACT_KIND.AGENTS_RENAME, {
      agentId,
      title,
    }).catch(agentUnreached);
    if (!("failure" in answer)) return true;
    if (renames.current.get(agentId) === rename) {
      failed(RENAME_FAILED, {
        surface: FAILURE_SURFACE.AGENT_RENAME,
        cause: answer,
        about: { agentId },
      });
    }
    return false;
  };

  // Note that the archive is read through a ref from its toast's Undo,
  // because the press lands renders after the toast was raised. The host
  // draws the agent moved at once, and back where the service refuses,
  // unless a dialog that asked waits on it.
  const onArchive = async (
    agentId: string,
    archived: boolean,
    drawn: ArchiveDrawn = ARCHIVE_DRAWN.AT_ONCE,
  ): Promise<ActedResult> => {
    setArchivesOut((count) => count + 1);
    const answer: AgentActAnswer = await act(ACT_KIND.AGENTS_ARCHIVE, {
      agentId,
      archived,
      ...(drawn === ARCHIVE_DRAWN.ON_ANSWER ? { drawn } : undefined),
    })
      .catch(agentUnreached)
      .finally(() => setArchivesOut((count) => count - 1));
    const words = archiveWords(archived);
    if ("failure" in answer) {
      const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : words.refused,
        cause: answer,
      };
    }
    toast(
      undoToast(words.done, () =>
        archiveNow.current(agentId, !archived).then((result) => sayRefusal(result, agentId)),
      ),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const archiveNow = useRef(onArchive);
  archiveNow.current = onArchive;

  const onDelete = async (agentId: string): Promise<ActedResult> => {
    const answer = await act(ACT_KIND.AGENTS_DELETE, { agentId }).catch(agentUnreached);
    if ("failure" in answer) {
      const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : DELETE_WORDS.refused,
        cause: answer,
      };
    }
    // Note that a page's agent is read again, which drops a read already out that still holds it.
    readAgain();
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const sayRefusal = (result: ActionResult, agentId: string) => {
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    failed(result.reason, {
      surface: FAILURE_SURFACE.AGENT_ARCHIVE,
      cause: result,
      about: { agentId },
    });
  };

  const readAgent = useCallback((named: string) => readAgentById(act, named), [act]);

  const readTranscript = useCallback<TranscriptReader>(
    (params) => act(ACT_KIND.AGENTS_MESSAGES, params),
    [act],
  );

  const readPullRequest = useCallback<PullRequestReader>(
    (agentId) => act(ACT_KIND.AGENTS_PULL_REQUEST, { agentId }),
    [act],
  );
  // Note that every agent's pull request, an archived one's among them, is the task list's, so
  // choosing a task, or the page of an agent on none, reads none of them.
  const pullRequests = useListedPullRequests(
    input.listedPullRequests,
    taskId !== undefined ? { taskId } : agentId !== undefined ? { agentId } : undefined,
  );

  // A pull request a tab names by its number is kept by agent and number,
  // apart from the agents' own, so it never stands for what an agent
  // published. Each read of one is numbered, so only the latest one's answer
  // is kept, and an older read landing late never takes back a newer one.
  const [numberedPullRequests, setNumberedPullRequests] = useState<
    ByPullRequestTab<AgentPullRequest>
  >(() => new Map());
  const numberedAsks = useRef(new Map<string, Map<number, number>>());
  const readNumberedPullRequest = useCallback<AgentsControl["readNumberedPullRequest"]>(
    (agentId, number) => {
      const ofAgent = numberedAsks.current.get(agentId) ?? new Map<number, number>();
      numberedAsks.current.set(agentId, ofAgent);
      const ask = (ofAgent.get(number) ?? 0) + 1;
      ofAgent.set(number, ask);
      return act(ACT_KIND.AGENTS_PULL_REQUEST, pullRequestAsked(agentId, number)).then((answer) => {
        if ("failure" in answer) return false;
        if (ofAgent.get(number) === ask) {
          const tab = { changes: agentId, number };
          setNumberedPullRequests((was) =>
            withPullRequestTab(was, tab, answer.pullRequest ?? undefined),
          );
        }
        return answer.pullRequest !== null;
      });
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
  const readChanges = useCallback<AgentsControl["readChanges"]>(
    (agentId, number) => {
      // Note that another pull request's people are not this agent's, so they are never kept beside it.
      if (number !== undefined) {
        return act(ACT_KIND.AGENTS_CHANGES, pullRequestAsked(agentId, number));
      }
      const ask = (changesAsked.current.get(agentId) ?? 0) + 1;
      changesAsked.current.set(agentId, ask);
      return act(ACT_KIND.AGENTS_CHANGES, { agentId }).then((answer) => {
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

  const readChapters = useCallback<AgentsControl["readChapters"]>(
    (agentId, number) =>
      act(ACT_KIND.CHAPTERS_READ, { agentId, number }).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [act],
  );

  const generateChapters = useCallback<AgentsControl["generateChapters"]>(
    (agentId, number) =>
      act(ACT_KIND.CHAPTERS_GENERATE, pullRequestAsked(agentId, number)).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [act],
  );

  const readOverviewPullRequest = useCallback<AgentsControl["readOverviewPullRequest"]>(
    (agentId, number) =>
      act(ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST, pullRequestAsked(agentId, number)),
    [act],
  );

  const readReviewOptions = useCallback<AgentsControl["readReviewOptions"]>(
    (agentId) => act(ACT_KIND.AGENTS_REVIEW_OPTIONS, { agentId }),
    [act],
  );

  const readOverviewChecks = useCallback<AgentsControl["readOverviewChecks"]>(
    (agentId, number) => act(ACT_KIND.AGENTS_OVERVIEW_CHECKS, pullRequestAsked(agentId, number)),
    [act],
  );

  const readOverviewConversation = useCallback<AgentsControl["readOverviewConversation"]>(
    (agentId, number) =>
      act(ACT_KIND.AGENTS_OVERVIEW_CONVERSATION, pullRequestAsked(agentId, number)),
    [act],
  );

  const readPullRequestViewed = useCallback<AgentsControl["readPullRequestViewed"]>(
    (agentId, number) =>
      act(ACT_KIND.AGENTS_PULL_REQUEST_VIEWED, pullRequestAsked(agentId, number)),
    [act],
  );

  const answerInbox = useCallback<InboxAnswerer>(
    (params) => act(ACT_KIND.AGENTS_INBOX_ANSWER, params),
    [act],
  );

  const messageInbox = useCallback<InboxMessenger>(
    (params) => act(ACT_KIND.AGENTS_INBOX_MESSAGE, params),
    [act],
  );

  const startInboxThread = useCallback<InboxThreadStarter>(
    (params) => act(ACT_KIND.AGENTS_INBOX_START, params),
    [act],
  );

  // Note that the skills are kept for the plan and its repository as they
  // stand, and the host keeps each one's for the session (`compose-tasks.ts`),
  // so choosing the plan again reads none; another plan, or the plan moved to
  // another repository, is another one. An agent no plan holds reads its
  // repository's through the workspace it belongs to, once the list or the
  // read of it has named that workspace.
  const workspaceId = ours(list) ? list.workspaceId : listedPage?.workspaceId;
  const agentRepository = ours(list) ? list.repository : (listedPage?.repository ?? undefined);
  // Note that a plan or an agent with no repository still reads its member's installed skills, and
  // that the plan's repository stays a dependency, so a plan moved to another repository reads afresh.
  // While the Skills experiment is off, no box offers a skill and no sent message draws one.
  const skillsOn = useExperiment(EXPERIMENT.SKILLS);
  const readSkills = useMemo(() => {
    if (!skillsOn) return undefined;
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
  }, [act, skillsOn, taskId, workspaceId, agentRepository, repository]);

  // A start reads the agents as they stand when it is pressed, so the doors to it stand across draws.
  const steadyStartPrompt = useSteadyDoor(startPrompt);
  const steadyStartFork = useSteadyDoor(startFork);
  const steadyContinueAgent = useSteadyDoor(continueAgent);

  const readInboxImage = useCallback<InboxImageReader>(
    (params) => act(ACT_KIND.AGENTS_INBOX_ATTACHMENT, params),
    [act],
  );

  // Handed back steady, so a part drawn from the agents holds while they do (`memo`).
  return useSteadyDoors({
    agents,
    archived: archivedAgents,
    listed: listedAgents,
    workspaceId,
    agentRepository,
    origin: ours(list) ? list.origin : undefined,
    agentIds,
    heldIds: standing?.map((agent) => agent.id),
    mode,
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
    modelsFailed: modelsRead.state === MODELS_READ.FAILED,
    modelsRead,
    macs,
    readModels,
    readDefault,
    onUnarchive: undefined,
    continueAgent: startsFrom ? steadyContinueAgent : undefined,
    start: {
      available: taskId !== undefined && repository !== null,
      reason: startReason(taskId, repository),
      busy: starting,
      onPress: pressStart,
      pending: pressedHere,
    },
    onStop,
    onRewind,
    onMessage,
    onChoose,
    onSwitchServers,
    onOpenIntegrations: () => latest.current.onOpenIntegrations(),
    me: input.me,
    onOpenApiKeys: (provider) => latest.current.onOpenApiKeys(provider),
    archiving: archivesOut > 0,
    onRename,
    onArchive,
    onDelete,
    readAgent,
    readTranscript,
    transcripts: windowTranscriptFollower,
    readPullRequest,
    pullRequests,
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
    answerInbox,
    messageInbox,
    startInboxThread,
    readInboxImage,
  });
}
