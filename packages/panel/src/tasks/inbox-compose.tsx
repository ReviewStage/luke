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
 */

import type { CodingAgentInboxMessagedView } from "@luke/features/coding-agent-view";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import { INBOX_BOUNDS, type InboxItem } from "@luke/features/inbox-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackIcon,
  BUTTON_VARIANT,
  Button,
  CHIP_WIDTH,
  FoldingButton,
  type FoldingButtonHint,
  Spinner,
  TEXT_FIELD_SIZE,
  TextField,
  Tooltip,
} from "@luke/ui";
import { useEffect, useRef, useState } from "react";
import { imageFiles } from "../feedback-images.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { PICKER_ALIGN, Picker } from "../settings/picker-row.js";
import { agentMenuRow, useAgentRowPlace } from "./agent-menu-row.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { readFiles, withFiles } from "./attached-files.js";
import { messageFailureWords } from "./coding-agent-model.js";
import { AnswerForm, EDITOR_LOAD_FAILED, useAnswerField } from "./inbox-answer-box.js";
import type { MentionAgentsReader, MentionableAgent } from "./mention-picker.js";
import type { InboxThreadStarter } from "./use-task-inbox.js";

/** The pane's name, as its bar and a reader say it. */
export const NEW_THREAD = "New thread";

const TO = "To";
const SUBJECT = "Subject";
const DISCARD = "Discard";
const NO_AGENT = "Choose an agent";
const NO_MATCH = "No agent matches";
const NO_AGENTS = "No agents in this workspace yet.";
const AGENTS_FAILED = "The workspace's agents could not be read.";
const SUBJECT_PLACEHOLDER = "Optional";
const BACK_TO_INBOX = "Back to inbox";

/** The way back's pill, which names Back's chord as the item pane's does. */
const BackHint: FoldingButtonHint = ({ children }) => (
  <Tooltip label={BACK_TO_INBOX} command={APP_COMMAND.BACK}>
    {children}
  </Tooltip>
);

/** The workspace's agents as To offers them: read, failed, or not yet read. */
type AgentsRead = { readonly agents: readonly MentionableAgent[] } | { readonly failed: true };

/** What a thread is written as before it is sent. */
interface ComposeDraft {
  readonly subject: string;
  readonly note: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

const EMPTY_DRAFT: ComposeDraft = { subject: "", note: "", attachments: [] };

/** A started thread, and the agent it went to, whose task the Inbox opens it under. */
export interface InboxStarted {
  readonly item: InboxItem;
  readonly agent: MentionableAgent;
}

/** What the pane is handed: where it stands, how it reads the agents and sends, and what follows a send or a discard. */
export interface InboxComposeProps {
  readonly hidden: boolean;
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
}

/** The agents To may name: those not archived, since none of them hears a thread. */
function heard(agents: readonly MentionableAgent[]): readonly MentionableAgent[] {
  return agents.filter((each) => each.archived !== true);
}

/**
 * The agents To lists: the workspace's newest, as read when the pane
 * opened, while nothing is typed; once a word is, those the service found
 * for it, the last answer standing until the next lands, as the `@` menu's
 * do, so an agent past the newest the workspace reads is found too.
 */
function listedAgents(
  read: AgentsRead | undefined,
  found: readonly MentionableAgent[] | undefined,
  words: string,
): readonly MentionableAgent[] {
  const newest = read !== undefined && "agents" in read ? read.agents : [];
  if (words === "") return newest;
  return found ?? newest;
}

/** The words a send is known by, so the same thread sent again goes under the key it went under. */
function sendWords(agentId: string, draft: ComposeDraft): string {
  return JSON.stringify([agentId, draft.subject.trim(), draft.note.trim(), draft.attachments]);
}

/** The agent the pane opened on, where the workspace's newest still hold it. */
function openedOn(
  read: AgentsRead | undefined,
  to: string | undefined,
): MentionableAgent | undefined {
  if (read === undefined || "failed" in read || to === undefined) return undefined;
  return read.agents.find((agent) => agent.id === to);
}

/** The pane: To, Subject, and the box, under the bar that names it. */
export function InboxCompose({
  hidden,
  onBack,
  readAgents,
  to,
  keywords,
  start,
  onStarted,
  onDiscard,
}: InboxComposeProps): React.JSX.Element {
  const [read, setRead] = useState<AgentsRead | undefined>(undefined);
  // The agents the last search found, standing until the next answers.
  const [found, setFound] = useState<readonly MentionableAgent[] | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MentionableAgent | undefined>(undefined);
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_DRAFT);
  const [sending, setSending] = useState(false);
  const [reading, setReading] = useState(0);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const latest = useRef(draft);
  latest.current = draft;
  const attempt = useRef<{ readonly key: string; readonly words: string } | undefined>(undefined);
  const statuses = useIntegrationStatuses();
  const place = useAgentRowPlace();
  const agent = picked ?? openedOn(read, to);
  const chosen = agent === undefined ? undefined : agentMenuRow(agent, place);
  const placeholder = agent === undefined ? "Write a message" : `Write to ${agent.name}`;
  const field = useAnswerField({
    draft: draft.note,
    placeholder,
    self: agent?.id,
    agent: undefined,
    skills: undefined,
    keywords,
    statuses,
    onNote: setRefusal,
  });
  // The agents are read as the pane opens.
  useEffect(() => {
    if (readAgents === undefined) return;
    let live = true;
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
  }, [readAgents]);
  // Once a word is typed the service finds the agents it names, however many the workspace holds.
  const asked = query.trim();
  useEffect(() => {
    if (readAgents === undefined || asked === "") return;
    let live = true;
    readAgents(asked).then(
      (agents) => {
        if (live) setFound(heard(agents));
      },
      () => {
        if (live) setFound([]);
      },
    );
    return () => {
      live = false;
    };
  }, [readAgents, asked]);
  const text = draft.note.trim();
  const sendable =
    agent !== undefined &&
    (text !== "" || draft.attachments.length > 0) &&
    text.length <= INBOX_BOUNDS.MAX_MESSAGE_CHARS;
  const send = () => {
    if (!sendable || sending || reading > 0) return;
    const words = sendWords(agent.id, draft);
    const key = attempt.current?.words === words ? attempt.current.key : crypto.randomUUID();
    attempt.current = { key, words };
    setSending(true);
    setRefusal(undefined);
    start({
      agentId: agent.id,
      ...(draft.subject.trim() === "" ? undefined : { title: draft.subject.trim() }),
      text,
      ...(draft.attachments.length === 0 ? undefined : { attachments: draft.attachments }),
      clientKey: key,
    })
      .catch(
        (): CodingAgentInboxMessagedView => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      )
      .then((answer) => {
        setSending(false);
        if ("failure" in answer) setRefusal(messageFailureWords(answer.failure));
        else onStarted({ item: answer.item, agent });
      });
  };
  const attach = (files: readonly File[]) => {
    if (files.length === 0) return;
    setReading((count) => count + 1);
    readFiles(files)
      .then((filesRead) => {
        // Taken after whatever the box holds as the read lands, so a chip taken off meanwhile is not undone.
        const taken = withFiles(latest.current.attachments, filesRead);
        setRefusal(taken.refusal);
        setDraft((was) => ({ ...was, attachments: taken.attachments }));
      })
      .finally(() => setReading((count) => count - 1));
  };
  const listed = listedAgents(read, found, asked);
  const note = refusal ?? (field.failed ? EDITOR_LOAD_FAILED : undefined);
  return (
    <section className="inbox-view-items" aria-label={NEW_THREAD} hidden={hidden}>
      <header className="desktop-toolbar">
        {onBack === undefined ? null : (
          <FoldingButton label="Inbox" icon={<BackIcon />} onClick={onBack} hint={BackHint} />
        )}
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{NEW_THREAD}</h1>
        </div>
        <div className="desktop-toolbar-actions">
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onDiscard} disabled={sending}>
            {DISCARD}
          </Button>
        </div>
      </header>
      <div className="desktop-inbox inbox-compose">
        <div className="inbox-compose-head">
          <div className="inbox-compose-row">
            <span className="inbox-compose-label">{TO}</span>
            <Picker
              label={TO}
              align={PICKER_ALIGN.START}
              width={CHIP_WIDTH.AUTO}
              value={agent?.id}
              valueLabel={chosen === undefined ? NO_AGENT : chosen.label}
              valueIcon={chosen?.icon}
              rows={listed.map((each) => agentMenuRow(each, place))}
              placeholder="Search agents"
              noMatch={NO_MATCH}
              note={
                asked !== "" ? undefined : read === undefined ? (
                  <Spinner delay label="Loading agents" />
                ) : "failed" in read ? (
                  AGENTS_FAILED
                ) : read.agents.length === 0 ? (
                  NO_AGENTS
                ) : undefined
              }
              disabled={sending}
              onOpen={() => setQuery("")}
              onSearch={setQuery}
              onPick={(id) => {
                setRefusal(undefined);
                setPicked(listed.find((each) => each.id === id));
              }}
            />
          </div>
          <div className="inbox-compose-row">
            <span className="inbox-compose-label">{SUBJECT}</span>
            <TextField
              label={SUBJECT}
              size={TEXT_FIELD_SIZE.INLINE}
              value={draft.subject}
              placeholder={SUBJECT_PLACEHOLDER}
              maxLength={INBOX_BOUNDS.MAX_TITLE_CHARS}
              disabled={sending}
              autoFocus
              onChange={(subject) => setDraft((was) => ({ ...was, subject }))}
              onEnter={() => field.editor.current?.focus()}
            />
          </div>
        </div>
        <div className="agent-composer inbox-compose-box">
          <AnswerForm
            field={field}
            asks={false}
            messages
            controls={undefined}
            chips={
              <AttachedFileChips
                files={attachmentChips(draft.attachments)}
                onRemove={(index) => {
                  setRefusal(undefined);
                  setDraft((was) => ({
                    ...was,
                    attachments: was.attachments.filter((_, at) => at !== index),
                  }));
                }}
              />
            }
            note={draft.note}
            onNote={(words) => setDraft((was) => ({ ...was, note: words }))}
            placeholder={placeholder}
            maxLength={INBOX_BOUNDS.MAX_MESSAGE_CHARS}
            onEnter={() => field.room.current?.closest("form")?.requestSubmit()}
            onPasteFiles={(files) => {
              // Only images are taken from the clipboard; text pastes as it always does.
              const pasted = imageFiles(files);
              if (pasted.length === 0) return false;
              attach(pasted);
              return true;
            }}
            tools={<AttachFilesButton onFiles={attach} />}
            nod={false}
            sending={sending}
            held={sending || reading > 0}
            sendable={sendable}
            onSubmit={send}
          />
          {note === undefined ? null : (
            <p className="error-message agent-composer-note" role="alert">
              {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
