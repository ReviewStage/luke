import type { FileChip } from "@luke/features/attachment-model";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import {
  fieldValueWords,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
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
  type InboxMessage,
  inboxAnswerHeard,
  knownBlock,
  knownResponse,
} from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { CodeRef } from "@luke/features/task-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackIcon,
  Breadcrumbs,
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_SELECT,
  CHOICE_TONE,
  Checkbox,
  ChoiceList,
  type ChoiceOption,
  type Crumb,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  ErrorState,
  FoldingButton,
  type FoldingButtonHint,
  FormField,
  GAP,
  SCROLL_FADE,
  ScrollArea,
  Stack,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  Text,
  TextField,
} from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import { PICTURE_STATE } from "@luke/ui/picture-cache";
import { copiedLines, fileRefText } from "@luke/voice/code-pane-model";
import { isWireString } from "@luke/wire";
import { CheckIcon, ClockIcon, FactoryIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorLine, ActorMark, ActorRef, AutomationCard } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { PictureBlock } from "../picture-block.js";
import { SpinnerRegion } from "../spinner.js";
import { TextLink } from "../text-link.js";
import { Tooltip } from "../tooltip.js";
import {
  AgentActorRef,
  AgentCard,
  type AgentSubject,
  agentSubject,
  NOTHING_HELD,
} from "./agent-ref.js";
import { ArchivedComposerNote } from "./archived-task.js";
import { AttachedFileChips } from "./attached-file-chips.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { CodeCardHeader, CodeLines } from "./code-pane.js";
import type { ReadFileWindow } from "./file-tab.js";
import { InboxAnswerBox } from "./inbox-answer-box.js";
import { type FormTextDoors, type FormTextProps, InboxFormText } from "./inbox-form-text.js";
import {
  archivedHolder,
  CODE_READ,
  CODE_READ_FAILED,
  type CodeRead,
  codeNotice,
  codeReadOf,
  codeWindow,
  decidedOf,
  decisionsOf,
  fieldValueOf,
  INBOX_HOLDER,
  INBOX_MISSING,
  type InboxDecided,
  type InboxDraft,
  type InboxHolder,
  type InboxMissing,
  inboxFileChips,
  itemWorkspaceId,
  numberedPick,
  proposedOptions,
  SETTLED_BY,
  sentenceCased,
  settledAt,
  settlementOf,
  THREAD_ENTRY,
  threadCut,
  threadEntries,
  withDecision,
  withValue,
} from "./inbox-model.js";
import { type InboxNext, InboxNextUp, type InboxPager, InboxPagerControls } from "./inbox-pager.js";
import { RelativeTime } from "./relative-time.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { TAB_KIND, tabLook } from "./tab-look.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { useMinute } from "./task-time.js";
import { cardTitle } from "./tool-call-model.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { WordsWorkspace } from "./use-link-standing.js";
import { opensAsLink } from "./use-open-link.js";
import type { InboxImage, TaskInboxControl } from "./use-task-inbox.js";

/**
 * inbox-pane.tsx -- one inbox item at reading size: a comment thread under the item's title, the agent's question, everything it offered, and its answer, given in place or as it was given.
 *
 * The item reads as a comment thread, as an issue or a pull request does:
 * its title alone leads as the thread's subject. Each message under it is a comment, its
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
 * message: a choice's options, one perhaps recommended, a radio list where
 * it takes one and a checkbox list where it takes several, each numbered
 * for the key that picks it from anywhere in the Inbox but a field; an
 * approval's two cards, Approve and Decline, picked as a choice of two is,
 * a green or a red mark once picked; a to-do's card, its step beside a
 * checkbox and a "Couldn't do it" pill under it, picked the same way; a
 * form's fields stacked, each its name over its control at one left edge,
 * "Optional" after the name of one that may be left empty, a select's
 * options pills that wrap, a yes or no a checkbox, a number a short field,
 * and a text field the composer's own field with its mentions and skills
 * (`inbox-form-text.tsx`); nothing for words or a note. Enter on an option or in a field sends the answer as
 * the box's Send does, and never presses the option, Space and the arrow
 * keys being an option's own. While the item
 * waits, the agent composer's box, its card and its field, with its `@`
 * mentions, its skills, and its microphone (`inbox-answer-box.tsx`), is
 * docked under the thread for the note, and every item is sent by its one
 * Send, a note's reading "Got it" until a word is written. A card whose
 * agent need not hear back says whether its answer will message the agent:
 * a bare answer does not, and a typed note does. Once the item is settled,
 * what it offered folds to one line saying who picked which, which opens
 * to the options, or the decisions it was answered by, with the developer's
 * pick marked and the rest stepped back; the developer's answer follows as
 * their comment, when and whether it reached the agent as a message or was
 * kept for it to read, then what they picked as a chip and what they
 * wrote, their note drawn as the agent's tab draws a sent message, its
 * mentions chips; or the agent's comment says it took the item back, and
 * why. The thread's messages, a member's or the agent's, written at any
 * point, stand among these comments in the order they were written, each
 * by its writer's face and name, its files and its words drawn as an
 * answer's are; a thread read cut to its latest says the earlier ones are
 * in the agent's tab. The box stays docked on a settled item too, where it
 * writes a message on the thread rather than an answer, the next item that
 * needs the developer offered over it, and the reader's own message is
 * scrolled into view inside the board as it lands. A block or a response of a type
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
 *
 * Words selected in what the agent wrote, its question's Markdown, its
 * messages on the thread, and why it took the item back, stand Reply over
 * them, as an agent's words do in its tab (`reply-to-selection.tsx`): a
 * press lays them into the box as a quote block, so an answer or a message
 * can answer the agent point by point. Reply stands only while the box
 * takes a quote: never while an answer is out, a dictation holds the box,
 * or its editor is still loading (`inbox-answer-box.tsx`).
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

/** How long ago a thread's line says something happened: in the caption type, quieter still, in tabular figures, as a card's corner says it (`.thread-time`, tasks.css). */
const THREAD_TIME_CLASS = "thread-time";

/** What the way back from an item standing alone to the list says it does. */
const BACK_TO_INBOX = "Back to inbox";

/**
 * The way back's pill, which says where it goes and names Back's chord
 * whether its word is folded away or not. Note that it drops the folded
 * label it is handed, because the pill says more than the word does.
 */
const BackHint: FoldingButtonHint = ({ children }) => (
  <Tooltip label={BACK_TO_INBOX} command={APP_COMMAND.BACK}>
    {children}
  </Tooltip>
);

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
        {label} <span className="inbox-link-address">{url}</span>
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
        <div className="file-tab-notice">
          {shown.again ? (
            <ErrorState onRetry={() => setAsked((was) => was + 1)}>{shown.line}</ErrorState>
          ) : (
            <p role="alert">{shown.line}</p>
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
      // The agent's words, which a selection inside may be replied to.
      return (
        <div data-inbox-markdown="" {...{ [REPLY_SCOPE]: "" }}>
          <TranscriptWords text={block.text} />
        </div>
      );
    case INBOX_BLOCK.LINK:
      return (
        <p className="inbox-words">
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
    <Stack gap={GAP.CONTROL}>
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
          <Text key={index} tone={TEXT_TONE.MUTED}>
            {NEWER_LUKE.BLOCK}
          </Text>
        ),
      )}
    </Stack>
  );
}

/** The words a choice's open options are named by, for a reader that does not see the question over them. */
const CHOICE_LEGEND = "Options";

/** The badge an option the agent recommends wears, a choice's or a form's select's. */
const RECOMMENDED = "Recommended";

/** A choice's options as `@luke/ui`'s ChoiceList draws them, the one the agent recommends wearing its badge. */
export function choiceOptions(
  options: readonly { label: string; detail?: string | undefined; recommended: boolean }[],
): ChoiceOption<string>[] {
  return options.map((option) => ({
    value: option.label,
    label: option.label,
    detail: option.detail,
    badge: option.recommended ? RECOMMENDED : undefined,
  }));
}

/** Where a choice's open options stand, which a number key and Enter's way to what is missing find them by. */
const OPTIONS_ATTRIBUTE = "data-inbox-options";

/** The options of the open item's choice, in their order. */
function optionRows(pane: HTMLElement): HTMLButtonElement[] {
  return [
    ...pane.querySelectorAll<HTMLButtonElement>(
      `[${OPTIONS_ATTRIBUTE}] [role="radio"], [${OPTIONS_ATTRIBUTE}] [role="checkbox"]`,
    ),
  ];
}

/**
 * A choice's options, a radio list where it takes one and a checkbox list
 * where it takes several, each pressed to pick it and pressed again to let
 * it go. Where `numbered`, each of the first nine wears the number that
 * picks it, which the Inbox's pane answers (`useOptionNumbers`).
 */
export function ChoiceOptions({
  choice,
  draft,
  disabled,
  numbered = false,
  onDraft,
}: {
  choice: InboxChoice;
  draft: InboxDraft;
  disabled: boolean;
  numbered?: boolean;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const options = choiceOptions(
    choice.options.map((option) => ({
      ...option,
      recommended: choice.recommended === option.label,
    })),
  );
  return (
    <div {...{ [OPTIONS_ATTRIBUTE]: "" }}>
      <ChoiceList
        legend={CHOICE_LEGEND}
        options={options}
        value={draft.choices}
        select={choice.multiple === true ? CHOICE_SELECT.MANY : CHOICE_SELECT.ONE}
        look={CHOICE_LOOK.MARKED}
        numbered={numbered}
        clearable
        disabled={disabled}
        onChange={(choices) => onDraft({ ...draft, choices: [...choices] })}
      />
    </div>
  );
}

/** What an approval's cards are named by, for a reader that does not see the question over them. */
const DECISION_LEGEND = "Decision";

/** What a to-do's card is named by, for a reader that does not see the question over it. */
const TODO_LEGEND = "To-do";

/** What each decision's mark fills with once picked: going ahead in green, holding back in red. */
const DECISION_TONE = [CHOICE_TONE.COMPLETE, CHOICE_TONE.DANGER] as const;

/**
 * A response's two decisions as cards, numbered for the keys that pick
 * them, the pick's mark green for going ahead and red for holding back, and
 * the pick waiting for Send: an approval's Approve and Decline side by side,
 * and a to-do's step, the item's own title, over its "Couldn't do it".
 */
function DecisionCards({
  response,
  draft,
  disabled,
  todo,
  onDraft,
}: {
  response: InboxDecided;
  draft: InboxDraft;
  disabled: boolean;
  /** The to-do's title, which names its step, where the response is a to-do. */
  todo?: string | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const decided = decidedOf(response, draft);
  return (
    <div {...{ [OPTIONS_ATTRIBUTE]: "" }}>
      <ChoiceList
        legend={todo === undefined ? DECISION_LEGEND : TODO_LEGEND}
        options={decisionsOf(response).map((decision, index) => ({
          value: decision.reply,
          label: index === 0 && todo !== undefined ? todo : decision.label,
          tone: DECISION_TONE[index],
        }))}
        value={decided === undefined ? [] : [decided]}
        look={CHOICE_LOOK.MARKED}
        flow={todo === undefined ? CHOICE_FLOW.ACROSS : CHOICE_FLOW.DOWN}
        numbered
        clearable
        disabled={disabled}
        onChange={(picked) => {
          const [reply] = picked;
          onDraft(reply === undefined ? { ...draft, choices: [] } : withDecision(draft, reply));
        }}
      />
    </div>
  );
}

/** What marks a field that may be left empty, since most must be filled. */
const OPTIONAL = "Optional";

/** A field's name, and "Optional" after it where it may be left empty. */
function FieldLabel({ field }: { field: InboxField }): React.JSX.Element {
  return (
    <>
      {field.label}
      {field.required === true ? null : <span className="inbox-field-optional">{OPTIONAL}</span>}
    </>
  );
}

/** How a form's text fields are drawn where the caller draws its own: the Inbox's composer field. */
export type FormText = (props: FormTextProps) => React.ReactNode;

/** The parts of a field a frame's attributes name, which Enter's way to an empty field finds it by. */
function fieldFrame(field: InboxField) {
  return {
    className: "inbox-field",
    "data-inbox-field": field.type,
    "data-inbox-field-label": field.label,
  } as const;
}

/**
 * One field of a form, its name over its control and left-aligned as every
 * field is, "Optional" after the name of one that may be left empty: a
 * text field the caller's own or `@luke/ui`'s, a number a short field, a
 * select its options as pills that wrap, the one the agent recommends
 * wearing its badge, an optional one's pick taken back by pressing it
 * again, and a yes or no a checkbox beside its name.
 */
function InboxFormField({
  field,
  draft,
  disabled,
  text,
  onDraft,
}: {
  field: InboxField;
  draft: InboxDraft;
  disabled: boolean;
  text: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case INBOX_FIELD.TEXT:
      return (
        <div {...fieldFrame(field)}>
          <FormField label={<FieldLabel field={field} />}>
            {(control) => {
              const words = value === undefined ? "" : String(value);
              const onChange = (typed: string | undefined) =>
                set(typed === undefined || typed === "" ? undefined : typed);
              return text === undefined ? (
                <TextField
                  field={control}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={words}
                  disabled={disabled}
                  onChange={onChange}
                />
              ) : (
                text({ field, control, value: words, disabled, onChange })
              );
            }}
          </FormField>
        </div>
      );
    case INBOX_FIELD.NUMBER:
      return (
        <div {...fieldFrame(field)}>
          <FormField label={<FieldLabel field={field} />}>
            {(control) => (
              <div className="inbox-field-short">
                <TextField
                  field={control}
                  type={TEXT_FIELD_TYPE.NUMBER}
                  maxLength={INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS}
                  value={value === undefined ? undefined : Number(value)}
                  disabled={disabled}
                  onChange={set}
                />
              </div>
            )}
          </FormField>
        </div>
      );
    case INBOX_FIELD.SELECT:
      return (
        <div {...fieldFrame(field)}>
          <span className="inbox-field-name" aria-hidden="true">
            <FieldLabel field={field} />
          </span>
          <ChoiceList
            legend={field.label}
            options={(field.options ?? []).map((option) => ({
              value: option,
              label: option,
              badge: field.recommended === option ? RECOMMENDED : undefined,
            }))}
            value={(field.options ?? []).filter((option) => option === value)}
            look={CHOICE_LOOK.PILL}
            clearable={field.required !== true}
            disabled={disabled}
            onChange={(picked) => set(picked[0])}
          />
        </div>
      );
    case INBOX_FIELD.BOOLEAN:
      return (
        <div {...fieldFrame(field)}>
          <Checkbox checked={value === true} disabled={disabled} onChange={set}>
            <FieldLabel field={field} />
          </Checkbox>
        </div>
      );
  }
}

/** A form's fields, stacked in the agent's order; its text fields drawn by `text` where it is given. */
export function FormFields({
  form,
  draft,
  disabled,
  text,
  onDraft,
}: {
  form: InboxForm;
  draft: InboxDraft;
  disabled: boolean;
  text?: FormText | undefined;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      {form.fields.map((field) => (
        <InboxFormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          text={text}
          onDraft={onDraft}
        />
      ))}
    </Stack>
  );
}

/** The controls an item's response puts between its blocks and its box: a choice's options, a form's fields, nothing for the rest. */
function ResponseControls({
  item,
  draft,
  disabled,
  text,
  onDraft,
}: {
  item: InboxItem;
  draft: InboxDraft;
  disabled: boolean;
  /** What a form's text fields are written with. */
  text: FormTextDoors;
  onDraft: (draft: InboxDraft) => void;
}): React.JSX.Element | null {
  const response = item.response;
  if (!knownResponse(response)) return null;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return (
        <ChoiceOptions
          choice={response}
          draft={draft}
          disabled={disabled}
          numbered
          onDraft={onDraft}
        />
      );
    case INBOX_RESPONSE.APPROVAL:
      return (
        <DecisionCards response={response} draft={draft} disabled={disabled} onDraft={onDraft} />
      );
    case INBOX_RESPONSE.TODO:
      return (
        <DecisionCards
          response={response}
          draft={draft}
          disabled={disabled}
          todo={cardTitle(item.title)}
          onDraft={onDraft}
        />
      );
    case INBOX_RESPONSE.FORM:
      return (
        <FormFields
          form={response}
          draft={draft}
          disabled={disabled}
          text={(props) => <InboxFormText {...props} doors={text} />}
          onDraft={onDraft}
        />
      );
    default:
      return null;
  }
}

/** What an editor's own element matches, its words written in place, and a field of several lines. */
const WRITES_LINES = 'textarea, [contenteditable]:not([contenteditable="false"])';

/** Whether a key goes to whatever takes typing: a field, a select, or an editor. */
function takesTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(`input, select, ${WRITES_LINES}`);
}

/** Whether a key goes to something written in lines, whose own Enter breaks one: an editor or a field of several lines. */
function writesLines(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches(WRITES_LINES);
}

/** Whether a key comes alone, with no modifier but perhaps Shift. */
function bareKey(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * Sends the open item's answer from wherever in its pane the developer
 * pressed Enter, through its box's own send, so the box's checks stand: an
 * answer complete goes, and one that is not takes the keyboard to what it
 * lacks (`InboxAnswerBox`).
 */
function sendFromPane(pane: HTMLElement | null): void {
  pane?.querySelector<HTMLFormElement>("form.inbox-answer")?.requestSubmit();
}

/**
 * Enter in an open item's question, on an option or in a form's field,
 * sends the answer, and never presses the option it stands on; Shift+Enter
 * is no send, and an editor's Enter is the editor's own to hand on.
 */
function onResponseKey(
  pane: React.RefObject<HTMLElement | null>,
  event: React.KeyboardEvent,
): void {
  // Note that the key is held back here, as it bubbles, which keeps a focused option's button from pressing it.
  if (event.key !== "Enter" || event.shiftKey || !bareKey(event) || event.nativeEvent.isComposing) {
    return;
  }
  if (writesLines(event.target)) return;
  event.preventDefault();
  sendFromPane(pane.current);
}

/**
 * Takes the keyboard to what the answer lacks: the option a reader's Tab
 * lands on, the field's first control, or the box's words.
 */
function focusMissing(pane: HTMLElement | null, missing: InboxMissing): void {
  if (pane === null) return;
  if (missing.kind === INBOX_MISSING.OPTION) {
    const rows = optionRows(pane);
    (rows.find((row) => row.tabIndex === 0) ?? rows[0])?.focus();
    return;
  }
  if (missing.kind === INBOX_MISSING.WORDS) {
    pane.querySelector<HTMLElement>('.inbox-answer [contenteditable="true"]')?.focus();
    return;
  }
  const field = [...pane.querySelectorAll<HTMLElement>("[data-inbox-field]")].find(
    (each) => each.dataset.inboxFieldLabel === missing.label,
  );
  field
    ?.querySelector<HTMLElement>(
      'input, [contenteditable="true"], button:not([tabindex="-1"]):not(:disabled)',
    )
    ?.focus();
}

/** The responses whose options a number key picks: a choice's, and an approval's or a to-do's two. */
const NUMBERED_RESPONSES: ReadonlySet<string> = new Set([
  INBOX_RESPONSE.CHOICE,
  INBOX_RESPONSE.APPROVAL,
  INBOX_RESPONSE.TODO,
]);

/** The keys 1 to 9, each the option of its number. */
const OPTION_NUMBER = /^[1-9]$/u;

/**
 * The number keys pick an open item's options, a choice's or an approval's
 * or a to-do's two, 1 the first, as a press on
 * the option would, and take the keyboard to it, wherever in the Inbox the
 * developer stands but a field or an editor, whose keys are its own, and
 * never under a dialog. Note that the keys are heard on the document,
 * because a reader stepping the list with J and K holds the keyboard on its
 * row rather than in the pane.
 */
function useOptionNumbers(
  pane: React.RefObject<HTMLElement | null>,
  item: InboxItem,
  draft: InboxDraft,
  control: TaskInboxControl,
  answerable: boolean,
): void {
  const latest = useRef({ item, draft, control });
  latest.current = { item, draft, control };
  const numbered = answerable && NUMBERED_RESPONSES.has(item.response.type);
  useEffect(() => {
    if (!numbered) return;
    const onKey = (event: KeyboardEvent) => {
      const { item, draft, control } = latest.current;
      const shown = pane.current;
      if (!OPTION_NUMBER.test(event.key) || !bareKey(event) || event.shiftKey) return;
      if (event.defaultPrevented || event.isComposing || takesTyping(event.target)) return;
      if (
        shown === null ||
        shown.hidden ||
        document.querySelector('[aria-modal="true"]') !== null
      ) {
        return;
      }
      const inbox = shown.parentElement;
      const from = event.target;
      if (from !== document.body && !(from instanceof Node && inbox?.contains(from) === true))
        return;
      const number = Number(event.key);
      const picked = numberedPick(item, draft, number);
      if (picked === undefined || control.sending.has(item.id)) return;
      event.preventDefault();
      control.onDraft(item, picked);
      optionRows(shown)[number - 1]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [numbered, pane]);
}

/** The item's agent as the pane names it, the catalog its card names the model from, and the press that opens its tab. */
interface ItemAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** The agent in a line of the thread: its tile and name, which hang its card and open its tab. */
function AgentName({
  by,
  nameOnly = false,
}: {
  by: ItemAgent;
  /** Whether the name stands without its tile, as a comment's writer does beside their face. */
  nameOnly?: boolean;
}): React.JSX.Element {
  return (
    <AgentActorRef subject={by.subject} models={by.models} onOpen={by.onOpen} nameOnly={nameOnly} />
  );
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
 * What a settled item offered, as a settled ChoiceList: the developer's
 * pick in the look of a picked option, a check and whose pick it was,
 * "Your pick" or "Charles Pan’s pick", beside its label, and the rest
 * stepped back to an outline, so what was offered and what was chosen read
 * together. The option the agent recommended keeps its badge.
 */
function Proposal({ item }: { item: InboxItem }): React.JSX.Element | null {
  const answerer = usePerson(item.answeredBy);
  const options = proposedOptions(item);
  if (options.length === 0) return null;
  return (
    <ChoiceList
      legend="What the agent offered"
      options={choiceOptions(options)}
      value={options.filter((option) => option.picked).map((option) => option.label)}
      settled
      pickedNote={
        <ActorLine>
          <ActorRef actor={answerer} possessive />
          {" pick"}
        </ActorLine>
      }
    />
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
    <Disclosure data-inbox-offered="">
      <DisclosureSummary>
        <span>{summary}</span>
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
        <Proposal item={item} />
      </DisclosureBody>
    </Disclosure>
  );
}

/** Which message of the thread a comment is: the agent's question, the developer's answer, the agent taking the item back, or a message on the thread. */
const COMMENT = {
  ASKED: "asked",
  ANSWERED: "answered",
  WITHDRAWN: "withdrawn",
  MESSAGE: "message",
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
  messageId,
  children,
}: {
  kind: CommentKind;
  face: Actor;
  head: React.ReactNode;
  /** The message a thread's message comment draws, which a send scrolls to. */
  messageId?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="inbox-comment" data-inbox-comment={kind} data-message-id={messageId}>
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

/** The files of one comment, and how their bytes are read. */
interface CommentFilesProps {
  itemId: string;
  files: NonNullable<InboxItem["answerFiles"]>;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}

/**
 * The files the developer's answer or a message on the thread carried, as
 * the agent's tab draws a sent message's (`attached-file-chips.tsx`): each
 * asks for its bytes as it is first drawn, through the same read an image
 * block's picture takes, and is drawn by its name alone until they land;
 * where a read did not answer, a line under the files says so with Retry,
 * as an image block's does.
 */
function CommentFiles({
  itemId,
  files,
  images,
  onImage,
  onRetryImage,
}: CommentFilesProps): React.ReactNode {
  useEffect(() => {
    for (const file of files) {
      if (!images.has(file.attachmentId)) onImage(itemId, file.attachmentId);
    }
  }, [files, images, itemId, onImage]);
  const failed = files.filter((file) => {
    const read = images.get(file.attachmentId);
    return read !== undefined && "failed" in read;
  });
  return (
    <>
      <AttachedFileChips files={inboxFileChips(files, images)} />
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

/** No files, one array so a comment that has none hands down the same one. */
const NO_FILES: NonNullable<InboxItem["answerFiles"]> = [];

/**
 * A form's values as the developer filled them, one a line in the form's
 * order: each field's name, then what was put in it, a text field's words
 * drawn as the agent's tab draws a sent message, so a mention they hold is
 * its chip, and any other field's value in its words, "yes" or "no" for a
 * yes or no.
 */
function FormValues({ item }: { item: InboxItem }): React.JSX.Element | null {
  const values = item.answer?.values ?? [];
  if (values.length === 0) return null;
  const response = item.response;
  const texts = new Set(
    knownResponse(response) && response.type === INBOX_RESPONSE.FORM
      ? response.fields
          .filter((field) => field.type === INBOX_FIELD.TEXT)
          .map((field) => field.label)
      : [],
  );
  return (
    <ul className="inbox-values" data-inbox-values="">
      {values.map(({ label, value }) => (
        <li key={label} className="inbox-value">
          <span className="inbox-value-label">{label}</span>
          <div className="inbox-words inbox-value-words">
            {texts.has(label) && isWireString(value) ? (
              <SentWords text={value} />
            ) : (
              fieldValueWords(value)
            )}
          </div>
        </li>
      ))}
    </ul>
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
            <ActorRef actor={answerer} nameOnly />
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime
              className={THREAD_TIME_CLASS}
              at={settledAt(item) ?? item.updatedAt}
              now={now}
            />{" "}
            · <Delivered item={item} by={by} />
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
      {settled.values === undefined ? null : <FormValues item={item} />}
      <CommentFiles
        itemId={item.id}
        files={item.answerFiles ?? NO_FILES}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      {/* The note is drawn as the agent's tab draws a message, so a mention it holds is its chip. */}
      {settled.note === undefined ? null : (
        <div className="inbox-words" data-inbox-note="">
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
            <AgentName by={by} nameOnly />
          </CommentName>
          <span className="inbox-comment-when">
            withdrew this{" "}
            <RelativeTime
              className={THREAD_TIME_CLASS}
              at={settledAt(item) ?? item.updatedAt}
              now={now}
            />
          </span>
        </>
      }
    >
      {settled.words === undefined ? undefined : (
        <p className="inbox-words" {...{ [REPLY_SCOPE]: "" }}>
          {settled.words}
        </p>
      )}
    </Comment>
  );
}

/**
 * One message on the thread as its writer's comment: a member by their
 * face and name, "You" for the reader's own, someone unnamed where their
 * account is gone; the agent by its tile and name, as its question is.
 * The files it carried are drawn as an answer's are, then its words as the
 * agent's tab draws a sent message, its mentions chips; a message of files
 * alone draws them alone.
 */
function Message({
  item,
  message,
  by,
  now,
  images,
  onImage,
  onRetryImage,
}: {
  item: InboxItem;
  message: InboxMessage;
  by: ItemAgent;
  now: number;
  images: TaskInboxControl["images"];
  onImage: TaskInboxControl["onImage"];
  onRetryImage: TaskInboxControl["onRetryImage"];
}): React.JSX.Element {
  const member = usePerson(message.member);
  const fromAgent = message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  return (
    <Comment
      kind={COMMENT.MESSAGE}
      face={fromAgent ? by.subject.tile : member}
      messageId={message.id}
      head={
        <>
          <CommentName>
            {fromAgent ? <AgentName by={by} nameOnly /> : <ActorRef actor={member} nameOnly />}
          </CommentName>
          <span className="inbox-comment-when">
            <RelativeTime className={THREAD_TIME_CLASS} at={message.createdAt} now={now} />
          </span>
        </>
      }
    >
      <CommentFiles
        itemId={item.id}
        files={message.files ?? NO_FILES}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      {message.text === "" ? null : (
        <div
          className="inbox-words"
          data-inbox-message-text=""
          // The agent's words alone may be replied to, as in its tab, never a member's.
          {...(fromAgent ? { [REPLY_SCOPE]: "" } : {})}
        >
          <SentWords text={message.text} />
        </div>
      )}
    </Comment>
  );
}

/** Where a thread read carries only its latest messages: a line saying the earlier ones stand in the agent's tab, the agent's name opening it. */
function EarlierMessages({ by }: { by: ItemAgent }): React.JSX.Element {
  return (
    <li className="inbox-thread-earlier" data-inbox-earlier="">
      <ActorLine>
        {"Earlier messages are in "}
        <AgentName by={by} />
        {"’s tab"}
      </ActorLine>
    </li>
  );
}

/**
 * What follows the question, in the order it was written: the thread's
 * messages, and where it was settled, the answer or the agent taking it
 * back; a line first where the thread read carries only its latest
 * messages.
 */
function ThreadAfter({
  item,
  by,
  now,
  control,
}: {
  item: InboxItem;
  by: ItemAgent;
  now: number;
  control: TaskInboxControl;
}): React.JSX.Element {
  const { images, onImage, onRetryImage } = control;
  return (
    <>
      {threadCut(item) ? <EarlierMessages by={by} /> : null}
      {threadEntries(item).map((entry) =>
        entry.kind === THREAD_ENTRY.SETTLED ? (
          <SettledComments
            key="settled"
            item={item}
            by={by}
            now={now}
            images={images}
            onImage={onImage}
            onRetryImage={onRetryImage}
          />
        ) : (
          <Message
            key={entry.message.id}
            item={item}
            message={entry.message}
            by={by}
            now={now}
            images={images}
            onImage={onImage}
            onRetryImage={onRetryImage}
          />
        ),
      )}
    </>
  );
}

/** The comment a settled item was settled by: the developer's answer, or the agent taking it back. */
function SettledComments({
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
}): React.JSX.Element {
  return (
    <>
      <Answered
        item={item}
        by={by}
        now={now}
        images={images}
        onImage={onImage}
        onRetryImage={onRetryImage}
      />
      <Withdrawn item={item} by={by} now={now} />
    </>
  );
}

/**
 * Scrolls the board to a message of the reader's own the moment it lands
 * on the thread, inside the board's own scroller, since the pane may still
 * be sliding in (`AGENTS.md`'s panel motion): far enough that its foot
 * stands above the box, and no further than its head. A message another
 * wrote, or another item opened, scrolls nothing.
 */
function useScrollToOwnMessage(
  board: React.RefObject<HTMLDivElement | null>,
  item: InboxItem,
  readerId: string | undefined,
): void {
  const last = item.messages?.at(-1);
  const own =
    last !== undefined &&
    last.author === INBOX_MESSAGE_AUTHOR.MEMBER &&
    readerId !== undefined &&
    last.member?.userId === readerId;
  const seen = useRef({ itemId: item.id, lastId: last?.id });
  useLayoutEffect(() => {
    const was = seen.current;
    seen.current = { itemId: item.id, lastId: last?.id };
    const scroller = board.current;
    if (!own || scroller === null || was.itemId !== item.id || was.lastId === last?.id) return;
    const comment = scroller.querySelector(`[data-message-id="${CSS.escape(last.id)}"]`);
    if (comment === null) return;
    const room = scroller.getBoundingClientRect();
    const box = comment.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
    const under = box.bottom - (room.bottom - padding);
    if (under > 0) scroller.scrollTop += Math.min(under, box.top - room.top);
  }, [board, item.id, last, own]);
}

/** What stands in the box's place while the item's task is archived. */
const ARCHIVED_ITEM_NOTE = "Unarchive the task to answer or reply";

/**
 * The thread's subject, as a plan or a pull request leads with one: the
 * item's title alone, the thread under it.
 */
function Subject({ item }: { item: InboxItem }): React.JSX.Element {
  return (
    <header className="inbox-subject">
      <h2 className="inbox-subject-title" data-inbox-title="">
        {cardTitle(item.title)}
      </h2>
    </header>
  );
}

/** The box's mentions where the pane is handed them; the page's own where it is not. */
function AnswerMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
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
  /** Brings the item's task back from the archive, offered where the box would stand while it is archived; none where the task is not archived. */
  readonly onUnarchive?: (() => void) | undefined;
}

/**
 * An automation's crumb, as its page's own look names it: its clock and its
 * name, hanging its card where the window reads it, and opening its page
 * where that can be opened.
 */
function useAutomationCrumb(
  holder: InboxHolder,
  onOpen: (() => void) | undefined,
): Crumb | undefined {
  const automationId = holder.kind === INBOX_HOLDER.AUTOMATION ? holder.automationId : null;
  const known = useAutomation(automationId ?? undefined);
  if (holder.kind !== INBOX_HOLDER.AUTOMATION) return undefined;
  return {
    label: holder.name,
    // Note that the agents no automation names stand under no automation, so their crumb wears the Factory's glyph, where every agent is listed, as their group's header does.
    glyph: holder.automationId === null ? <FactoryIcon /> : <ClockIcon />,
    hint: holder.name,
    card:
      known === undefined ? undefined : (
        <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
      ),
    onPress: onOpen === undefined ? undefined : () => onOpen(),
  };
}

/**
 * The pane's path, task › agent, each crumb wearing its tab's glyph in the
 * task's column, the task's document glyph and the agent's mark: each opens
 * what it names, the task or the agent's tab, and hangs the card its
 * sidebar row or tab hangs. An agent with no task stands under the
 * automation that started it instead, by its clock and name, which hang its
 * card and open the automation's page where that can be opened, and are
 * words alone where it cannot. An agent this window does not list, one
 * started on another Mac, hangs a card saying so and still opens its tab.
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
  const automation = useAutomationCrumb(holder, doors.onOpenHolder);
  const onOpenHolder = doors.onOpenHolder;
  const task: Crumb | undefined =
    holder.kind === INBOX_HOLDER.TASK
      ? {
          label: holder.task.name,
          glyph: tabLook({ kind: TAB_KIND.PLAN, name: holder.task.name }).icon,
          hint: holder.task.name,
          card: doors.taskCard,
          onPress: () => onOpenHolder?.(),
        }
      : undefined;
  const crumbs: Crumb[] = [
    task ?? automation,
    {
      label: name,
      glyph: tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon,
      hint: name,
      card: <AgentCard subject={by.subject} models={by.models} />,
      onPress: () => by.onOpen(),
    },
  ].filter((crumb) => crumb !== undefined);
  return (
    <div className="inbox-crumbs">
      <Breadcrumbs label="Path" crumbs={crumbs} hint={Tooltip} />
    </div>
  );
}

/**
 * One item at reading size, as a comment thread: under the pane's crumbs,
 * the item's title alone as the thread's subject; then the agent's question as the first comment, its
 * blocks and what it offers, and what came of it as the comments after.
 * While the item waits, a choice's options and a form's fields are pressed
 * in the question, and the box is docked at the pane's foot. Once it is
 * settled, the options fold to one line saying who picked which, and the
 * developer's answer follows as their comment, when and whether it reached
 * the agent, their pick as a chip over their words; or the agent's own
 * comment says it took the item back, and why; the thread's messages
 * stand among them by when they were written; and over the box, which now
 * writes a message on the thread, the next item that needs the developer
 * is offered (`inbox-pager.tsx`).
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
  /** The next item that needs the developer, offered over the box once the item is settled. */
  next: InboxNext | undefined;
  /** What the box's `@` offers where the page around the pane hands nothing, as the window's Inbox does; the page's own otherwise. */
  mentions?: TaskMentionsValue | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  // Note that the pane stands for every item in turn, so another item opens at its thread's top rather than where the last was scrolled.
  useLayoutEffect(() => {
    if (board.current !== null) board.current.scrollTop = 0;
  }, [item.id]);
  const directory = useMemberDirectory();
  useScrollToOwnMessage(board, item, directory.readerId ?? agents.me);
  const by: ItemAgent = {
    subject: agentSubject(agents, item.agentId, NOTHING_HELD, false),
    models: agents.models,
    onOpen: () => doors.onOpenAgent(item.agentId),
  };
  const open = item.status === INBOX_STATUS.OPEN;
  // An item put away with its task is read but not answered, nor written on, until the task is back.
  const archived = archivedHolder(holder);
  const answerable = open && !archived;
  const draft = control.draftOf(item);
  useOptionNumbers(pane, item, draft, control, answerable);
  // Note that the item's words are read under its own workspace, its plan's or its agent's, never the one the Inbox lists, which may not be the item's.
  const workspaceId = itemWorkspaceId(holder, item.agentId);
  return (
    <section
      ref={pane}
      className="inbox-view-items"
      aria-label={cardTitle(item.title)}
      hidden={hidden}
    >
      <header className="desktop-toolbar">
        {onBack === undefined ? null : (
          <FoldingButton label="Inbox" icon={<BackIcon />} onClick={onBack} hint={BackHint} />
        )}
        <Crumbs holder={holder} by={by} doors={doors} />
        {pager === undefined ||
        (pager.onPrevious === undefined && pager.onNext === undefined) ? null : (
          <InboxPagerControls pager={pager} />
        )}
      </header>
      <div className="desktop-inbox">
        {/* The box docks under the thread as an agent's composer does under its log, which runs up to the card and fades there. */}
        <ScrollArea fade={SCROLL_FADE.BOTH} data-item-id={item.id} ref={board}>
          <div className="inbox-board agent-log-over-composer ph-no-capture">
            <WordsWorkspace value={workspaceId}>
              <Subject item={item} />
              <ol className="inbox-thread" aria-label="Thread">
                <Comment
                  kind={COMMENT.ASKED}
                  face={by.subject.tile}
                  head={
                    <>
                      <CommentName>
                        <AgentName by={by} nameOnly />
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
                    // biome-ignore lint/a11y/noStaticElementInteractions: the keys it hears come from the options and fields inside it, whose Enter sends the answer.
                    <div
                      className="inbox-response"
                      onKeyDown={(event) => onResponseKey(pane, event)}
                    >
                      {/* A form's text field takes the box's mentions, so it offers what the box's `@` does. */}
                      <AnswerMentions value={mentions}>
                        <ResponseControls
                          item={item}
                          draft={draft}
                          disabled={!answerable || control.sending.has(item.id)}
                          text={{
                            self: item.agentId,
                            agent: by.subject.agent,
                            skills: agents.readSkills,
                            keywords: answerKeywords(holder, item),
                            onEnter: () => sendFromPane(pane.current),
                          }}
                          onDraft={(next) => control.onDraft(item, next)}
                        />
                      </AnswerMentions>
                    </div>
                  ) : (
                    // Keyed by its item, so the fold opened on one item stands closed on the next.
                    <Offered key={item.id} item={item} />
                  )}
                </Comment>
                <ThreadAfter item={item} by={by} now={now} control={control} />
              </ol>
            </WordsWorkspace>
            {control.failed ? (
              <ErrorState onRetry={control.onRetry}>{INBOX_FAILED_LINE}</ErrorState>
            ) : null}
          </div>
        </ScrollArea>
        {open || archived || next === undefined ? null : <InboxNextUp next={next} />}
        {archived ? (
          doors.onUnarchive === undefined ? null : (
            <ArchivedComposerNote onUnarchive={doors.onUnarchive} words={ARCHIVED_ITEM_NOTE} />
          )
        ) : (
          <AnswerMentions value={mentions}>
            <InboxAnswerBox
              item={item}
              control={control}
              agent={by.subject.agent}
              agentName={by.subject.name}
              skills={agents.readSkills}
              keywords={answerKeywords(holder, item)}
              replyScope={board}
              onMissing={(missing) => focusMissing(pane.current, missing)}
            />
          </AnswerMentions>
        )}
      </div>
    </section>
  );
}
