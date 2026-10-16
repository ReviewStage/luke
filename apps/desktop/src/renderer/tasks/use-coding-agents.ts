import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentChangesAnswerView,
  type CodingAgentDefaultAnswer,
  type CodingAgentListAnswer,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CONTEXT_WINDOW,
  type CodingAgentAttachment,
  type CodingAgentChangesPeople,
  type CodingAgentOrigin,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { ACT_KIND, type ActPayload } from "@luke/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActHandle } from "../act";
import {
  DRAFT_PLACE,
  type Draft,
  type KeptDraft,
  type NewAgentPlace,
  useDraftWriter,
  useNewAgentDraft,
} from "../composer-drafts";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import {
  type AgentRun,
  ARCHIVE_NOT_READY,
  archiveWords,
  choiceRequest,
  MODEL_CHANGE_FAILED,
  RENAME_FAILED,
  SERVERS_FAILED,
  START_ARCHIVED,
  START_FAILED_AWAY,
  START_NEEDS_REPOSITORY,
  STOP_FAILED,
  startFailureNote,
  withAgent,
  withAgentRun,
} from "./coding-agent-model";
import { keptSkills } from "./repository-skills";
import type { SkillSource } from "./skill-picker";
import type { MessageSender } from "./use-agent-composer";
import type { ChoiceWriter } from "./use-agent-model";
import { type PullRequestReader, useTaskPullRequests } from "./use-agent-pull-request";
import type { ServersWriter } from "./use-agent-servers";
import type { TranscriptReader } from "./use-agent-transcript";
import type { InboxAnswerer, InboxImageReader, InboxReader } from "./use-task-inbox";

/** No words to listen for, one array so a render that has none hands down the same one. */
const NO_KEYWORDS: readonly string[] = [];
/**
 * use-coding-agents.ts -- the open plan's coding agents as one control: the agents and their status, the Start button, a draft agent started on a prompt, the Stop, a message to one, a change of one's model, and the models the menus offer.
 *
 * The agents are read when a plan opens, again after a Start or a Stop,
 * and as the plan's column's "+" opens, and never on a clock; an agent's status moves between those reads only
 * as its own transcript page reports it, or as the service answers a
 * message to it, which is the agent running. A Start mints a key of its own
 * for the press, so a service that did not answer is asked again under the
 * same key on the next press of the same choice and answers the agent the
 * first press made rather than a second one; a press of another choice is
 * another request with a key of its own. The models the menu offers and
 * the account's default are read when the menu asks, so the menu shows the
 * catalog as it stands and the default the last change wrote; a model or
 * effort picked in the Start menu is written as the account's default, which
 * is what the next Start runs on; one picked on an agent's chip is written
 * on that agent alone, for its next step, and the agent the service answers
 * takes its place in the list, as does the agent a rename answers. A page
 * of an agent's transcript carries its title too, which is how the title
 * generated as the agent started reaches a tab the list opened before it
 * landed.
 *
 * A draft is an agent the developer opened from the column's "+" and has
 * not yet sent anything: it exists only here, so a draft let go leaves
 * nothing behind on the service. Its first message starts the agent with
 * those words as its task, in the plan's place, under the draft's own key,
 * so a send asked again after the service did not answer is the same
 * agent; the agent's tab then opens as a Start's does. Each plan has at
 * most one draft, held with the words written in it and the choice made on
 * its chip, so a draft keeps them while its tab is away and while the
 * developer visits another plan. Its words and files are the plan's kept
 * draft (`../composer-drafts.ts`), under the draft's key, so its words
 * outlast a relaunch too, and a plan holding them opens on its draft's tab
 * again, under the same key.
 *
 * An archived plan starts no agent and sends none a message: Start is
 * unavailable and says why, and `onUnarchive` stands, which every place
 * that would have taken words offers instead. An agent already running
 * finishes the turn it is on, so its Stop stays.
 *
 * An agent may be archived on its own, which the service does only once a
 * turn it still runs is stopped. The list is read with the archived agents
 * among the rest and split here: `agents` holds those standing, which is
 * every tab, row, and menu of the plan, and `archived` the rest, which the
 * summary keeps folded away with an Unarchive on each. The agent the
 * service answers moves between the two at once, and a toast offers Undo,
 * as an archived plan's does.
 */

/** Who an agent's pull request names, as its Changes tab last read them, and the pull request's page they were read for. */
export interface HeldPeople {
  readonly url: string;
  readonly people: CodingAgentChangesPeople;
}

/** Everything the Start button, the tabs, and the agent tab draw and press. */
export interface CodingAgentsControl {
  /** The signed-in account's id, whose own agents carry no "Started by"; none while signed out, or for an identity stored without one. */
  me: string | undefined;
  /** The open plan's agents in the order started, an archived one left out, or nothing before the first read lands. */
  agents: readonly CodingAgentSummary[] | undefined;
  /** The open plan's archived agents in the order started, or nothing before the first read lands. */
  archived: readonly CodingAgentSummary[] | undefined;
  /** The workspace the one agent read as its page belongs to; none on a plan, where the plan says it, and before the page's read lands. */
  workspaceId?: string | undefined;
  /** The repository of the one agent read as its page, `owner/name`, on the same terms as its workspace. */
  agentRepository?: string | undefined;
  /** The automation's run that started the one agent read as its page; none on a plan, for an agent started by hand, and before the page's read lands. */
  origin?: CodingAgentOrigin | undefined;
  /** The agent tabs the panel may show, by agent id; nothing before the first read lands. */
  agentIds: readonly string[] | undefined;
  /** Every agent of the plan by id, an archived one among them, which its Inbox stands on, since an archived agent's items still stand; nothing before the first read lands. */
  heldIds: readonly string[] | undefined;
  /** Whether the last read of the list did not land. */
  listFailed: boolean;
  /** Whether the last read answered that the agent read by its id is not there for the reader: deleted, or of a workspace they are not in. */
  listMissing: boolean;
  /** Reads the list again: after a read that failed, or as the column's "+" opens, so it says where each agent stands now. */
  onRetryList: () => void;
  /** The models the menu offers, as last read; nothing before the menu first asks. */
  models: readonly CatalogModel[] | undefined;
  /** Reads the models now, for a menu opening. */
  readModels: () => void;
  /** Reads the account's default now, for a menu opening or the Settings page. */
  readDefault: () => Promise<CodingAgentDefaultAnswer>;
  /** Keeps a choice as the account's default, which Start runs on; a write that did not take is said beside Start. */
  writeDefault: (choice: ModelChoice) => Promise<CodingAgentDefaultAnswer>;
  /** The open plan's draft agent; nothing while it has none. */
  draft: AgentDraft | undefined;
  /** Opens a draft agent on the open plan, or answers the one it has, by its key. */
  onNewDraft: () => string;
  /** Writes the open plan's draft: the words in its box, the choice on its chip, or the MCP servers it switched off. */
  onDraftChange: (
    change: Partial<Pick<AgentDraft, "prompt" | "choice" | "disabledServers">>,
  ) => void;
  /** Changes the open plan's draft's files from those it holds as the change lands. */
  onDraftAttachments: (
    next: (held: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => void;
  /** Lets the draft go; nothing was started, so nothing is left behind. */
  onDiscardDraft: (draftId: string) => void;
  /**
   * Starts the draft's agent with the words as its prompt, never the plan,
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
  /** Brings the open plan back from the archive; present exactly while it is archived, when nothing is started or sent on it. */
  onUnarchive: (() => void) | undefined;
  start: {
    /** Whether a Start could run now: the plan names a repository and is not archived. */
    available: boolean;
    /** Why it cannot, said on the button, while it cannot. */
    reason: string | undefined;
    /** Whether a Start is out. */
    busy: boolean;
    /** Why the last Start did not start, or the last change of model did not take, said beside the button until the next. */
    note: Failure | undefined;
    /** Starts an agent on the choice given, or on the account's default with none. */
    onPress: (choice?: ModelChoice) => void;
  };
  /** Stops one agent; the list is read again once the service answers. */
  onStop: (agentId: string) => Promise<void>;
  /** Sends one agent a message under the key the composer made, and takes the agent's status from the answer. */
  onMessage: MessageSender;
  /** Changes one agent's model and effort for its next step, and takes the agent as the service answers it. */
  onChoose: ChoiceWriter;
  /** Switches one agent's MCP servers for its next turn on, and takes the agent as the service answers it; a refusal is said in a toast. */
  onSwitchServers: ServersWriter;
  /** Opens Settings on its Integrations page, where an MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Coding agents page, where the developer's API keys are. */
  onOpenApiKeys: () => void;
  /** Renames one agent, taking the agent as the service answers it; answers whether the rename took. */
  onRename: (agentId: string, title: string) => Promise<boolean>;
  /**
   * Archives one agent, a turn it still runs stopped first, or brings it
   * back, taking the agent as the service answers it and offering Undo in a
   * toast; a refusal is answered rather than said, for the caller to say in
   * its dialog or a toast of its own.
   */
  onArchive: (agentId: string, archived: boolean) => Promise<ActionResult>;
  /** Reads the plan's agents again now, answering the one named as it stands, or nothing where the read did not land or holds no such agent. */
  readAgent: (agentId: string) => Promise<CodingAgentSummary | undefined>;
  /** An agent's transcript page said where it stands now. */
  onStatus: (agentId: string, run: AgentRun) => void;
  /** An agent's transcript page said what it is titled now, which the list read before the title landed did not. */
  onTitle: (agentId: string, title: string | null) => void;
  /** One read of an agent's transcript past a cursor, as the tab's loop asks it. */
  readTranscript: TranscriptReader;
  /** One read of what an agent published, as its tab asks it, its answer kept in `pullRequests`. */
  readPullRequest: PullRequestReader;
  /** Each of the plan's agents' pull requests, by agent, of those that have one (`useTaskPullRequests`). */
  pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** One read of an agent's changes, its pull request's files, as its Changes tab asks it, who it names kept in `changesPeople`. */
  readChanges: (agentId: string) => Promise<CodingAgentChangesAnswerView>;
  /** Who each agent's pull request names, by agent, as its Changes tab last read them, with the pull request they were read for; none for an agent whose changes were not read, or name no pull request. */
  changesPeople: ReadonlyMap<string, HeldPeople>;
  /** One read of an agent's pull request as its Pull request tab draws it: its description, checks, reviewers, and conversation. */
  readOverview: (agentId: string) => Promise<CodingAgentOverviewAnswerView>;
  /** The words a dictation into an agent's box is likely to say, read off the open plan. */
  keywords: readonly string[];
  /** The skills of the open plan's repository a `/` in an agent's box offers, read once for the plan (`repository-skills.ts`), or of the agent's own where no plan is open; nothing while neither names a repository. */
  readSkills: SkillSource | undefined;
  /** One read of a plan's inbox past a cursor, as the Inbox tab's loop asks it. */
  readInbox: InboxReader;
  /** One answer to an inbox item, as a card sends it. */
  answerInbox: InboxAnswerer;
  /** One read of an inbox item's image, as its card asks it. */
  readInboxImage: InboxImageReader;
}

/** An agent not yet started: the key its first message starts it under, the words written so far, the files attached to them, the choice made on its chip, none while it runs on the account's default, and the MCP servers switched off for it. */
export interface AgentDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
}

/** What a draft agent holds beside its words and files: its key, and what its chips chose. */
type DraftChoices = Pick<AgentDraft, "id" | "choice" | "disabledServers">;

/** The plan's draft agent: the key and chips held, with the words and files kept for it, or the words kept under their own key where nothing is held, as after a relaunch. */
function planDraft(
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
  };
}

/** A Start on its way or asked again: the plan, the key the press minted, and the choice it was for. */
interface PendingStart {
  taskId: string;
  key: string;
  choice: ModelChoice | undefined;
}

/** Why a Start cannot run on the open plan, while it cannot: an archive first, since unarchiving is what would be asked before any repository. */
function startReason(
  taskId: string | undefined,
  repository: string | null,
  archived: boolean,
): string | undefined {
  if (taskId === undefined) return undefined;
  if (archived) return START_ARCHIVED;
  return repository === null ? START_NEEDS_REPOSITORY : undefined;
}

/** A list as read: the plan's agents, or the one agent read as its page, with its workspace, its repository, and the run that started it. */
type PageList = CodingAgentListAnswer & {
  readonly workspaceId?: string;
  readonly repository?: string;
  readonly origin?: CodingAgentOrigin;
};

/**
 * The read a list is taken from: the plan's agents, archived ones among
 * them, where a plan is open, and else the one agent named, read as its
 * page and held as a list of one, with the workspace it belongs to.
 */
function listRead(
  act: ActHandle["act"],
  taskId: string | undefined,
  agentId: string | undefined,
): Promise<PageList> {
  if (taskId !== undefined) {
    return act(ACT_KIND.CODING_AGENTS_LIST, { taskId: taskId, includeArchived: true });
  }
  // Note that a page names no automation by null where a summary leaves the key out.
  return act(ACT_KIND.CODING_AGENTS_PAGE, { agentId: agentId ?? "" }).then((answer): PageList => {
    if ("failure" in answer) return answer;
    const { automationId, origin, ...agent } = answer.agent;
    return {
      agents: [automationId === null ? agent : { ...agent, automationId }],
      workspaceId: answer.agent.workspaceId,
      repository: answer.agent.repository,
      ...(origin === undefined ? undefined : { origin }),
    };
  });
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

export function useCodingAgents(input: {
  acts: Pick<ActHandle, "act">;
  /** The open plan, or none; a fixture run's plans have no agents. */
  taskId: string | undefined;
  /**
   * The one agent read by its id where no plan is open, as the agent page
   * reads an agent with no plan: the list holds that agent alone, so every
   * answer that moves it moves the page's agent too.
   */
  agentId?: string | undefined;
  /** The open plan's repository, or null while it names none. */
  repository: string | null;
  /** Whether the open plan is archived, which starts nothing on it. */
  archived: boolean;
  /** Brings the open plan back from the archive. */
  onUnarchive: () => void;
  /** Opens Settings on its Integrations page. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Coding agents page. */
  /** The signed-in account's id, whose own agents carry no "Started by". */
  me?: string | undefined;
  onOpenApiKeys: () => void;
  /** Called with the agent a Start made, so its tab opens. */
  onStarted: (agentId: string) => void;
  /** The words a dictation into an agent's box is likely to say; none where nothing is open. */
  keywords?: readonly string[];
  /** Mints one press's key. */
  mintKey?: () => string;
}): CodingAgentsControl {
  const { taskId, agentId, repository, archived } = input;
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
  const [starting, setStarting] = useState(false);
  // Each plan's draft's key and chip, by the plan's id; its words and files are kept apart.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftChoices>>(new Map());
  const heldDraft = taskId === undefined ? undefined : drafts.get(taskId);
  const keptDraft = useNewAgentDraft(taskId, heldDraft?.id);
  const writer = useDraftWriter();
  const draft = taskId === undefined ? undefined : planDraft(heldDraft, keptDraft);
  const [note, setNote] = useState<{ planId: string; note: Failure } | undefined>(undefined);
  const [reads, setReads] = useState(0);
  const pending = useRef<PendingStart | undefined>(undefined);
  const toast = useToast();
  const failed = useCallback(
    (words: string) => toast({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED }),
    [toast],
  );
  // Note that the acts and the opening are read through a ref, because the
  // tab hands new closures on every render and a read is owed to the plan
  // opening, not to a render.
  const latest = useRef(input);
  latest.current = input;

  // The list is this plan's: another plan's, or none, is nothing to draw.
  const held = ours(list) ? list.agents : undefined;
  const agents = useMemo(() => held?.filter((agent) => agent.archivedAt === undefined), [held]);
  const archivedAgents = useMemo(
    () => held?.filter((agent) => agent.archivedAt !== undefined),
    [held],
  );
  const listFailed = ours(list) && list.failed;
  const listMissing = ours(list) && list.missing === true;

  // Read when the plan opens, or the page's agent where no plan is, and again when a Start or a Stop asks (`reads`).
  useEffect(() => {
    if (taskId === undefined && agentId === undefined) return;
    let live = true;
    listRead(latest.current.acts.act, taskId, agentId).then(
      (answer) => {
        if (!live) return;
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
                agents: answer.agents,
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
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer: CodingAgentModelsAnswer) => {
        if (!("failure" in answer)) setModels(answer.models);
      },
      () => undefined,
    );
  }, [act]);

  const readDefault = useCallback(
    (): Promise<CodingAgentDefaultAnswer> =>
      act(ACT_KIND.CODING_AGENTS_DEFAULT_READ).catch(
        (): CodingAgentDefaultAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      ),
    [act],
  );

  const writeDefault = (choice: ModelChoice): Promise<CodingAgentDefaultAnswer> => {
    setNote(undefined);
    return act(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, choiceRequest(choice))
      .catch((): CodingAgentDefaultAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }))
      .then((answer) => {
        if ("failure" in answer && taskId !== undefined)
          setNote({
            planId: taskId,
            note: { reason: FAILURE_REASON.OTHER, text: MODEL_CHANGE_FAILED },
          });
        return answer;
      });
  };

  /** One Start asked of the service on the plan, held as under way until it answers. */
  const askStart = (
    on: string,
    asked: Omit<ActPayload<typeof ACT_KIND.CODING_AGENTS_START>, "taskId">,
  ): Promise<CodingAgentAgentAnswer> => {
    setStarting(true);
    return act(ACT_KIND.CODING_AGENTS_START, { taskId: on, ...asked })
      .catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }))
      .then((answer) => {
        setStarting(false);
        return answer;
      });
  };

  /** A Start that landed: the agent joins the list and its tab opens. Note that one landing after the developer left the plan opens no tab on the plan now open. */
  const landed = (on: string, agent: CodingAgentSummary) => {
    if (latest.current.taskId !== on) return;
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
    latest.current.onStarted(agent.id);
    readAgain();
  };

  const pressStart = (choice?: ModelChoice) => {
    if (taskId === undefined || repository === null || archived || starting) return;
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
    askStart(taskId, {
      idempotencyKey: key,
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    }).then((answer) => {
      if ("failure" in answer) {
        // Only a service that never answered is asked again under the same key.
        if (answer.failure !== CODING_AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;
        setNote({ planId: taskId, note: startFailureNote(answer, taskId) });
        // The note waits beside the plan's Start; a developer who left the
        // plan while it was out hears of it now.
        if (latest.current.taskId !== taskId) failed(START_FAILED_AWAY);
        return;
      }
      pending.current = undefined;
      landed(taskId, answer.agent);
    });
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

  /** The open plan's draft's words and files moved on from those kept for it. */
  const writeWords = (next: (was: Draft) => Draft) => {
    if (taskId === undefined || draft === undefined) return;
    writer.update({ kind: DRAFT_PLACE.NEW_AGENT, planId: taskId, draftId: draft.id }, next);
  };

  const onDraftChange = (
    change: Partial<Pick<AgentDraft, "prompt" | "choice" | "disabledServers">>,
  ) => {
    if (taskId === undefined || draft === undefined) return;
    const { prompt, ...choices } = change;
    if (prompt !== undefined) writeWords((was) => ({ ...was, text: prompt }));
    if (Object.keys(choices).length === 0) return;
    withDraft(taskId, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...choices,
    });
  };

  // Note that the files are changed from the draft as it stands when the
  // change lands, because a file's read lands after the render that began it.
  const onDraftAttachments = (
    next: (held: readonly CodingAgentAttachment[]) => readonly CodingAgentAttachment[],
  ) => writeWords((was) => ({ ...was, attachments: next(was.attachments) }));

  const onDiscardDraft = letGo;

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
    if (archived) return { reason: FAILURE_REASON.OTHER, text: START_ARCHIVED };
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

  const onMessage = useCallback<MessageSender>(
    async (agentId, text, clientKey, attachments) => {
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

  // A rename's field closes as the edit ends, so a second rename may be out before the first
  // answers; as with a change of model, only the newest one's answer is taken into the list,
  // and only the newest one's refusal is said, in a toast, as the old name comes back.
  const renames = useRef(new Map<string, number>());
  const onRename = useCallback(
    async (agentId: string, title: string) => {
      const rename = (renames.current.get(agentId) ?? 0) + 1;
      renames.current.set(agentId, rename);
      const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_RENAME, {
        agentId,
        title,
      }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      const newest = renames.current.get(agentId) === rename;
      if ("failure" in answer) {
        if (newest) failed(RENAME_FAILED);
        return false;
      }
      if (newest) {
        setList((was) =>
          was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
        );
      }
      return true;
    },
    [act, failed],
  );

  // Note that the archive is read through a ref from its toast's Undo,
  // because the press lands renders after the toast was raised.
  const onArchive = async (agentId: string, archived: boolean): Promise<ActionResult> => {
    const answer: CodingAgentAgentAnswer = await act(ACT_KIND.CODING_AGENTS_ARCHIVE, {
      agentId,
      archived,
    }).catch((): CodingAgentAgentAnswer => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
    const words = archiveWords(archived);
    if ("failure" in answer) {
      const notReady = answer.failure === CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : words.refused,
      };
    }
    setList((was) =>
      was.agents === undefined ? was : { ...was, agents: withAgent(was.agents, answer.agent) },
    );
    toast({
      words: words.done,
      tone: TOAST_TONE.DONE,
      action: {
        label: UNDO_LABEL,
        onPress: () => archiveNow.current(agentId, !archived).then(sayRefusal),
      },
    });
    readAgain();
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };
  const archiveNow = useRef(onArchive);
  archiveNow.current = onArchive;
  const sayRefusal = (result: ActionResult) => {
    if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) failed(result.reason);
  };

  const readAgent = useCallback(
    async (named: string): Promise<CodingAgentSummary | undefined> => {
      if (taskId === undefined && agentId === undefined) return undefined;
      const answer = await listRead(act, taskId, agentId).catch(() => undefined);
      if (answer === undefined || "failure" in answer) return undefined;
      setList((was) =>
        ours(was) ? { taskId, agentId: listOf, agents: answer.agents, failed: false } : was,
      );
      return answer.agents.find((agent) => agent.id === named);
    },
    [act, taskId, agentId],
  );

  const onTitle = useCallback((agentId: string, title: string | null) => {
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

  const onStatus = useCallback((agentId: string, run: AgentRun) => {
    setList((was) =>
      was.agents === undefined ? was : { ...was, agents: withAgentRun(was.agents, agentId, run) },
    );
  }, []);

  const readTranscript = useCallback<TranscriptReader>(
    (params) => act(ACT_KIND.CODING_AGENTS_MESSAGES, params),
    [act],
  );

  const readPullRequestOnce = useCallback<PullRequestReader>(
    (agentId) => act(ACT_KIND.CODING_AGENTS_PULL_REQUEST, { agentId }),
    [act],
  );
  const published = useTaskPullRequests(taskId, agents, readPullRequestOnce);

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
    (agentId) => {
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

  const readOverview = useCallback<CodingAgentsControl["readOverview"]>(
    (agentId) => act(ACT_KIND.CODING_AGENTS_OVERVIEW, { agentId }),
    [act],
  );

  const readInbox = useCallback<InboxReader>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );

  const answerInbox = useCallback<InboxAnswerer>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_ANSWER, params),
    [act],
  );

  // Note that the skills are kept for the plan and its repository as they
  // stand, so another plan, or the plan moved to another repository, reads
  // afresh; an agent no plan holds reads its repository's through the
  // workspace it belongs to, once the read of it has named that workspace.
  const workspaceId = ours(list) ? list.workspaceId : undefined;
  const agentRepository = ours(list) ? list.repository : undefined;
  const readSkills = useMemo(() => {
    if (taskId !== undefined) {
      return repository === null
        ? undefined
        : keptSkills(() => act(ACT_KIND.TASKS_SKILLS, { planId: taskId }));
    }
    if (workspaceId === undefined || agentRepository === undefined) return undefined;
    return keptSkills(() =>
      act(ACT_KIND.TASKS_SKILLS, { workspaceId, repository: agentRepository }),
    );
  }, [act, taskId, workspaceId, agentRepository, repository]);

  const readInboxImage = useCallback<InboxImageReader>(
    (params) => act(ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT, params),
    [act],
  );

  return {
    agents,
    archived: archivedAgents,
    workspaceId,
    agentRepository,
    origin: ours(list) ? list.origin : undefined,
    agentIds: agents?.map((agent) => agent.id),
    heldIds: held?.map((agent) => agent.id),
    draft,
    onNewDraft,
    onDraftChange,
    onDraftAttachments,
    onDiscardDraft,
    startPrompt,
    listFailed,
    listMissing,
    onRetryList: readAgain,
    models,
    readModels,
    readDefault,
    writeDefault,
    onUnarchive: taskId !== undefined && archived ? input.onUnarchive : undefined,
    start: {
      available: taskId !== undefined && repository !== null && !archived,
      reason: startReason(taskId, repository, archived),
      busy: starting,
      note: note !== undefined && note.planId === taskId ? note.note : undefined,
      onPress: pressStart,
    },
    onStop,
    onMessage,
    onChoose,
    onSwitchServers,
    onOpenIntegrations: () => latest.current.onOpenIntegrations(),
    me: input.me,
    onOpenApiKeys: () => latest.current.onOpenApiKeys(),
    onRename,
    onArchive,
    readAgent,
    onStatus,
    onTitle,
    readTranscript,
    readPullRequest: published.read,
    pullRequests: published.pullRequests,
    readChanges,
    changesPeople,
    readOverview,
    keywords: input.keywords ?? NO_KEYWORDS,
    readSkills,
    readInbox,
    answerInbox,
    readInboxImage,
  };
}
