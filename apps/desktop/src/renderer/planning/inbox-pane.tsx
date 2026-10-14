import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxBlock,
  type InboxChoice,
  type InboxCodeBlock,
  type InboxField,
  type InboxForm,
  type InboxImageBlock,
  type InboxItem,
  type InboxReadResponse,
  type InboxReplyKind,
  knownBlock,
  knownResponse,
} from "@sidecar/hosted/inbox-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import type { CodeRef, PlanSummary } from "@sidecar/hosted/plan-wire";
import { ChevronRightIcon } from "@sidecar/panel";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Message, MessageContent } from "../ai-elements/message";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { PlanRef } from "../desktop/plan-card";
import { ReadFailure } from "../read-failure";
import { Segmented } from "../segmented";
import { BusyLabel, SPINNER_SIZE, Spinner, SpinnerRegion } from "../spinner";
import { Switch } from "../switch";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { AgentCard, AgentRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref";
import type { FileChip } from "./attachment-model";
import { AttachmentViewer } from "./attachment-viewer";
import { CodeCardHeader, CodeLines, codeCardName } from "./code-pane";
import { copiedLines } from "./code-pane-model";
import type { ReadFileWindow } from "./file-tab";
import {
  CODE_READ,
  CODE_READ_FAILED,
  type CodeRead,
  codeNotice,
  codeReadOf,
  codeWindow,
  fieldValueOf,
  type InboxDraft,
  inboxReply,
  pressesOf,
  proposedOptions,
  SETTLED_BY,
  settlementOf,
  withChoice,
  withValue,
} from "./inbox-model";
import { useMinute } from "./plan-time";
import { RelativeTime } from "./relative-time";
import { AgentGlyph, type KindLook, TAB_KIND, tabLook } from "./tab-look";
import { cardTitle } from "./tool-call-model";
import { TranscriptWords } from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import { opensAsLink } from "./use-open-link";
import type { InboxImage, PlanInboxControl } from "./use-plan-inbox";

/**
 * inbox-pane.tsx -- one inbox item at reading size: the agent's question as a message of a thread, everything it offered, and its answer, given in place or as it was given.
 *
 * The pane is drawn from the agent tab's own pieces, so an item reads as
 * one more exchange with its agent: the agent's message
 * (`ai-elements/message.tsx`), its mark, name, and when it asked, then the
 * item's title and the blocks of context the agent wrote, Markdown as the
 * transcript draws it, a link as the transcript draws one, opened in the
 * browser where it is a web page, code as the Code tab draws a card
 * (`code-pane.tsx`), its lines read from GitHub at the agent's commit
 * through the File tab's own read and opened there in the File tab, and an
 * image the agent took in its sandbox, drawn at the pane's own width from
 * the bytes the host fetched under the account (`use-plan-inbox.ts`) and
 * opened larger over the window by a press, in the viewer an attached file
 * opens in (`attachment-viewer.tsx`). What the item asks for closes the
 * message: a choice's options, one perhaps recommended, pressed one at a
 * time or several where the choice allows; a form's fields, each the
 * control Settings draws for its type; nothing for the rest. While the item
 * waits, the agent composer's box (`ai-elements/prompt-input.tsx`) is
 * docked under the thread for the note: an approval, a task, and an item
 * asking nothing are answered by presses in its footer, the one that holds
 * back and the one that goes ahead, as a confirm's are; words, a choice,
 * and a form by the box's own Send. A card whose agent need not hear back
 * says so, since answering it messages nobody. Once the item is settled,
 * nothing it offered goes: the options, or the presses it was answered by,
 * stand with the developer's pick marked and the rest stepped back, and
 * the developer's reply follows as their own bubble, what they wrote in it
 * and under it what they did, when, and whether the answer reached the
 * agent as a message or was kept for it to read; or the agent's message
 * says it took the item back, and why. A block or a response of a type
 * this build does not know, one a newer service wrote, is drawn as a line
 * naming a newer Luke, so the rest still reads. The pane's bar is its
 * path, plan › agent, each crumb drawn as its tab in the plan's column,
 * opening what it names and hanging the card its sidebar row or tab
 * hangs. Wherever the thread names the agent, its bylines and the line
 * saying an answer was sent to it, the name is the agent's own reference
 * (`agent-ref.tsx`): its tab's card on hover, its tab on a press, an
 * archived agent's card saying so. Every time shows its moment in the
 * shared tooltip, and an agent this window does not list, one started on
 * another Mac, still leads with a glyph. The pane shows words an agent
 * wrote, a code block the repository's lines, and an image block a picture of what it rendered,
 * so its thread is out of the session recording (`ph-no-capture`), and the
 * viewer, drawn over the window outside it, is out of it on its own.
 */

/** What the thread says under its item where the plan's inbox could not be read. */
const INBOX_FAILED_LINE = "The inbox could not be read.";

/** What a card says of an image whose read did not answer. */
const IMAGE_FAILED_LINE = "The image could not be read.";

/** What a card's box asks for, by what the item asks; a text's own placeholder stands where the agent wrote one. */
const NOTE_PLACEHOLDER = {
  [INBOX_RESPONSE.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_RESPONSE.APPROVAL]: "Add a note for the agent",
  [INBOX_RESPONSE.TEXT]: "Your answer",
  [INBOX_RESPONSE.TASK]: "Add a note for the agent",
  [INBOX_RESPONSE.FORM]: "Add a note for the agent",
  [INBOX_RESPONSE.NONE]: "Add a note for the agent",
} as const;

/** What a card says of a block or a response this build does not know. */
const NEWER_LUKE = {
  BLOCK: "Open this in a newer Luke to see the rest.",
  RESPONSE: "Answer this in a newer Luke.",
} as const;

/** How long ago a thread's line says something happened: muted a size down, in tabular figures, as a card's corner says it. */
const THREAD_TIME_CLASS =
  "text-[11.5px] whitespace-nowrap text-(color:--text-tertiary) tabular-nums";

/** What the box's Send is called. */
const SEND = "Send to agent";

/** A link block: a press where it is a web page, as a transcript's links are, else its label with the address beside it to copy. */
function LinkBlock({
  url,
  label,
  openLink,
}: {
  url: string;
  label: string;
  openLink: (url: string) => void;
}): React.JSX.Element {
  if (opensAsLink(url)) {
    return (
      <a
        href={url}
        className="agent-link"
        onClick={(event) => {
          event.preventDefault();
          openLink(url);
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <Tooltip label={url}>
      <span className="agent-link-inert">
        {label} <span className="select-text text-muted-foreground">{url}</span>
      </span>
    </Tooltip>
  );
}

/** What a code block reads its lines through and opens its file with. */
export interface InboxCodeDoors {
  /** The plan's repository, `owner/name`, which the lines are read through; none where the plan names none. */
  readonly repository: string | null;
  /** Reads a window of a file of the plan's repository, as the File tab does. */
  readonly readFile: ReadFileWindow;
  /** Opens the file in the side panel's File tab at the commit named, the reference's lines lit. */
  readonly onOpenFile: (ref: CodeRef, commit: string) => void;
}

/**
 * A code block: a card as the Code tab draws one, headed by the path and
 * the lines, the file opened in the File tab at the block's commit from
 * either, and the lines read from GitHub at that commit with a few around
 * them, the block's own lit; lines the plan cannot read say why, and open
 * nothing. Note that the read goes through a ref to the
 * latest door, so a parent drawing a fresh door does not read again, and
 * that an answer landing after the block changed or left is dropped.
 */
function CodeBlock({
  block,
  code,
}: {
  block: InboxCodeBlock;
  code: InboxCodeDoors;
}): React.JSX.Element {
  const unread = codeNotice(block, code.repository);
  const [read, setRead] = useState<CodeRead>({ kind: CODE_READ.READING });
  const [asked, setAsked] = useState(0);
  const latest = useRef({ block, readFile: code.readFile });
  latest.current = { block, readFile: code.readFile };
  const { path, sha, startLine, endLine } = block;
  const codeRef = { path, startLine, endLine };

  useEffect(() => {
    if (unread !== undefined) return;
    let standing = true;
    const { block: asking, readFile } = latest.current;
    setRead({ kind: CODE_READ.READING });
    readFile(codeWindow(asking)).then(
      (answer) => {
        if (standing) setRead(codeReadOf(asking, answer));
      },
      () => {
        if (standing) setRead(CODE_READ_FAILED);
      },
    );
    return () => {
      standing = false;
    };
  }, [unread, path, sha, startLine, endLine, asked]);

  const shown: CodeRead =
    unread === undefined ? read : { kind: CODE_READ.NOTICE, line: unread, again: false };
  return (
    <article
      className="code-card ph-no-capture"
      aria-label={codeCardName(codeRef)}
      data-inbox-code=""
    >
      <CodeCardHeader
        codeRef={codeRef}
        copied={shown.kind === CODE_READ.READY ? copiedLines(shown.code) : undefined}
        // Note that lines the plan does not read open nothing, because the File tab reads the plan's repository alone.
        onOpen={unread === undefined ? () => code.onOpenFile(codeRef, sha) : undefined}
      />
      {shown.kind === CODE_READ.READY ? (
        <CodeLines code={shown.code} />
      ) : shown.kind === CODE_READ.READING ? (
        <SpinnerRegion label="Loading lines" />
      ) : (
        <div className="file-tab-notice border-b-0">
          {shown.again ? (
            <ReadFailure line={shown.line} onRetry={() => setAsked((was) => was + 1)} />
          ) : (
            <p className="m-0" role="alert">
              {shown.line}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * An image block: the picture at the card's width once its bytes are held,
 * pressed to open it larger over the window; a spinner while they are read,
 * and a line with Retry where the read did not answer. The block asks for
 * its image as it is first drawn, so a picture inside a card no one opened
 * is never fetched.
 */
function ImageBlock({
  itemId,
  block,
  image,
  onImage,
  onRetryImage,
}: {
  itemId: string;
  block: InboxImageBlock;
  image: InboxImage | undefined;
  onImage: PlanInboxControl["onImage"];
  onRetryImage: PlanInboxControl["onRetryImage"];
}): React.JSX.Element {
  const [viewing, setViewing] = useState(false);
  const held = image !== undefined;
  useEffect(() => {
    if (!held) onImage(itemId, block.attachmentId);
  }, [held, itemId, block.attachmentId, onImage]);
  if (image === undefined) {
    return (
      <div className="inbox-image-pending" data-inbox-image-pending="">
        <Spinner label="Loading image" size={SPINNER_SIZE.INLINE} />
      </div>
    );
  }
  if ("failed" in image) {
    return (
      <div data-inbox-image-failed="">
        <ReadFailure line={IMAGE_FAILED_LINE} onRetry={() => onRetryImage(block.attachmentId)} />
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="inbox-image"
        aria-label={`Open ${block.alt}`}
        onClick={() => setViewing(true)}
      >
        <img src={image.url} alt={block.alt} />
      </button>
      {viewing ? (
        <AttachmentViewer
          files={[viewerFile(block, image.url)]}
          at={0}
          onAt={() => undefined}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </>
  );
}

/** What a file's name may not spell on the Mac it is saved to. */
const UNSAVEABLE = /[/\\:]/gu;

/** The image as the viewer takes a file: named by its words under the type's own extension, since the viewer saves it by that name, and its type read off the `data:` URL. */
function viewerFile(block: InboxImageBlock, url: string): FileChip {
  const mediaType = url.slice("data:".length, url.indexOf(";"));
  const name = `${block.alt.replace(UNSAVEABLE, "-")}.${mediaType.slice("image/".length)}`;
  return { name, mediaType, url };
}

/** One block this build knows, drawn as its type is. */
function KnownBlock({
  itemId,
  block,
  images,
  onImage,
  onRetryImage,
  openLink,
  code,
}: {
  itemId: string;
  block: InboxBlock;
  images: PlanInboxControl["images"];
  onImage: PlanInboxControl["onImage"];
  onRetryImage: PlanInboxControl["onRetryImage"];
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element {
  switch (block.type) {
    case INBOX_BLOCK.MARKDOWN:
      return (
        <div data-inbox-markdown="">
          <TranscriptWords text={block.text} />
        </div>
      );
    case INBOX_BLOCK.LINK:
      return (
        <p className="m-0" data-inbox-link="">
          <LinkBlock url={block.url} label={block.label} openLink={openLink} />
        </p>
      );
    case INBOX_BLOCK.CODE:
      return <CodeBlock block={block} code={code} />;
    case INBOX_BLOCK.IMAGE:
      return (
        <div data-inbox-image="">
          <ImageBlock
            itemId={itemId}
            block={block}
            image={images.get(block.attachmentId)}
            onImage={onImage}
            onRetryImage={onRetryImage}
          />
        </div>
      );
  }
}

/** The item's context: each block in turn, drawn as its type is, and a line for one this build does not know. */
function Blocks({
  item,
  images,
  onImage,
  onRetryImage,
  openLink,
  code,
}: {
  item: InboxItem;
  images: PlanInboxControl["images"];
  onImage: PlanInboxControl["onImage"];
  onRetryImage: PlanInboxControl["onRetryImage"];
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element | null {
  if (item.blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-inbox-blocks="">
      {item.blocks.map((block, index) =>
        // Blocks have no key of their own, and are never reordered: a change to an item draws them whole again.
        knownBlock(block) ? (
          <KnownBlock
            key={index}
            itemId={item.id}
            block={block}
            images={images}
            onImage={onImage}
            onRetryImage={onRetryImage}
            openLink={openLink}
            code={code}
          />
        ) : (
          <p key={index} className="m-0 text-muted-foreground" data-inbox-unknown="">
            {NEWER_LUKE.BLOCK}
          </p>
        ),
      )}
    </div>
  );
}

/** A choice's options, each pressed to pick it, the agent's recommendation said after its label; several stay pressed where the choice allows. */
function ChoiceOptions({
  choice,
  draft,
  disabled,
  onDraft,
}: {
  choice: InboxChoice;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const multiple = choice.multiple === true;
  return (
    <div className="flex flex-col gap-1" data-inbox-choice={multiple ? "multiple" : "one"}>
      {choice.options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={draft.choices.includes(option.label)}
          className="inbox-option"
          disabled={disabled}
          onClick={() => onDraft(withChoice(draft, option.label, multiple))}
        >
          <span>
            <span className="font-medium">{option.label}</span>
            {choice.recommended === option.label ? (
              <span className="text-muted-foreground"> · Recommended</span>
            ) : null}
          </span>
          {option.detail === undefined ? null : (
            <span className="text-muted-foreground">{option.detail}</span>
          )}
        </button>
      ))}
      {multiple ? (
        <p className="m-0 text-[12px] text-muted-foreground">Pick any that apply.</p>
      ) : null}
    </div>
  );
}

/** A field's name over or beside its control, saying where it must be filled. */
function FieldName({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <span className="settings-copy">
      <strong>{field.label}</strong>
      {field.required === true ? <small>Required</small> : null}
    </span>
  );
}

/** One field of a form: the control Settings draws for its type, holding what the developer put in it. */
function FormField({
  field,
  draft,
  disabled,
  onDraft,
}: {
  field: InboxField;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case INBOX_FIELD.TEXT:
    case INBOX_FIELD.NUMBER: {
      const number = field.type === INBOX_FIELD.NUMBER;
      return (
        <label className="flex flex-col gap-1" data-inbox-field={field.type}>
          <FieldName field={field} />
          <input
            className="settings-input inbox-field-input"
            type={number ? "number" : "text"}
            maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
            value={value === undefined ? "" : String(value)}
            disabled={disabled}
            onChange={(event) => {
              const typed = event.currentTarget.value;
              if (typed === "") return set(undefined);
              const parsed = event.currentTarget.valueAsNumber;
              set(number ? (Number.isFinite(parsed) ? parsed : undefined) : typed);
            }}
          />
        </label>
      );
    }
    case INBOX_FIELD.SELECT:
      return (
        <div className="settings-row settings-row-wrapping" data-inbox-field={field.type}>
          <FieldName field={field} />
          {/* An optional field's choice is taken back by pressing it again, its only way to be left unanswered. */}
          <Segmented
            legend={field.label}
            options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
            value={field.options?.find((option) => option === value)}
            disabled={disabled}
            clearable={field.required !== true}
            onChange={set}
          />
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div className="settings-row" data-inbox-field={field.type}>
          <FieldName field={field} />
          <Switch checked={value === true} label={field.label} disabled={disabled} onChange={set} />
        </div>
      );
  }
}

/** A form's fields, in the agent's order. */
function FormFields({
  form,
  draft,
  disabled,
  onDraft,
}: {
  form: InboxForm;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-inbox-form="">
      {form.fields.map((field) => (
        <FormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          onDraft={onDraft}
        />
      ))}
    </div>
  );
}

/** The presses that send a card, in the box's footer: its response's where it is answered by a press, Send for the rest. */
function SendPresses({
  item,
  draft,
  sending,
  onAnswer,
}: {
  item: InboxItem;
  draft: InboxDraft;
  sending: boolean;
  onAnswer: (press?: InboxReplyKind) => void;
}): React.JSX.Element {
  const presses = pressesOf(item.response);
  if (presses !== undefined) {
    const { back, ahead } = presses;
    return (
      <div className="flex shrink-0 gap-(--control-gap)">
        {back === undefined ? null : (
          <button
            type="button"
            className="toolbar-button"
            disabled={sending}
            onClick={() => onAnswer(back.reply)}
          >
            {back.label}
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={sending}
          onClick={() => onAnswer(ahead.reply)}
        >
          <BusyLabel busy={sending} label="Sending">
            {ahead.label}
          </BusyLabel>
        </button>
      </div>
    );
  }
  return (
    <Tooltip label={SEND}>
      <PromptInputSubmit
        aria-label={SEND}
        status={sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY}
        disabled={sending || inboxReply(item, draft) === undefined}
      />
    </Tooltip>
  );
}

/** What the card's box asks for: the agent's own placeholder on a text, its response's words otherwise. */
function placeholderOf(response: InboxReadResponse): string {
  if (!knownResponse(response)) return "";
  if (response.type === INBOX_RESPONSE.TEXT && response.placeholder !== undefined) {
    return response.placeholder;
  }
  return NOTE_PLACEHOLDER[response.type];
}

/** The controls an item's response puts between its blocks and its box: a choice's options, a form's fields, nothing for the rest. */
function ResponseControls({
  item,
  draft,
  disabled,
  onDraft,
}: {
  item: InboxItem;
  draft: InboxDraft;
  disabled: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element | null {
  const response = item.response;
  if (!knownResponse(response)) return null;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return (
        <ChoiceOptions choice={response} draft={draft} disabled={disabled} onDraft={onDraft} />
      );
    case INBOX_RESPONSE.FORM:
      return <FormFields form={response} draft={draft} disabled={disabled} onDraft={onDraft} />;
    default:
      return null;
  }
}

/** The item's agent as the pane names it, the catalog its card names the model from, and the press that opens its tab. */
interface ItemAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** The agent's name in a line of the thread, which hangs its card and opens its tab. */
function AgentName({ by }: { by: ItemAgent }): React.JSX.Element {
  return (
    <AgentRef subject={by.subject} models={by.models} onOpen={by.onOpen}>
      <span className="agent-ref-name">{by.subject.name}</span>
    </AgentRef>
  );
}

/** What a settled item's line says of where the answer went: to the agent as a message, its name its reference, or kept for it to read. */
function Delivered({ item, by }: { item: InboxItem; by: ItemAgent }): React.JSX.Element {
  if (!item.needsReply) return <>Saved for the agent to read</>;
  return (
    <>
      Sent to <AgentName by={by} />
    </>
  );
}

/**
 * What a settled item offered, as the Inbox's own option rows: the
 * developer's pick in the look of a picked option, a check and "Your pick"
 * beside its label, and the rest stepped back to an outline, so what was
 * offered and what was chosen read together.
 */
function Proposal({ item }: { item: InboxItem }): React.JSX.Element | null {
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="What the agent offered">
      {options.map((option) => (
        <li key={option.label} className="inbox-option" data-picked={String(option.picked)}>
          <span>
            <span className="font-medium">{option.label}</span>
            {option.recommended ? (
              <span className="text-muted-foreground"> · Recommended</span>
            ) : null}
            {option.picked ? (
              <span className="inbox-picked">
                <CheckIcon aria-hidden="true" />
                Your pick
              </span>
            ) : null}
          </span>
          {option.detail === undefined ? null : (
            <span className="text-muted-foreground">{option.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Who wrote a message of the thread and when: the agent's mark and its name, which hang its card and open its tab, and what it did how long ago. */
function Byline({
  by,
  did,
  at,
  now,
}: {
  by: ItemAgent;
  did: string;
  at: number;
  now: number;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-(--glyph-gap) text-[12.5px] text-muted-foreground">
      <AgentRef subject={by.subject} models={by.models} onOpen={by.onOpen}>
        <span className="plan-summary-glyph">
          <AgentGlyph agent={by.subject.agent} />
        </span>
        <span className="agent-ref-name truncate font-medium text-foreground">
          {by.subject.name}
        </span>
      </AgentRef>
      <span className="shrink-0">
        {did} <RelativeTime className={THREAD_TIME_CLASS} at={at} now={now} />
      </span>
    </div>
  );
}

/** What the developer has said, under their own bubble: what they did, when, and where the answer went. */
function Answered({
  item,
  by,
  now,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
}): React.JSX.Element | null {
  const settled = settlementOf(item);
  if (settled === undefined) return null;
  if (settled.by === SETTLED_BY.AGENT) return null;
  return (
    <Message from="user" data-inbox-answer="">
      {settled.words === undefined ? null : (
        <MessageContent>
          <p className="m-0 whitespace-pre-line select-text">{settled.words}</p>
        </MessageContent>
      )}
      <p className="m-0 text-[11.5px] text-muted-foreground">
        {settled.lead} ·{" "}
        <RelativeTime className={THREAD_TIME_CLASS} at={item.updatedAt} now={now} /> ·{" "}
        <Delivered item={item} by={by} />
      </p>
    </Message>
  );
}

/** The agent taking an item back, as one more message of its own: when, and why where it said. */
function Withdrawn({
  item,
  by,
  now,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
}): React.JSX.Element | null {
  const settled = settlementOf(item);
  if (settled?.by !== SETTLED_BY.AGENT) return null;
  return (
    <Message from="assistant" data-inbox-withdrawn="">
      <Byline by={by} did="withdrew this" at={item.updatedAt} now={now} />
      {settled.words === undefined ? null : (
        <MessageContent className="inbox-indent">
          <p className="m-0 select-text">{settled.words}</p>
        </MessageContent>
      )}
    </Message>
  );
}

/** The box an open item is answered in, docked under its thread as an agent's composer is under its transcript, a note that it was not sent under the card as the composer's is. */
function AnswerBox({
  item,
  control,
}: {
  item: InboxItem;
  control: PlanInboxControl;
}): React.JSX.Element {
  const draft = control.draftOf(item);
  const sending = control.sending.has(item.id);
  const note = control.notes.get(item.id);
  const byPress = pressesOf(item.response) !== undefined;
  const placeholder = placeholderOf(item.response);
  return (
    <div className="agent-composer">
      {knownResponse(item.response) ? (
        <PromptInput
          // A press answers an approval, a task, and an item asking nothing, so its box's Enter sends nothing.
          onSubmit={() => (byPress ? undefined : control.onAnswer(item, draft))}
        >
          <PromptInputTextarea
            aria-label={placeholder}
            placeholder={placeholder}
            maxLength={INBOX_BOUNDS.MAX_NOTE_CHARS}
            value={draft.note}
            disabled={sending}
            onChange={(event) =>
              control.onDraft(item, { ...draft, note: event.currentTarget.value })
            }
          />
          <PromptInputFooter>
            <PromptInputTools className="px-1 text-[12px] text-muted-foreground">
              {item.needsReply ? null : (
                <span data-inbox-quiet="">Answering doesn't message the agent.</span>
              )}
            </PromptInputTools>
            <SendPresses
              item={item}
              draft={draft}
              sending={sending}
              onAnswer={(press) => control.onAnswer(item, draft, press)}
            />
          </PromptInputFooter>
        </PromptInput>
      ) : (
        <p className="m-0 text-muted-foreground" data-inbox-unknown="">
          {NEWER_LUKE.RESPONSE}
        </p>
      )}
      {note === undefined ? null : (
        <p className="error-message agent-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

/** What the pane's crumbs open, and the cards they hang. */
export interface InboxPaneDoors {
  /** Opens the item's plan. */
  readonly onOpenPlan: () => void;
  /** The plan's hover card, as its sidebar row hangs it. */
  readonly planCard: React.ReactNode;
  /** Opens the agent's tab on its plan. */
  readonly onOpenAgent: (agentId: string) => void;
  /** Opens a link block's web page in the browser (`use-open-link.ts`). */
  readonly openLink: (url: string) => void;
  readonly code: InboxCodeDoors;
}

/**
 * What a crumb of the pane's path draws, as a tab of the strip draws it:
 * its kind's glyph and its label in a tab's pill (`tab-look.tsx`), the
 * label fading where it is cut short, and the tab's hover fill, the chosen
 * tab's while it is pressed. It is no tab of a strip, so it takes no tab's
 * role.
 */
function CrumbWords({ look }: { look: KindLook }): React.JSX.Element {
  const [words, clipped] = useClipped();
  return (
    <>
      <span className="tab-icon">{look.icon}</span>
      <span ref={words} className="tab-label" data-overflow={String(clipped)}>
        {look.label}
      </span>
    </>
  );
}

/**
 * The pane's path, plan › agent, each crumb drawn as its tab is in the
 * plan's column, the plan's document glyph and the agent's mark: each opens
 * what it names, the plan or the agent's tab, and hangs the card its
 * sidebar row or tab hangs, the plan's crumb as every place naming the
 * plan does (`PlanRef`). An agent this window does not list, one started on
 * another Mac, hangs a card saying so and still opens its tab.
 */
function Crumbs({
  plan,
  by,
  doors,
}: {
  plan: PlanSummary;
  by: ItemAgent;
  doors: InboxPaneDoors;
}): React.JSX.Element {
  const { name, agent } = by.subject;
  return (
    <nav className="file-breadcrumbs inbox-crumbs" aria-label="Path">
      <ol>
        <li className="tab inbox-crumb">
          <PlanRef
            plan={plan}
            card={doors.planCard}
            onOpen={doors.onOpenPlan}
            className="tab-button"
          >
            <CrumbWords look={tabLook({ kind: TAB_KIND.PLAN, name: plan.name })} />
          </PlanRef>
        </li>
        <li className="file-breadcrumb-separator" aria-hidden="true">
          <ChevronRightIcon />
        </li>
        <li className="tab inbox-crumb">
          <Tooltip label={name} card={<AgentCard subject={by.subject} models={by.models} />}>
            <button type="button" className="tab-button" onClick={by.onOpen}>
              <CrumbWords look={tabLook({ kind: TAB_KIND.AGENT, name, agent })} />
            </button>
          </Tooltip>
        </li>
      </ol>
    </nav>
  );
}

/**
 * One item at reading size, as a thread: under the pane's crumbs, the
 * agent's message, its name and when it asked, the item's title, its
 * blocks, and what it offers; then what came of it. While the item waits,
 * a choice's options and a form's fields are pressed in the message, and
 * the box is docked at the pane's foot. Once it is settled, the options
 * stand with the developer's pick marked, and the developer's reply follows
 * as their bubble, with what they did, when, and whether it reached the
 * agent; or the agent's own message says it took the item back, and why.
 */
export function InboxPane({
  plan,
  item,
  control,
  agents,
  doors,
}: {
  plan: PlanSummary;
  item: InboxItem;
  /** The live read of the item's plan, which answers it and holds its draft. */
  control: PlanInboxControl;
  agents: CodingAgentsControl;
  doors: InboxPaneDoors;
}): React.JSX.Element {
  const now = useMinute();
  const by: ItemAgent = {
    subject: agentSubject(agents, item.agentId, NOTHING_HELD, false),
    models: agents.models,
    onOpen: () => doors.onOpenAgent(item.agentId),
  };
  const open = item.status === INBOX_STATUS.OPEN;
  const draft = control.draftOf(item);
  return (
    <section className="inbox-view-items" aria-label={cardTitle(item.title)}>
      <header className="desktop-toolbar">
        <Crumbs plan={plan} by={by} doors={doors} />
      </header>
      <div className="desktop-inbox">
        <div
          // The box docks under the thread as an agent's composer does under its log, which runs up to the card and fades there.
          className={`inbox-board ph-no-capture flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-(--section-gap) ${open ? "agent-log-over-composer" : "pb-5"}`}
          data-item-id={item.id}
        >
          <Message from="assistant">
            <Byline by={by} did="asked" at={item.postedAt} now={now} />
            <MessageContent className="inbox-indent">
              <h3 className="m-0 font-medium text-foreground" data-inbox-title="">
                {cardTitle(item.title)}
              </h3>
              <Blocks
                item={item}
                images={control.images}
                onImage={control.onImage}
                onRetryImage={control.onRetryImage}
                openLink={doors.openLink}
                code={doors.code}
              />
              {open ? (
                <ResponseControls
                  item={item}
                  draft={draft}
                  disabled={control.sending.has(item.id)}
                  onDraft={(next) => control.onDraft(item, next)}
                />
              ) : (
                <Proposal item={item} />
              )}
            </MessageContent>
          </Message>
          <Answered item={item} by={by} now={now} />
          <Withdrawn item={item} by={by} now={now} />
          {control.failed ? (
            <ReadFailure line={INBOX_FAILED_LINE} onRetry={control.onRetry} />
          ) : null}
        </div>
        {open ? <AnswerBox item={item} control={control} /> : null}
      </div>
    </section>
  );
}
