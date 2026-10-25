/**
 * inbox-compose.tsx -- the Inbox's New thread: a thread the reader starts with one agent, as a new mail is written, in the reading pane.
 *
 * The pane stands where an item's would, under a bar of its own: To, the
 * agent the thread goes to, picked from the workspace's agents; Subject,
 * the thread's title, which may be left empty for the service to take the
 * message's first line for it; and the box an item's reply is written in, words,
 * mentions, and files. Send starts the thread, which the service writes
 * under a key of its own and hands to the agent as a message on it, and
 * the Inbox then opens the thread in the pane's place. A send that is not
 * taken leaves everything written where it was, with why under the box,
 * and one sent again with nothing changed goes under the same key, so it
 * starts one thread however often it is pressed.
 *
 * What is written is a draft of the workspace's Inbox (`composer-drafts.ts`),
 * so a row pressed, a relaunch, or another item chosen leaves it where it was
 * for the next New thread. Discard lets it go at once and offers Undo, which
 * opens New thread again holding it. The box takes files dropped on it as an
 * item's does, and its `@` and `/` offer what the workspace holds and the
 * skills of the agent To names, read through its task where it has one.
 */

import type { CodingAgentInboxMessagedView } from "@luke/features/coding-agent-view";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { INBOX_BOUNDS, type InboxItem } from "@luke/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { pasteCutWords, readFailedWords, readingWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  CHIP_WIDTH,
  ErrorState,
  FormField,
  IconButton,
  matchingRows,
  POPOVER_ALIGN,
  Spinner,
  TEXT_FIELD_SIZE,
  TextField,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  TrashIcon,
} from "@luke/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import {
  DRAFT_PLACE,
  type Draft,
  EMPTY_DRAFT,
  type NewThreadPlace,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { PhoneHead } from "../desktop/phone-head.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { Picker } from "../settings/picker-row.js";
import { undoToast, useToast } from "../toast.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { COMPOSER_ROOM_CLASS } from "./agent-composer.js";
import { type AgentRowPlace, agentMenuRow, useAgentRowPlace } from "./agent-menu-row.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { messageFailureWords } from "./coding-agent-model.js";
import { AnswerForm, EDITOR_LOAD_FAILED, useAnswerField } from "./inbox-answer-box.js";
import type { MentionDoors } from "./mention-chip.js";
import type { MentionAgentsReader, MentionableAgent } from "./mention-picker.js";
import { keptSkills } from "./repository-skills.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, tasklessMentions } from "./task-mentions.js";
import type { InboxThreadStarter } from "./use-task-inbox.js";

/** The pane's name, as its bar and a reader say it. */
export const NEW_THREAD = "New thread";

const TO = "To";
const SUBJECT = "Subject";
const DISCARD = "Discard";
const NO_AGENT = "Choose an agent";
const NO_MATCH = "No agent matches";
const NO_AGENTS = "No agents in this workspace yet.";
const AGENTS_FAILED = readFailedWords("the workspace's agents");
const AGENT_SEARCH_FAILED = readFailedWords("the search for agents");
const INBOX = "Inbox";
const INBOX_PLACE = "inbox";
const DISCARDED = "Draft discarded";

/** The workspace's agents as To offers them: read, failed, or not yet read. */
type AgentsRead = { readonly agents: readonly MentionableAgent[] } | { readonly failed: true };

/**
 * The agents picked in this window, by their ids. Note that a draft keeps
 * only its agent's id, and the workspace's newest may not hold one a search
 * found, so the agent itself is kept here for To to name when the draft is
 * opened again.
 */
const pickedAgents = new Map<string, MentionableAgent>();

/** A started thread, and the agent it went to, whose task the Inbox opens it under. */
interface InboxStarted {
  readonly item: InboxItem;
  readonly agent: MentionableAgent;
}

/** The workspace whose Inbox the thread is written in, by its id and as a link names it. */
interface ComposeWorkspace {
  readonly workspace: string;
  readonly workspaceId: string;
}

/** What the pane is handed: where it stands, how it reads the agents and sends, and what follows a send, a discard, or its Undo. */
export interface InboxComposeProps {
  readonly hidden: boolean;
  /** The workspace the Inbox lists, whose draft the pane holds; none before the workspaces are read. */
  readonly workspace: ComposeWorkspace | undefined;
  /** The repository of a task of the workspace, which an agent's `@` reads files from; null where it names none. */
  readonly repositoryOf: (taskId: string) => string | null;
  readonly onShowMention: MentionDoors["onOpenTask"];
  /** The way back to the list, where the Inbox shows one column; none where the list stands beside it. */
  readonly onBack: (() => void) | undefined;
  /** Reads the workspace's agents To offers; none where no workspace is known. */
  readonly readAgents: MentionAgentsReader | undefined;
  /** The agent To names as the pane opens, the one the reader was reading; none where they read none. */
  readonly to: string | undefined;
  readonly keywords: readonly string[];
  readonly start: InboxThreadStarter;
  readonly onStarted: (started: InboxStarted) => void;
  readonly onDiscard: () => void;
  /** Opens New thread again, as Discard's Undo does. */
  readonly onRestore: () => void;
  /** Whether a phone heads the pane (`phone-head.tsx`): the way back's glyph, the title centred, and Discard's glyph. */
  readonly phone?: boolean | undefined;
}

/** The agents To may name: those not archived, since none of them hears a thread. */
function heard(agents: readonly MentionableAgent[]): readonly MentionableAgent[] {
  return agents.filter((each) => each.archived !== true);
}

/**
 * The agents To lists: the workspace's newest, as read when the pane
 * opened, while nothing is typed; once a word is, those of the newest
 * whose rows hold every word, as the menu itself would match them, then
 * those the service found for it that are not among them already, the last
 * answer standing until the next lands, as the `@` menu's do. Note that the
 * newest are matched here too, because the service matches an agent by its
 * title and its task, not by a name its row takes from its model.
 */
function listedAgents(
  read: AgentsRead | undefined,
  found: readonly MentionableAgent[] | undefined,
  words: string,
  place: AgentRowPlace,
): readonly MentionableAgent[] {
  const newest = read !== undefined && "agents" in read ? read.agents : [];
  if (words === "") return newest;
  const matched = new Set(
    matchingRows(
      newest.map((each) => agentMenuRow(each, place)),
      words,
    ).map((row) => row.id),
  );
  return [
    ...newest.filter((each) => matched.has(each.id)),
    ...(found ?? []).filter((each) => !matched.has(each.id)),
  ];
}

/** The words a send is known by, so the same thread sent again goes under the key it went under. */
function sendWords(agentId: string, draft: Draft): string {
  return JSON.stringify([agentId, subjectOf(draft), draft.text.trim(), draft.attachments]);
}

/** The draft's Subject, as a send carries it. */
function subjectOf(draft: Draft): string {
  return (draft.title ?? "").trim();
}

/** Whether a draft holds anything Discard would lose. */
function written(draft: Draft): boolean {
  return draft.text !== "" || (draft.title ?? "") !== "" || draft.attachments.length > 0;
}

/** Where New thread's draft is kept: the workspace whose Inbox it is written in. */
function threadPlace(workspace: ComposeWorkspace | undefined): NewThreadPlace {
  return { kind: DRAFT_PLACE.NEW_THREAD, workspaceId: workspace?.workspaceId ?? null };
}

/** The agent an id names, as this window picked it or the workspace's newest hold it. */
function agentOf(
  read: AgentsRead | undefined,
  id: string | undefined,
): MentionableAgent | undefined {
  if (id === undefined) return undefined;
  const newest = read !== undefined && "agents" in read ? read.agents : [];
  return pickedAgents.get(id) ?? newest.find((agent) => agent.id === id);
}

/** What To offers and names, which the pane reads as it opens and as a word is typed in its search. */
interface ComposeTo {
  readonly read: AgentsRead | undefined;
  readonly listed: readonly MentionableAgent[];
  readonly asked: string;
  readonly agent: MentionableAgent | undefined;
  /** Whether the search for the word typed did not answer, which To says with Retry, never as no match. */
  readonly searchFailed: boolean;
  /** Reads the agents again, and the search with them. */
  readonly onRetry: () => void;
  readonly onSearch: (words: string) => void;
  readonly onPick: (agent: MentionableAgent) => void;
}

/**
 * The pane: To, Subject, and the box, under the bar that names it. Note
 * that the agent To names is settled here, over the card, because the
 * box's `@` and `/` read what it offers from the providers around the card,
 * which name that agent's task.
 */
export function InboxCompose(props: InboxComposeProps): React.JSX.Element {
  const { workspace, repositoryOf, onShowMention, readAgents, to } = props;
  const { act } = useAct();
  const [read, setRead] = useState<AgentsRead | undefined>(undefined);
  // The agents the last search found, standing until the next answers.
  const [found, setFound] = useState<readonly MentionableAgent[] | undefined>(undefined);
  const [searchFailed, setSearchFailed] = useState(false);
  // Each press of Retry reads the agents again, and the search with them.
  const [reads, setReads] = useState(0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MentionableAgent | undefined>(undefined);
  const { draft, update } = useDraft(threadPlace(workspace));
  // Words written before the workspaces were read become the workspace's draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(threadPlace(undefined)).draft;
  const writer = useDraftWriter();
  const knownId = workspace?.workspaceId;
  useEffect(() => {
    if (knownId === undefined || !written(loose)) return;
    writer.update({ kind: DRAFT_PLACE.NEW_THREAD, workspaceId: knownId }, () => loose);
    writer.update(threadPlace(undefined), () => EMPTY_DRAFT);
  }, [knownId, loose, writer]);
  const place = useAgentRowPlace();
  // Note that a draft's own agent outranks the item read as it opened, and one it names that this window cannot name leaves To to be chosen again.
  const agent = picked ?? (draft.to === undefined ? agentOf(read, to) : agentOf(read, draft.to));
  // What the box's `@` and `/` offer: the workspace's, with the files and skills of the task of the agent To names.
  const taskId = agent?.task?.id;
  const repository = taskId === undefined ? null : repositoryOf(taskId);
  const workspaceSlug = workspace?.workspace;
  const workspaceId = workspace?.workspaceId;
  const mentions = useMemo(
    () =>
      workspaceSlug === undefined || workspaceId === undefined
        ? undefined
        : tasklessMentions(
            { workspace: workspaceSlug, workspaceId, repository },
            onShowMention,
            readAgents,
          ),
    [workspaceSlug, workspaceId, repository, onShowMention, readAgents],
  );
  const skills = useMemo(
    () =>
      workspaceId === undefined
        ? undefined
        : keptSkills(() =>
            act(ACT_KIND.TASKS_SKILLS, taskId === undefined ? { workspaceId } : { planId: taskId }),
          ),
    [act, workspaceId, taskId],
  );
  // A skill's chip opens its `SKILL.md` on GitHub, as New task's does, since no File tab stands here.
  const openSkill = (skill: SkillWithFile) => {
    if (mentions === undefined || repository === null) return;
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };
  // The agents are read as the pane opens, and again at each Retry.
  useEffect(() => {
    if (readAgents === undefined) return;
    let live = true;
    setRead(undefined);
    readAgents(undefined).then(
      (agents) => {
        if (live) setRead({ agents: heard(agents) });
      },
      () => {
        if (live) setRead({ failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [readAgents, reads]);
  // Once a word is typed the service finds the agents it names, however many the workspace holds.
  const asked = query.trim();
  useEffect(() => {
    if (readAgents === undefined || asked === "") return;
    let live = true;
    setSearchFailed(false);
    readAgents(asked).then(
      (agents) => {
        if (!live) return;
        setSearchFailed(false);
        setFound(heard(agents));
      },
      () => {
        if (!live) return;
        setSearchFailed(true);
        setFound(undefined);
      },
    );
    return () => {
      live = false;
    };
  }, [readAgents, asked, reads]);
  const composeTo: ComposeTo = {
    read,
    listed: listedAgents(read, found, asked, place),
    asked,
    agent,
    searchFailed: asked !== "" && searchFailed,
    onRetry: () => setReads((count) => count + 1),
    onSearch: setQuery,
    onPick: (pick) => {
      pickedAgents.set(pick.id, pick);
      setPicked(pick);
      update((was) => ({ ...was, to: pick.id }));
    },
  };
  return (
    <TaskMentions value={mentions}>
      <SkillFiles source={skills} onOpen={openSkill}>
        <ComposeCard
          {...props}
          composeTo={composeTo}
          draft={draft}
          update={update}
          skills={skills}
        />
      </SkillFiles>
    </TaskMentions>
  );
}

/** The card under the providers: the bar, To, Subject, and the box, and what a send, a discard, or a file does to the draft. */
function ComposeCard({
  hidden,
  onBack,
  keywords,
  start,
  onStarted,
  onDiscard,
  onRestore,
  phone = false,
  composeTo,
  draft,
  update,
  skills,
}: InboxComposeProps & {
  readonly composeTo: ComposeTo;
  readonly draft: Draft;
  readonly update: (next: (was: Draft) => Draft) => void;
  readonly skills: SkillSource | undefined;
}): React.JSX.Element {
  const { read, listed, asked, agent, searchFailed } = composeTo;
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // Whether the last paste was cut to the room the box has left, until the words change again.
  const [cut, setCut] = useState(false);
  const attempt = useRef<{ readonly key: string; readonly words: string } | undefined>(undefined);
  const statuses = useIntegrationStatuses();
  const place = useAgentRowPlace();
  const latestAgent = useRef(agent);
  latestAgent.current = agent;
  const chosen = agent === undefined ? undefined : agentMenuRow(agent, place);
  const placeholder = agent === undefined ? "Write a message" : `Write to ${agent.name}`;
  const field = useAnswerField({
    draft: draft.text,
    placeholder,
    self: agent?.id,
    agent: undefined,
    skills,
    keywords,
    statuses,
    onNote: setRefusal,
  });
  // Every change keeps the agent To names beside what it writes, so the draft opens again on it.
  const write = (next: (was: Draft) => Draft) =>
    update((was) => {
      const drafted = next(was);
      const id = latestAgent.current?.id;
      return id === undefined ? drafted : { ...drafted, to: id };
    });
  // Note that a send waits while files handed to the box are still read.
  const files = useAttachedFiles({
    holder: {
      attachments: draft.attachments,
      update: (next) => write((was) => ({ ...was, attachments: next(was.attachments) })),
    },
    onRefusal: setRefusal,
  });
  const text = draft.text.trim();
  const sendable =
    agent !== undefined &&
    (text !== "" || draft.attachments.length > 0) &&
    text.length <= INBOX_BOUNDS.MAX_MESSAGE_CHARS;
  const send = () => {
    if (!sendable || sending || files.reading) return;
    const words = sendWords(agent.id, draft);
    const key = attempt.current?.words === words ? attempt.current.key : crypto.randomUUID();
    attempt.current = { key, words };
    setSending(true);
    setRefusal(undefined);
    const subject = subjectOf(draft);
    setCut(false);
    start({
      agentId: agent.id,
      ...(subject === "" ? undefined : { title: subject }),
      text,
      ...(draft.attachments.length === 0 ? undefined : { attachments: draft.attachments }),
      clientKey: key,
    })
      .catch(
        (): CodingAgentInboxMessagedView => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      )
      .then((answer) => {
        setSending(false);
        if ("failure" in answer) {
          setRefusal(messageFailureWords(answer.failure));
          return;
        }
        update(() => EMPTY_DRAFT);
        onStarted({ item: answer.item, agent });
      });
  };
  // Note that Discard acts at once, the draft being one Undo away, which puts it back and opens New thread on it again.
  const discard = () => {
    const kept = draft;
    update(() => EMPTY_DRAFT);
    onDiscard();
    if (!written(kept)) return;
    toast(
      undoToast(DISCARDED, () => {
        update(() => kept);
        onRestore();
      }),
    );
  };
  const note =
    refusal ??
    (cut ? pasteCutWords(INBOX_BOUNDS.MAX_MESSAGE_CHARS) : undefined) ??
    (field.failed ? EDITOR_LOAD_FAILED : undefined);
  return (
    <section className="inbox-view-items" aria-label={NEW_THREAD} hidden={hidden}>
      {phone ? (
        <PhoneHead
          place="new-thread"
          start={
            onBack === undefined ? null : (
              <BackButton label={INBOX} place={INBOX_PLACE} onBack={onBack} />
            )
          }
          title={NEW_THREAD}
          end={
            <Tooltip label={DISCARD}>
              <IconButton
                icon={<TrashIcon />}
                label={DISCARD}
                onClick={discard}
                disabled={sending}
              />
            </Tooltip>
          }
        />
      ) : (
        <Toolbar
          start={TOOLBAR_INSET.COLUMN}
          lead={
            onBack === undefined ? null : (
              <BackButton label={INBOX} place={INBOX_PLACE} onBack={onBack} />
            )
          }
          title={NEW_THREAD}
          actions={
            <Button variant={BUTTON_VARIANT.QUIET} onClick={discard} disabled={sending}>
              {DISCARD}
            </Button>
          }
        />
      )}
      <div className="desktop-inbox inbox-compose">
        <div className="inbox-compose-head">
          <div className="inbox-compose-row">
            <span className="inbox-compose-label">{TO}</span>
            <Picker
              label={TO}
              align={POPOVER_ALIGN.START}
              width={CHIP_WIDTH.AUTO}
              value={agent?.id}
              valueLabel={chosen === undefined ? NO_AGENT : chosen.label}
              valueIcon={chosen?.icon}
              rows={listed.map((each) => agentMenuRow(each, place))}
              placeholder="Search agents"
              noMatch={NO_MATCH}
              note={
                asked !== "" ? (
                  searchFailed ? (
                    <ErrorState onRetry={composeTo.onRetry}>{AGENT_SEARCH_FAILED}</ErrorState>
                  ) : undefined
                ) : read === undefined ? (
                  <Spinner delay label={readingWords("agents")} />
                ) : "failed" in read ? (
                  <ErrorState onRetry={composeTo.onRetry}>{AGENTS_FAILED}</ErrorState>
                ) : read.agents.length === 0 ? (
                  NO_AGENTS
                ) : undefined
              }
              disabled={sending}
              onOpen={() => composeTo.onSearch("")}
              onSearch={composeTo.onSearch}
              onPick={(id) => {
                setRefusal(undefined);
                const pick = listed.find((each) => each.id === id);
                if (pick !== undefined) composeTo.onPick(pick);
              }}
            />
          </div>
          <div className="inbox-compose-row" data-field="">
            <FormField label={SUBJECT} optional>
              {(control) => (
                <TextField
                  field={control}
                  size={TEXT_FIELD_SIZE.INLINE}
                  value={draft.title ?? ""}
                  maxLength={INBOX_BOUNDS.MAX_TITLE_CHARS}
                  disabled={sending}
                  autoFocus
                  onChange={(title) => write((was) => ({ ...was, title }))}
                  onEnter={() => field.editor.current?.focus()}
                />
              )}
            </FormField>
          </div>
        </div>
        <div className={`${COMPOSER_ROOM_CLASS} inbox-compose-box`} {...files.drop.target}>
          <AnswerForm
            dropping={files.drop.dropping}
            field={field}
            asks={false}
            messages
            controls={undefined}
            chips={
              <AttachedFileChips
                files={attachmentChips(files.attachments)}
                onRemove={files.remove}
              />
            }
            note={draft.text}
            onNote={(words) => {
              setCut(false);
              write((was) => ({ ...was, text: words }));
            }}
            onPasteCut={() => setCut(true)}
            placeholder={placeholder}
            maxLength={INBOX_BOUNDS.MAX_MESSAGE_CHARS}
            onEnter={() => field.room.current?.closest("form")?.requestSubmit()}
            onPasteFiles={files.paste}
            tools={<AttachFilesButton onFiles={files.attach} />}
            says={note === undefined ? undefined : { words: note }}
            nod={false}
            sending={sending}
            held={sending || files.reading}
            sendable={sendable}
            onSubmit={send}
          />
        </div>
      </div>
    </section>
  );
}
