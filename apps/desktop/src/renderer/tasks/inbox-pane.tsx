import type { FileChip } from "@luke/features/attachment-model";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxBlock,
  type InboxChoice,
  type InboxCodeBlock,
  type InboxField,
  type InboxForm,
  type InboxImageBlock,
  type InboxItem,
  inboxAnswerHeard,
  knownBlock,
  knownResponse,
} from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { CodeRef } from "@luke/features/task-wire";
import { BackIcon, ChevronRightIcon, ErrorState } from "@luke/ui";
import { type Actor, actorName, personActor } from "@luke/ui/actor-model";
import { PICTURE_STATE } from "@luke/ui/picture-cache";
import { useClipped } from "@luke/ui/use-clipped";
import { copiedLines, fileRefText } from "@luke/voice/code-pane-model";
import { CheckIcon, ClockIcon, FactoryIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorLine, ActorMark, ActorRef, AutomationCard } from "../actor-ref";
import { AttentionMark } from "../attention-mark";
import { useAutomation } from "../automation-directory";
import { TaskRef } from "../desktop/task-card";
import { useMemberDirectory, usePerson } from "../member-directory";
import { PictureBlock } from "../picture-block";
import { Segmented } from "../segmented";
import { SpinnerRegion } from "../spinner";
import { Switch } from "../switch";
import { TextLink } from "../text-link";
import { Tooltip } from "../tooltip";
import {
  AgentActorRef,
  AgentCard,
  type AgentSubject,
  agentSubject,
  NOTHING_HELD,
} from "./agent-ref";
import { AttachedFileChips } from "./attached-file-chips";
import { AttachmentViewer } from "./attachment-viewer";
import { CodeCardHeader, CodeLines } from "./code-pane";
import type { ReadFileWindow } from "./file-tab";
import { InboxAnswerBox } from "./inbox-answer-box";
import {
  answerFileChips,
  CODE_READ,
  CODE_READ_FAILED,
  type CodeRead,
  codeNotice,
  codeReadOf,
  codeWindow,
  fieldValueOf,
  INBOX_HOLDER,
  type InboxDraft,
  type InboxHolder,
  itemWorkspaceId,
  NEEDS_YOU,
  needsReader,
  proposedOptions,
  readersItem,
  SETTLED_BY,
  settlementOf,
  withChoice,
  withValue,
} from "./inbox-model";
import { type InboxNext, InboxNextUp, type InboxPager, InboxPagerControls } from "./inbox-pager";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import { RelativeTime } from "./relative-time";
import { SentWords } from "./skill-chip";
import { type KindLook, TAB_KIND, tabLook } from "./tab-look";
import { useMinute } from "./task-time";
import { cardTitle } from "./tool-call-model";
import { TranscriptWords } from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import { WordsWorkspace } from "./use-link-standing";
import { opensAsLink } from "./use-open-link";
import type { InboxImage, TaskInboxControl } from "./use-task-inbox";

/**
 * inbox-pane.tsx -- one inbox item at reading size: a comment thread under the item's title, the agent's question, everything it offered, and its answer, given in place or as it was given.
 *
 * The item reads as a comment thread, as an issue or a pull request does:
 * its title leads as the thread's subject, with a muted line under it of
 * its agent, when it asked, and where it stands, the attention mark on an
 * item waiting on the developer. Each message under it is a comment, its
 * writer's face in a column of its own, a line of name and when beside it,
 * and a line down from the face joining it to the next. The agent's
 * question comes first: the blocks of context the agent wrote, Markdown as the
 * transcript draws it, its links read under the item's own workspace, its
 * plan's or its agent's, a link as the transcript draws one, opened in the
 * browser where it is a web page, code as the Code tab draws a card
 * (`code-pane.tsx`), its lines read from GitHub at the agent's commit
 * through the File tab's own read and opened there in the File tab, and an
 * image the agent took in its sandbox, drawn from the bytes the host fetched
 * under the account (`use-plan-inbox.ts`) as a plan's or a transcript's
 * picture is (`picture-block.tsx`), up to the pane's width and no taller
 * than theirs, and opened larger over the window by a press, in the viewer
 * an attached file opens in (`attachment-viewer.tsx`). What the item asks for closes the
 * message: a choice's options, one perhaps recommended, pressed one at a
 * time or several where the choice allows; a form's fields, each the
 * control Settings draws for its type; nothing for the rest. While the item
 * waits, the agent composer's box, its card and its field, with its `@`
 * mentions, its skills, and its microphone (`inbox-answer-box.tsx`), is
 * docked under the thread for the note: an approval, a task, and an item
 * asking nothing are answered by presses in its footer, the one that holds
 * back and the one that goes ahead, as a confirm's are; words, a choice,
 * and a form by the box's own Send. A card whose agent need not hear back
 * says whether its answer will message the agent: a bare press does not, and
 * a typed note does. Once the item is settled,
 * what it offered folds to one line saying who picked which, which opens
 * to the options, or the presses it was answered by, with the developer's
 * pick marked and the rest stepped back; the developer's answer follows as
 * their comment, when and whether it reached the agent as a message or was
 * kept for it to read, then what they picked as a chip and what they
 * wrote, their note drawn as the agent's tab draws a sent message, its
 * mentions chips; or the agent's comment says it took the item back, and why. A block or a response of a type
 * this build does not know, one a newer service wrote, is drawn as a line
 * naming a newer Luke, so the rest still reads. The pane's bar is its
 * path, task › agent, each crumb drawn as its tab in the task's column,
 * opening what it names and hanging the card its sidebar row or tab
 * hangs, after a way back to the list where the item stands alone, and
 * nothing else that opens the agent, since its name does. Wherever the
 * thread names the agent, its subject's line, its comments, and the line
 * saying an answer was sent to it, the name is the agent's own reference
 * (`agent-ref.tsx`): its tab's card on hover, its tab on a press, an
 * archived agent's card saying so. Every time shows its moment in the
 * shared tooltip, and an agent this window does not list, one started on
 * another Mac, still leads with a glyph. The pane shows words an agent
 * wrote, a code block the repository's lines, and an image block a picture of what it rendered,
 * so its thread is out of the session recording (`ph-no-capture`), and the
 * viewer, drawn over the window outside it, is out of it on its own.
 */

/** What the thread says under its item where the task's inbox could not be read. */
const INBOX_FAILED_LINE = "The inbox could not be read.";

/** What a card says of an image whose read did not answer. */
const IMAGE_FAILED_LINE = "The image could not be read.";

/** What an answer says of the files whose read did not answer. */
const FILES_FAILED_LINE = "Some files could not be read.";

/** What a card says of a block or a response this build does not know. */
const NEWER_LUKE = {
  BLOCK: "Open this in a newer Luke to see the rest.",
} as const;

/** How long ago a thread's line says something happened: muted a size down, in tabular figures, as a card's corner says it. */
const THREAD_TIME_CLASS =
  "text-[11.5px] whitespace-nowrap text-(color:--text-tertiary) tabular-nums";

/** What the way back from an item standing alone to the list says it does. */
const BACK_TO_INBOX = "Back to inbox";

/** A link block: a plain link where it is a web page, as a transcript's links are, else its label with the address beside it to copy. */
export function LinkBlock({
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
      <TextLink href={url} words={label} onOpen={openLink}>
        {label}
      </TextLink>
    );
  }
  return (
    <Tooltip label={url}>
      <span className="text-link-inert">
        {label} <span className="select-text text-muted-foreground">{url}</span>
      </span>
    </Tooltip>
  );
}

/** What a code block reads its lines through and opens its file with. */
export interface InboxCodeDoors {
  /** The task's repository, `owner/name`, which the lines are read through; none where the task names none. */
  readonly repository: string | null;
  /** Reads a window of a file of the task's repository, as the File tab does. */
  readonly readFile: ReadFileWindow;
  /** Opens the file in the side panel's File tab at the commit named, the reference's lines lit. */
  readonly onOpenFile: (ref: CodeRef, commit: string) => void;
}

/**
 * A code block: a card as the Code tab draws one, headed by the path and
 * the lines, the file opened in the File tab at the block's commit from
 * either, and the lines read from GitHub at that commit with a few around
 * them, the block's own lit; lines the task cannot read say why, and open
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
      aria-label={fileRefText(codeRef)}
      data-inbox-code=""
    >
      <CodeCardHeader
        codeRef={codeRef}
        note={undefined}
        copied={shown.kind === CODE_READ.READY ? copiedLines(shown.code) : undefined}
        // Note that lines the task does not read open nothing, because the File tab reads the task's repository alone.
        onOpen={unread === undefined ? () => code.onOpenFile(codeRef, sha) : undefined}
      />
      {shown.kind === CODE_READ.READY ? (
        <CodeLines code={shown.code} />
      ) : shown.kind === CODE_READ.READING ? (
        <SpinnerRegion label="Loading lines" />
      ) : (
        <div className="file-tab-notice border-b-0">
          {shown.again ? (
            <ErrorState onRetry={() => setAsked((was) => was + 1)}>{shown.line}</ErrorState>
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
 * An image block: the picture drawn as a plan's picture is, at its own size
 * up to the card's width and a screenful's height, once its bytes are held,
 * pressed to open it larger over the window; that block's quiet box while
 * they are read, and a line with Retry where the read did not answer. The
 * block asks for its image as it is first drawn, so a picture inside a card
 * no one opened is never fetched.
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
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element {
  const [viewing, setViewing] = useState(false);
  const held = image !== undefined;
  useEffect(() => {
    if (!held) onImage(itemId, block.attachmentId);
  }, [held, itemId, block.attachmentId, onImage]);
  if (image === undefined) {
    return (
      <PictureBlock state={{ kind: PICTURE_STATE.READING }} alt={block.alt} caption={undefined} />
    );
  }
  if ("failed" in image) {
    return (
      <div data-inbox-image-failed="">
        <ErrorState onRetry={() => onRetryImage(block.attachmentId)}>
          {IMAGE_FAILED_LINE}
        </ErrorState>
      </div>
    );
  }
  return (
    <>
      <PictureBlock
        state={{ kind: PICTURE_STATE.READY, url: image.url }}
        alt={block.alt}
        caption={undefined}
        onOpen={() => setViewing(true)}
      />
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
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
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
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
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

/**
 * An option's head: its label, what is said of it beside the label, and,
 * where the agent recommended it, a badge at the option's top right, so it
 * stands in one place however the label wraps. The badge is filled with
 * the accent while the item waits and steps back to the quiet badge once
 * it is settled, when the recommendation is history rather than a call to
 * act. It is drawn inside the option alone, so wherever an option is drawn
 * it wears it.
 */
function OptionHead({
  label,
  recommended,
  settled,
  children,
}: {
  label: string;
  recommended: boolean;
  settled: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="inbox-option-head">
      <span className="inbox-option-label">
        <span className="font-medium">{label}</span>
        {children}
      </span>
      {recommended ? (
        <span className="inbox-recommended" data-settled={String(settled)}>
          Recommended
        </span>
      ) : null}
    </span>
  );
}

/** A choice's options, each pressed to pick it, the one the agent recommends wearing its badge; several stay pressed where the choice allows. */
export function ChoiceOptions({
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
          <OptionHead
            label={option.label}
            recommended={choice.recommended === option.label}
            settled={false}
          />
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
export function FormFields({
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

/** The agent in a line of the thread: its tile and name, which hang its card and open its tab. */
function AgentName({ by }: { by: ItemAgent }): React.JSX.Element {
  return <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} />;
}

/** What a settled item's line says of where the answer went: to the agent as a message, its name its reference, or, a bare press on an item asking nothing back, kept for it to read. */
function Delivered({ item, by }: { item: InboxItem; by: ItemAgent }): React.JSX.Element {
  // Note that an answered item the wire carries without its answer was heard where it asked to be.
  const heard =
    item.answer === undefined
      ? item.needsReply
      : inboxAnswerHeard(item, item.answer, item.answerFiles);
  if (!heard) return <>Saved for the agent to read</>;
  return (
    <ActorLine>
      {"Sent to "}
      <AgentName by={by} />
    </ActorLine>
  );
}

/**
 * What a settled item offered, as the Inbox's own option rows: the
 * developer's pick in the look of a picked option, a check and whose pick
 * it was, "[disc] Your pick" or "[disc] Charles Pan’s pick", beside its
 * label, and the rest stepped back to an outline, so what was offered and
 * what was chosen read together. The option the agent recommended keeps
 * its badge, gone quiet.
 */
function Proposal({ item }: { item: InboxItem }): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="What the agent offered">
      {options.map((option) => (
        <li key={option.label} className="inbox-option" data-picked={String(option.picked)}>
          <OptionHead label={option.label} recommended={option.recommended} settled>
            {option.picked ? (
              <span className="inbox-picked">
                <CheckIcon aria-hidden="true" />
                <ActorLine>
                  <ActorRef actor={answerer} possessive />
                  {" pick"}
                </ActorLine>
              </span>
            ) : null}
          </OptionHead>
          {option.detail === undefined ? null : (
            <span className="text-muted-foreground">{option.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** How many options a settled item's fold says it offered. */
function optionsWords(count: number): string {
  return count === 1 ? "1 option" : `${count} options`;
}

/**
 * What a settled item offered, folded to one line, as the transcript folds
 * a finished step: how many options there were and who picked which, "2
 * options · you picked Retry once", or that they were offered where the
 * agent took the item back. Opened, it shows them as they were
 * (`Proposal`).
 */
function Offered({ item }: { item: InboxItem }): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  const picked = options.filter((option) => option.picked).map((option) => option.label);
  const who = actorName(answerer, { sentence: true });
  const summary =
    picked.length === 0
      ? `${optionsWords(options.length)} offered`
      : `${optionsWords(options.length)} · ${who} picked ${picked.join(", ")}`;
  return (
    <details className="inbox-offered" data-inbox-offered="">
      <summary>
        <ChevronRightIcon />
        <span>{summary}</span>
      </summary>
      <Proposal item={item} />
    </details>
  );
}

/** Which message of the thread a comment is: the agent's question, the developer's answer, or the agent taking the item back. */
const COMMENT = {
  ASKED: "asked",
  ANSWERED: "answered",
  WITHDRAWN: "withdrawn",
} as const;

type CommentKind = (typeof COMMENT)[keyof typeof COMMENT];

/**
 * One message of the thread as a comment: its writer's face in a column of
 * its own, then a line of who and when, and what they wrote under it, a
 * line down from the face joining it to the next. The writer is named
 * once, by name alone, since the face already stands beside it.
 */
function Comment({
  kind,
  face,
  head,
  children,
}: {
  kind: CommentKind;
  face: Actor;
  head: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="inbox-comment" data-inbox-comment={kind}>
      <span className="inbox-comment-face">
        <ActorMark actor={face} size={ACTOR_SIZE.ROW} />
      </span>
      <div className="inbox-comment-main">
        <div className="inbox-comment-head">{head}</div>
        {children === undefined ? null : <div className="inbox-comment-body">{children}</div>}
      </div>
    </li>
  );
}

/** A comment's writer by name, which hangs their card and opens their page or tab. */
function CommentName({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="inbox-comment-name">{children}</span>;
}

/** A word set as the start of a sentence. */
function sentenceCased(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * What the developer's answer leads with: what they picked, the options'
 * labels, or, where they picked none and wrote nothing, what they did,
 * "Acknowledged it"; nothing where their words say it.
 */
function pickOf(item: InboxItem, did: string, words: string | undefined): string | undefined {
  const picked = proposedOptions(item).filter((option) => option.picked);
  if (picked.length > 0) return picked.map((option) => option.label).join(", ");
  return words === undefined ? sentenceCased(did) : undefined;
}

/**
 * The files the developer's answer carried, as the agent's tab draws a sent
 * message's (`attached-file-chips.tsx`): each asks for its bytes as it is
 * first drawn, through the same read an image block's picture takes, and is
 * drawn by its name alone until they land; where a read did not answer, a
 * line under the files says so with Retry, as an image block's does.
 */
function AnswerFiles({
  item,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.ReactNode {
  const files = item.answerFiles ?? [];
  useEffect(() => {
    for (const file of files) {
      if (!images.has(file.attachmentId)) onImage(item.id, file.attachmentId);
    }
  }, [files, images, item.id, onImage]);
  const failed = files.filter((file) => {
    const read = images.get(file.attachmentId);
    return read !== undefined && "failed" in read;
  });
  return (
    <>
      <AttachedFileChips files={answerFileChips(item, images)} />
      {failed.length === 0 ? null : (
        <div data-inbox-files-failed="">
          <ErrorState
            onRetry={() => {
              for (const file of failed) onRetryImage(file.attachmentId);
            }}
          >
            {FILES_FAILED_LINE}
          </ErrorState>
        </div>
      )}
    </>
  );
}

/** The developer's answer as their comment: who answered, by their face and name, when, and where it went, then what they picked as a chip, the files they attached, and what they wrote. */
function Answered({
  item,
  by,
  now,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const settled = settlementOf(item);
  if (settled === undefined) return null;
  if (settled.by === SETTLED_BY.AGENT) return null;
  // Files alone are the developer's own words where they wrote none, so no "Answered it" chip stands over them.
  const filesSay =
    (item.answerFiles ?? []).length > 0 && item.answer?.reply === INBOX_REPLY.ANSWERED
      ? ""
      : undefined;
  const pick = pickOf(item, settled.did, settled.values ?? settled.note ?? filesSay);
  return (
    <Comment
      kind={COMMENT.ANSWERED}
      face={answerer}
      head={
        <>
          <CommentName>
            <ActorRef actor={answerer} />
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime className={THREAD_TIME_CLASS} at={item.updatedAt} now={now} /> ·{" "}
            <Delivered item={item} by={by} />
          </span>
        </>
      }
    >
      {pick === undefined ? null : (
        <span className="inbox-pick" data-inbox-pick="">
          <CheckIcon aria-hidden="true" />
          <span>{pick}</span>
        </span>
      )}
      {settled.values === undefined ? null : (
        <p className="m-0 whitespace-pre-line select-text">{settled.values}</p>
      )}
      <AnswerFiles item={item} images={images} onImage={onImage} onRetryImage={onRetryImage} />
      {/* The note is drawn as the agent's tab draws a message, so a mention it holds is its chip. */}
      {settled.note === undefined ? null : (
        <div className="select-text" data-inbox-note="">
          <SentWords text={settled.note} />
        </div>
      )}
    </Comment>
  );
}

/** The agent taking an item back, as one more comment of its own: when, and why where it said. */
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
    <Comment
      kind={COMMENT.WITHDRAWN}
      face={by.subject.tile}
      head={
        <>
          <CommentName>
            <AgentName by={by} />
          </CommentName>
          <span className="inbox-comment-when">
            withdrew this{" "}
            <RelativeTime className={THREAD_TIME_CLASS} at={item.updatedAt} now={now} />
          </span>
        </>
      }
    >
      {settled.words === undefined ? undefined : <p className="m-0 select-text">{settled.words}</p>}
    </Comment>
  );
}

/** What the subject's line says the item stands at, by its status. */
const STANDING_WORDS = {
  [INBOX_STATUS.OPEN]: NEEDS_YOU.LABEL,
  [INBOX_STATUS.ANSWERED]: "Answered",
  [INBOX_STATUS.CLOSED]: "Withdrawn",
} as const;

/**
 * Where the item stands, in the subject's line. An item that needs the
 * reader, open and asked by an agent they started (`needsReader`), wears the
 * attention mark, which only answering it takes away; a teammate's open item
 * waits on the teammate, named by their face and name, which any member may
 * still answer; a settled one says how it was settled.
 */
function Standing({
  item,
  readerId,
}: {
  item: InboxItem;
  readerId: string | undefined;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const reader = directory.readerId ?? readerId;
  const waitsOn =
    item.status === INBOX_STATUS.OPEN && !readersItem(item, reader)
      ? personActor(item.startedBy, directory.members, reader, directory.former)
      : undefined;
  if (waitsOn !== undefined) {
    return (
      <span className="inbox-standing" data-status={item.status} data-waiting="true">
        <ActorLine>
          {"Waiting on "}
          <ActorRef actor={waitsOn} sentence />
        </ActorLine>
      </span>
    );
  }
  return (
    <span className="inbox-standing" data-status={item.status}>
      {needsReader(item, reader) ? <AttentionMark /> : null}
      {STANDING_WORDS[item.status]}
    </span>
  );
}

/**
 * The thread's subject, as a plan or a pull request leads with one: the
 * item's title, and under it a muted line of its agent, which hangs its
 * card and opens its tab, when it asked, and where the item stands: needing
 * the reader, waiting on the teammate whose agent asks it, or settled.
 */
function Subject({
  item,
  by,
  readerId,
  now,
}: {
  item: InboxItem;
  by: ItemAgent;
  readerId: string | undefined;
  now: number;
}): React.JSX.Element {
  return (
    <header className="inbox-subject">
      <h2 className="inbox-subject-title" data-inbox-title="">
        {cardTitle(item.title)}
      </h2>
      <p className="inbox-subject-line">
        <span className="inbox-subject-agent">
          <AgentName by={by} />
        </span>
        <span aria-hidden="true">·</span>
        <span>
          asked <RelativeTime className={THREAD_TIME_CLASS} at={item.postedAt} now={now} />
        </span>
        <span aria-hidden="true">·</span>
        <Standing item={item} readerId={readerId} />
      </p>
    </header>
  );
}

/** The box's mentions where the pane is handed them; the page's own where it is not. */
function AnswerMentions({
  value,
  children,
}: {
  value: PlanMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <PlanMentions value={value}>{children}</PlanMentions>;
}

/** The words a dictation into an item's box is likely to say: its repository's, its title's, and the paths its blocks name. */
function answerKeywords(holder: InboxHolder, item: InboxItem): readonly string[] {
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : holder.repository || null;
  const body = item.blocks
    .flatMap((block) => {
      if (!knownBlock(block)) return [];
      if (block.type === INBOX_BLOCK.MARKDOWN) return [block.text];
      return block.type === INBOX_BLOCK.CODE ? [block.path] : [];
    })
    .join("\n");
  return dictationKeywords({ repository, title: item.title, body });
}

/** What the pane's crumbs open, and the cards they hang. */
export interface InboxPaneDoors {
  /** Opens what holds the item: its task, or its automation's page; nothing where there is none to open. */
  readonly onOpenHolder: (() => void) | undefined;
  /** The task's hover card, as its sidebar row hangs it; none for an automation. */
  readonly taskCard: React.ReactNode;
  /** Opens the agent's tab on its task. */
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
 * An automation's crumb, as its page's own look names it: its clock and its
 * name, hanging its card where the window reads it, and opening its page
 * where that can be opened.
 */
function AutomationCrumb({
  holder,
  onOpen,
}: {
  holder: Extract<InboxHolder, { kind: typeof INBOX_HOLDER.AUTOMATION }>;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const known = useAutomation(holder.automationId ?? undefined);
  // Note that the agents no automation names stand under no automation, so their crumb wears the Factory's glyph, where every agent is listed, as their group's header does.
  const icon = holder.automationId === null ? <FactoryIcon aria-hidden="true" /> : <ClockIcon />;
  return (
    <Tooltip
      label={holder.name}
      card={
        known === undefined ? undefined : (
          <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
        )
      }
    >
      <button type="button" className="tab-button" disabled={onOpen === undefined} onClick={onOpen}>
        <CrumbWords look={{ icon, label: holder.name }} />
      </button>
    </Tooltip>
  );
}

/**
 * The pane's path, task › agent, each crumb drawn as its tab is in the
 * task's column, the task's document glyph and the agent's mark: each opens
 * what it names, the task or the agent's tab, and hangs the card its
 * sidebar row or tab hangs, the task's crumb as every place naming the
 * task does (`TaskRef`). An agent with no task stands under the automation
 * that started it instead, by its clock and name, which hang its card and
 * open the automation's page where that can be opened. An agent this window does
 * not list, one started on another Mac, hangs a card saying so and still
 * opens its tab.
 */
function Crumbs({
  holder,
  by,
  doors,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
}): React.JSX.Element {
  const { name, agent } = by.subject;
  return (
    <nav className="file-breadcrumbs inbox-crumbs" aria-label="Path">
      <ol>
        <li className="tab inbox-crumb">
          {holder.kind === INBOX_HOLDER.TASK ? (
            <TaskRef
              task={holder.task}
              card={doors.taskCard}
              onOpen={doors.onOpenHolder ?? (() => undefined)}
              className="tab-button"
            >
              <CrumbWords look={tabLook({ kind: TAB_KIND.PLAN, name: holder.task.name })} />
            </TaskRef>
          ) : (
            <AutomationCrumb holder={holder} onOpen={doors.onOpenHolder} />
          )}
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
 * One item at reading size, as a comment thread: under the pane's crumbs,
 * the item's title as the thread's subject, with its agent, when it asked,
 * and where it stands; then the agent's question as the first comment, its
 * blocks and what it offers, and what came of it as the comments after.
 * While the item waits, a choice's options and a form's fields are pressed
 * in the question, and the box is docked at the pane's foot. Once it is
 * settled, the options fold to one line saying who picked which, and the
 * developer's answer follows as their comment, when and whether it reached
 * the agent, their pick as a chip over their words; or the agent's own
 * comment says it took the item back, and why; and where the box stood,
 * the next item that needs the developer is offered (`inbox-pager.tsx`).
 * Where the item stands alone, the whole Inbox wide, the crumbs follow a
 * way back to the list (`inbox-columns.ts`), its tooltip naming Back's
 * chord, which goes back as Escape does, and the bar ends in the pager,
 * "2 of 8" and the arrows up and down the list (`inbox-pager.tsx`).
 */
export function InboxPane({
  holder,
  item,
  control,
  agents,
  doors,
  hidden,
  onBack,
  pager,
  next,
  mentions,
}: {
  /** What holds the item: its task, or the automation that started its agent with no task. */
  holder: InboxHolder;
  item: InboxItem;
  /** The live read of the item's task, or of its agent with no task, which answers it and holds its draft. */
  control: TaskInboxControl;
  agents: CodingAgentsControl;
  doors: InboxPaneDoors;
  /** Whether the list stands alone in the item's place. */
  hidden: boolean;
  /** Goes back to the list, where the item stands alone. */
  onBack: (() => void) | undefined;
  /** Where the item stands in the list and the steps either side, drawn at the bar's end where the item stands alone among others. */
  pager: InboxPager | undefined;
  /** The next item that needs the developer, offered where the box stood once the item is settled. */
  next: InboxNext | undefined;
  /** What the box's `@` offers where the page around the pane hands nothing, as the window's Inbox does; the page's own otherwise. */
  mentions?: PlanMentionsValue | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  // Note that the pane stands for every item in turn, so another item opens at its thread's top rather than where the last was scrolled.
  useLayoutEffect(() => {
    if (board.current !== null) board.current.scrollTop = 0;
  }, [item.id]);
  const by: ItemAgent = {
    subject: agentSubject(agents, item.agentId, NOTHING_HELD, false),
    models: agents.models,
    onOpen: () => doors.onOpenAgent(item.agentId),
  };
  const open = item.status === INBOX_STATUS.OPEN;
  const draft = control.draftOf(item);
  // Note that the item's words are read under its own workspace, its plan's or its agent's, never the one the Inbox lists, which may not be the item's.
  const workspaceId = itemWorkspaceId(holder, item.agentId);
  return (
    <section className="inbox-view-items" aria-label={cardTitle(item.title)} hidden={hidden}>
      <header className="desktop-toolbar">
        {onBack === undefined ? null : (
          <Tooltip label={BACK_TO_INBOX} command={APP_COMMAND.BACK}>
            <button
              type="button"
              className="toolbar-button inbox-back"
              aria-label="Inbox"
              onClick={onBack}
            >
              <BackIcon />
              <span className="inbox-back-word">Inbox</span>
            </button>
          </Tooltip>
        )}
        <Crumbs holder={holder} by={by} doors={doors} />
        {pager === undefined ||
        (pager.onPrevious === undefined && pager.onNext === undefined) ? null : (
          <InboxPagerControls pager={pager} />
        )}
      </header>
      <div className="desktop-inbox">
        <div
          // The box docks under the thread as an agent's composer does under its log, which runs up to the card and fades there.
          className={`inbox-board scroll-fade ph-no-capture flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-(--section-gap) ${open ? "agent-log-over-composer" : "pb-5"}`}
          data-item-id={item.id}
          ref={board}
        >
          <WordsWorkspace value={workspaceId}>
            <Subject item={item} by={by} readerId={agents.me} now={now} />
            <ol className="inbox-thread" aria-label="Thread">
              <Comment
                kind={COMMENT.ASKED}
                face={by.subject.tile}
                head={
                  <>
                    <CommentName>
                      <AgentName by={by} />
                    </CommentName>
                    <span className="inbox-comment-when">
                      <RelativeTime className={THREAD_TIME_CLASS} at={item.postedAt} now={now} />
                    </span>
                  </>
                }
              >
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
                  // Keyed by its item, so the fold opened on one item stands closed on the next.
                  <Offered key={item.id} item={item} />
                )}
              </Comment>
              <Answered
                item={item}
                by={by}
                now={now}
                images={control.images}
                onImage={control.onImage}
                onRetryImage={control.onRetryImage}
              />
              <Withdrawn item={item} by={by} now={now} />
            </ol>
          </WordsWorkspace>
          {control.failed ? (
            <ErrorState onRetry={control.onRetry}>{INBOX_FAILED_LINE}</ErrorState>
          ) : null}
        </div>
        {open ? (
          <AnswerMentions value={mentions}>
            <InboxAnswerBox
              item={item}
              control={control}
              agent={by.subject.agent}
              skills={agents.readSkills}
              keywords={answerKeywords(holder, item)}
            />
          </AnswerMentions>
        ) : next === undefined ? null : (
          <InboxNextUp next={next} />
        )}
      </div>
    </section>
  );
}
