import { useAtomValue } from "@effect/atom-react";
import { CHAT_BOUNDS } from "@luke/features/chat-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import {
  ErrorState,
  GAP,
  Inline,
  SUBMIT_STATE,
  TEXT_AREA_GROW_LIMIT,
  TEXT_AREA_LOOK,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  Tooltip,
} from "@luke/ui";
import { cutReply, QUOTE_GAP, quoteOf } from "@luke/ui/reply-quote";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import { type ChatDraftPlace, DRAFT_PLACE, EMPTY_DRAFT, useDraft } from "../composer-drafts.js";
import { useLinkWorkspace } from "../copy-link-item.js";
import { enterKeyHint, enterSubmitKey } from "../enter-sends.js";
import { imageFiles } from "../feedback-images.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type MentionNode,
  type PlanEditorModule,
} from "../plan-editor/contract.js";
import { AttachFilesButton } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { readFiles, withFiles } from "./attached-files.js";
import { ComposerField } from "./composer-field.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { type MentionDoors, MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import {
  MENTION_MENU_SIDE,
  type MentionableChannel,
  type MentionMembers,
  type MentionSource,
  useMentionPicker,
} from "./mention-picker.js";
import { ComposerQuoteView } from "./reply-to-selection.js";
import { useMentionDoors, useTaskMentions } from "./task-mentions.js";
import { DICTATION_PHASE, useDictation } from "./use-dictation.js";
import { useKnownNames } from "./use-known-names.js";

/**
 * chat-composer.tsx -- the box a chat message is written in: at a place's foot, or under a thread opened for a reply, with the list an `@` or a `#` opens and a dictation laid in at the caret.
 *
 * The box is the shared composer card (`prompt-input.tsx`) around the agent
 * box's own editor (`composer-field.tsx`), as the agent tab's, the Inbox's,
 * and a plan comment's are, and under it the card's foot saying what it
 * takes, the microphone, and the shared round send. Enter sends, Shift-Enter
 * starts a new line, and the box is empty at once, keeping the caret, so
 * the next post can be written while this one goes, drawn in the stream as
 * on its way (`chat-pane.tsx`). A post refused comes back into the box with
 * why under it and Retry, which posts it once whatever the first try did,
 * since the same words go under the same key (`use-workspace-chat.ts`),
 * where the box holds nothing newer; else it stays where it went, marked
 * as not sent, with a Retry of its own. Escape, where no list or dictation takes it, leaves the box.
 * What is typed and not sent is kept per channel, and per thread for a
 * reply, as every box that sends somewhere keeps it (`composer-drafts.ts`),
 * so another channel opened, a thread hidden, or the window reloaded finds
 * it where it was left. An `@` at the start of a word opens the app's one
 * mention list at the word, as the agent box's, the Inbox's, and a plan
 * comment's do (`mention-picker.tsx`): the people and agents a mention here
 * tells first, then the channel's task, its repository's files, and its pull
 * requests where it has a task, and dates. A member chosen is written as
 * their chip, the same mention link the other boxes write
 * (`[@Ada Lovelace](…/person/<id>)`), which the service reads to tell them;
 * the box says so where a post would address more members than it tells. A
 * `#` opens the same list on the channels, one chosen written as its word
 * (`#general`). A Luke address pasted whole is written as its chip, as it is in the
 * agent box, the Inbox, and a plan comment (`pastedMentionNode`).
 * The microphone records a dictation and lays its words in at the
 * caret (`use-dictation.ts`), listening for the chat's members' names and
 * its channels' (`chatKeywords`). Pictures go with a post as files go with an Inbox
 * answer (`attached-files.ts`): the "+" at the foot's left opens the
 * system's picker for images, an image pasted into the box is taken, and
 * images dropped on the card are, each drawn as a chip above the words with
 * its way off, PNG, JPEG, and WebP kept and any other image re-encoded; a
 * file that cannot come says why under the card, and a post may be
 * pictures alone. While pictures are read the post waits for them. Where
 * the editor's bundle could not be loaded, a plain textarea stands in with
 * no list and no pictures, as a plan comment's does, so a message can
 * always be written. Words selected in the chat and replied to are laid
 * in as a quote block where the caret stands, as the agent box lays them
 * (`reply-to-selection.tsx`), through the door the box hands its place
 * (`replyDoor`), or handed with the box as it opens (`pendingQuote`) and
 * laid in once its editor stands; the plain box takes them as a
 * blockquote at its end, cut to the room the post has left. What
 * is typed is a person's words, so the box is out of a session recording
 * (`ph-no-capture`) as well as masked.
 */

/** What the send press is called. */
const SEND = "Send";

/** What the box's + is called, which is its tooltip too. */
const ATTACH = "Attach images";

/** The pictures the system's picker offers: any image, re-encoded where it is none of the three a post keeps. */
const PICKS_IMAGES = "image/*";

/** Why a file that is no image did not come, in the words the box's note says. */
const NOT_IMAGE = (name: string) => `${name} can't be attached. Attach images.`;

/** Whether a drag carries files, which is all the card takes from one. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/** What the box says where a post of its words would address more members than a post tells. */
const CROWDED = `Only ${CHAT_BOUNDS.MAX_STEERS_PER_POST} members are notified of a post.`;

/** What an `@` or a `#` in a chat box offers, as the place it stands in hands it (`chat-mention-source.ts`). */
export interface ChatComposerMentions {
  /** The task an `@` offers beside the members, with its repository and pull requests, and the workspace a mention is written in. */
  readonly source: MentionSource;
  /** The people and agents a mention here tells. */
  readonly members: MentionMembers;
  /** The channels a `#` names. */
  readonly channels: readonly MentionableChannel[];
  /** Whether a post of the words here would address more members than a post tells: those it mentions, then a reply's thread. */
  readonly crowded: (text: string) => boolean;
}

/** A quote handed to a box before it could take it, and what is told once it is in. */
interface PendingQuote {
  readonly words: string;
  readonly onQuoted: () => void;
}

/** What a chat box is handed by the place it stands in. */
interface ChatComposerProps {
  /** The channel the box posts in, which its draft is kept under. */
  readonly channelId: string;
  /** The thread's root the box replies under, by its place in the chat; none for a channel's foot. */
  readonly replyTo?: number | undefined;
  /** What the box asks for while empty, which names it for assistive technology too. */
  readonly label: string;
  /** What an `@` or a `#` offers. */
  readonly mentions: ChatComposerMentions;
  /** The words a dictation here is likely to say (`chatKeywords`). */
  readonly keywords: readonly string[];
  /** Whether it stands under a thread, a line high, rather than at a place's foot. */
  readonly compact?: boolean;
  /** Where the box hands the chat's Reply the door that lays a quote in, answering whether it did; none where nothing replies. */
  readonly replyDoor?: RefObject<((words: string) => boolean) | undefined> | undefined;
  /** A quote to lay in once the box can take it, as a Reply that opened the box hands it, `onQuoted` told once it is in. */
  readonly pendingQuote?: PendingQuote | undefined;
  /**
   * Sends the words and the pictures, either of which may be empty, the box
   * already empty for the next post; where they are refused, hands `takeBack`
   * why, which answers whether the box took them back (`ChatSend`).
   */
  readonly onSend: ChatSend;
}

/** The composer: the agent box's editor once its bundle has loaded, with dictation, and the plain box where the bundle failed, so a message can always be written. */
export function ChatComposer(props: ChatComposerProps): React.JSX.Element {
  const bundle = useAtomValue(useSideBundles().planEditor);
  if (AsyncResult.isFailure(bundle)) return <PlainChatComposer {...props} />;
  return (
    <EditorChatComposer
      {...props}
      module={AsyncResult.isSuccess(bundle) ? bundle.value : undefined}
    />
  );
}

/** The bar under the box, as the agent box's and the Inbox's stand: the parts it leads with (the + of pictures), then the parts the box hands it (dictation's) and the round send at its end. */
function ComposerFoot({
  empty,
  lead,
  children,
}: {
  empty: boolean;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <PromptInputFooter>
      <PromptInputTools>{lead}</PromptInputTools>
      <Inline gap={GAP.TIGHT} wrap={false}>
        {children}
        <Tooltip label={SEND}>
          <PromptInputSubmit label={SEND} status={SUBMIT_STATE.READY} disabled={empty} />
        </Tooltip>
      </Inline>
    </PromptInputFooter>
  );
}

/** What the box says under it: why a post did not go, which Retry sends again, or why a file or a dictation came to nothing. */
interface ComposerNote {
  readonly words: string;
  readonly retries: boolean;
}

/** A note that offers no Retry, or none at all. */
function plainNote(words: string | undefined): ComposerNote | undefined {
  return words === undefined ? undefined : { words, retries: false };
}

/** The draft's place: the channel's foot, or a thread in it. */
function chatPlace(channelId: string, replyTo: number | undefined): ChatDraftPlace {
  return replyTo === undefined
    ? { kind: DRAFT_PLACE.CHAT, channelId }
    : { kind: DRAFT_PLACE.CHAT, channelId, replyTo };
}

/**
 * How a box hands its post on: the words and the pictures, and what to do
 * where they are refused, `takeBack`, handed why, which answers whether the
 * box took them back, as it does where it holds nothing newer.
 */
type ChatSend = (
  text: string,
  attachments: readonly CodingAgentAttachment[],
  takeBack: (refused: string) => boolean,
) => void;

/** Whether a draft holds neither words nor pictures. */
function holdsNothing(draft: { readonly text: string; readonly attachments: readonly unknown[] }) {
  return draft.text.trim() === "" && draft.attachments.length === 0;
}

/**
 * Sends the draft kept for the box's place and its pictures, letting them go
 * at once so the box takes the next post while this one goes. Where it is
 * refused, the words and pictures come back into the box with why and
 * Retry, which sends them again under the same key, only where the box
 * holds nothing newer; else they stay on the post where it went. A send
 * waits while pictures handed to the box are still being read.
 */
function useChatSend(place: ChatDraftPlace, onSend: ChatComposerProps["onSend"]) {
  const { draft: kept, update } = useDraft(place);
  const draft = kept.text;
  const { attachments } = kept;
  // How many posts the box has sent, each of which hands the caret back to it.
  const [sends, setSends] = useState(0);
  // How many hand-offs of files are still being read, during which the post waits.
  const [reading, setReading] = useState(0);
  const [note, setNote] = useState<ComposerNote | undefined>(undefined);
  const empty = draft.trim() === "" && attachments.length === 0;
  const send = () => {
    if (empty || reading > 0) return;
    const sent = kept;
    setNote(undefined);
    setSends((count) => count + 1);
    // Note that only what was sent is let go, so words typed meanwhile in another window stay.
    update((now) =>
      now.text === sent.text && now.attachments === sent.attachments ? EMPTY_DRAFT : now,
    );
    onSend(draft.trim(), attachments, (refused) => {
      // Note that the draft store takes a change at once, so the box as the refusal lands decides.
      let back = false;
      update((now) => {
        back = holdsNothing(now);
        return back ? { ...EMPTY_DRAFT, text: sent.text, attachments: sent.attachments } : now;
      });
      if (back) setNote({ words: refused, retries: true });
      return back;
    });
  };
  const setDraft = (text: string) => update((was) => ({ ...was, text }));
  /** Reads the images among the files handed in and takes them after those the box holds; the first that cannot come says why. */
  const attach = (files: readonly File[]) => {
    if (files.length === 0) return;
    const images = imageFiles(files);
    const other = files.find((file) => !images.includes(file));
    setNote(plainNote(other === undefined ? undefined : NOT_IMAGE(other.name)));
    if (images.length === 0) return;
    setReading((count) => count + 1);
    readFiles(images)
      .then((read) => {
        // Taken after whatever the draft holds as the read lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        let refusal = read.refusal;
        update((was) => {
          const taken = withFiles(was.attachments, read, CHAT_BOUNDS.MAX_POST_PICTURES);
          refusal = taken.refusal;
          return { ...was, attachments: taken.attachments };
        });
        const said = refusal;
        if (said !== undefined) setNote((was) => was ?? plainNote(said));
      })
      .finally(() => setReading((count) => count - 1));
  };
  const remove = (index: number) => {
    setNote(undefined);
    update((was) => ({ ...was, attachments: was.attachments.filter((_, at) => at !== index) }));
  };
  return {
    draft,
    setDraft,
    attachments,
    attach,
    remove,
    sends,
    reading: reading > 0,
    empty,
    note,
    setNote,
    send,
  };
}

/** Where a box's note stands, under the card: why a post did not go, with Retry beside it, or why a file or a dictation came to nothing. */
function NoteLine({
  note,
  onRetry,
}: {
  note: ComposerNote | undefined;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (note === undefined) return null;
  return (
    <div className="agent-composer-note">
      <ErrorState onRetry={note.retries ? onRetry : undefined}>{note.words}</ErrorState>
    </div>
  );
}

/** A line under the box where a post would address more members than a post tells, since those past the first few hear nothing of it. */
function CrowdedNote({ shown }: { shown: boolean }): React.JSX.Element {
  return (
    <div className="chat-composer-crowded" role="status">
      {shown ? (
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {CROWDED}
        </Text>
      ) : null}
    </div>
  );
}

/** A chat box takes no skills, which are an agent's. */
const NO_SKILLS: ReadonlySet<string> = new Set();

/** The plan text a place off any task's page holds: none. */
const NO_TEXT = (): string => "";

/**
 * The mention a Luke address pasted whole stands for, as the other boxes
 * write it (`pastedMentionNode`). Note that the window's Chat stands on no
 * task's page, so its addresses are written under the workspace its links
 * are, and where none is known yet one pastes as the words it is, rather
 * than as a link naming no workspace.
 */
function usePastedMention(doors: MentionDoors): (words: string) => MentionNode | undefined {
  const known = useKnownNames();
  const text = useTaskMentions()?.text ?? NO_TEXT;
  const linkWorkspace = useLinkWorkspace();
  const workspace = doors.place.workspace === "" ? linkWorkspace : doors.place.workspace;
  return (words) =>
    workspace === undefined
      ? undefined
      : pastedMentionNode(
          words,
          { ...doors.place, workspace },
          { known, taskId: doors.taskId, text },
        );
}

/**
 * Hands `door` the box's way of laying a quote in, the latest drawn, for as
 * long as the box stands, and lays `pending` in once the box is `ready`.
 */
function useReplyDoor(
  door: ChatComposerProps["replyDoor"],
  quote: (words: string) => boolean,
  pending: PendingQuote | undefined,
  ready: boolean,
): void {
  const latest = useRef(quote);
  useLayoutEffect(() => {
    latest.current = quote;
  });
  useEffect(() => {
    if (door === undefined) return undefined;
    door.current = (words) => latest.current(words);
    return () => {
      door.current = undefined;
    };
  }, [door]);
  // Note that a quote handed while the editor's bundle still loads waits for it, rather than going nowhere.
  useEffect(() => {
    if (ready && pending !== undefined && latest.current(pending.words)) pending.onQuoted();
  }, [pending, ready]);
}

/** A quote as the plain box writes it at the end of `draft`, cut to the room the post has left; nothing where no word of it fits. */
function plainQuoted(draft: string, words: string): string | undefined {
  const before = draft.trimEnd();
  const lead = before === "" ? "" : `${before}${QUOTE_GAP}`;
  const room = CHAT_BOUNDS.MAX_TEXT_CHARS - lead.length - QUOTE_GAP.length;
  let kept = words;
  while (kept !== "") {
    const quoted = quoteOf(kept);
    if (quoted.length <= room) return `${lead}${quoted}${QUOTE_GAP}`;
    kept = cutReply(kept, kept.length - (quoted.length - room));
  }
  return undefined;
}

/** The box on the agent box's editor: `@` and `#` open the app's mention list at the word, and the microphone lays a dictation in at the caret. */
function EditorChatComposer({
  channelId,
  replyTo,
  label,
  mentions,
  keywords,
  compact,
  replyDoor,
  pendingQuote,
  onSend,
  module,
}: ChatComposerProps & { module: PlanEditorModule | undefined }): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [dropping, setDropping] = useState(false);
  const {
    draft,
    setDraft,
    attachments,
    attach,
    remove,
    sends,
    reading,
    empty,
    note,
    setNote,
    send,
  } = useChatSend(chatPlace(channelId, replyTo), onSend);
  const dictation = useDictation({
    editor,
    keywords,
    onNote: (words) => setNote(plainNote(words)),
  });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const doors = useMentionDoors();
  const pasted = usePastedMention(doors);
  // The chat's Reply lays its quote in where the caret stands, for as long as the box stands; the editor refuses it while a dictation holds the box.
  useReplyDoor(
    replyDoor,
    (words) => editor.current?.insertQuote(words) === true,
    pendingQuote,
    module !== undefined,
  );

  // Note that a send made from the box hands the caret back to it at once,
  // as a press of Send takes it, unless the caret went somewhere else
  // meanwhile, as the agent box's does (`agent-composer.tsx`).
  const refocus = useRef(false);
  useEffect(() => {
    if (sends === 0 || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    const dropped =
      active === null ||
      active === document.body ||
      room.current?.contains(active) === true ||
      (active instanceof HTMLButtonElement &&
        active.type === "submit" &&
        card.current?.contains(active) === true);
    if (dropped) editor.current?.focus();
  }, [sends]);
  // A mention is written as its chip, the link every box of the app writes; a channel as its word.
  const picker = useMentionPicker({
    source: mentions.source,
    members: mentions.members,
    channels: {
      known: mentions.channels,
      onChoose: (name) => editor.current?.chooseWords(`#${name}`),
    },
    room,
    side: MENTION_MENU_SIDE.ABOVE,
    onChoose: (mention) => editor.current?.chooseMention(mention),
  });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a drop target alone; the keys it hears come from its own field and buttons.
    <div
      ref={card}
      className="agent-composer chat-composer"
      data-compact={String(compact === true)}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // A drag moving onto one of the card's own children has not left it.
        const into = event.relatedTarget;
        if (!(into instanceof Node && event.currentTarget.contains(into))) setDropping(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        attach(Array.from(event.dataTransfer.files));
      }}
    >
      <PromptInput
        dropping={dropping}
        onSubmit={() => {
          refocus.current = card.current?.contains(document.activeElement) === true;
          send();
        }}
      >
        <AttachedFileChips files={attachmentChips(attachments)} onRemove={remove} />
        <ComposerField
          module={module}
          editor={editor}
          room={room}
          draft={draft}
          setDraft={setDraft}
          placeholder={label}
          label={label}
          input={dictating ? COMPOSER_INPUT.READ_ONLY : COMPOSER_INPUT.EDITABLE}
          maxLength={CHAT_BOUNDS.MAX_TEXT_CHARS}
          skills={NO_SKILLS}
          aria={{ ...picker.aria, "aria-placeholder": label }}
          onKey={(event) => {
            if (dictation.onFieldKey(event) || picker.onKey(event)) return true;
            // Escape, where no list or dictation takes it, leaves the box, as the agent box's does.
            if (event.key !== "Escape") return false;
            event.stopPropagation();
            editor.current?.blur();
            return true;
          }}
          onEnter={() => {
            if (room.current !== null) submitPromptInput(room.current);
          }}
          onPasteFiles={(files) => {
            // Only images are taken from the clipboard; text pastes as it always does.
            const pasted = imageFiles(files);
            if (pasted.length === 0) return false;
            attach(pasted);
            return true;
          }}
          onTrigger={() => undefined}
          chip={() => null}
          quote={(quote) => <ComposerQuoteView quote={quote} held={dictating} />}
          mentions={{
            onTrigger: picker.onTrigger,
            onChannelTrigger: picker.onChannelTrigger,
            chip: (mention, node) => (
              <MentionNodeChip
                mention={mention}
                doors={doors}
                edit={{ node, pickDate: picker.pickDate }}
              />
            ),
            pasted,
          }}
          // Note that a thread's box is opened by a press, so it takes the caret; a place's foot
          // leaves it where it is, as the Inbox's box does, because K and J step the chat's places
          // while the caret is out of the box.
          takesFocus={false}
          focus={compact === true ? true : undefined}
        >
          {picker.menu}
        </ComposerField>
        {dictating ? (
          <PromptInputFooter>
            <DictationStrip dictation={dictation} />
          </PromptInputFooter>
        ) : (
          <ComposerFoot
            empty={empty || reading}
            lead={<AttachFilesButton label={ATTACH} accept={PICKS_IMAGES} onFiles={attach} />}
          >
            <DictateButton dictation={dictation} disabled={module === undefined} />
          </ComposerFoot>
        )}
      </PromptInput>
      <CrowdedNote shown={mentions.crowded(draft)} />
      <NoteLine note={note} onRetry={send} />
    </div>
  );
}

/** The plain box a bundle that failed to load leaves: a textarea that posts its words, with no list, as a plan comment's plain box has none. */
function PlainChatComposer({
  channelId,
  replyTo,
  label,
  mentions,
  compact,
  replyDoor,
  pendingQuote,
  onSend,
}: ChatComposerProps): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, empty, note, send } = useChatSend(chatPlace(channelId, replyTo), onSend);
  // Note that the plain box has no quote block, so a reply's quote is written at its end as the Markdown it sends as.
  useReplyDoor(
    replyDoor,
    (words) => {
      const quoted = plainQuoted(draft, words);
      if (quoted === undefined) return false;
      setDraft(quoted);
      field.current?.focus();
      return true;
    },
    pendingQuote,
    true,
  );
  return (
    <div className="agent-composer chat-composer" data-compact={String(compact === true)}>
      <PromptInput onSubmit={send}>
        {/* Note that the field is left out of the screen recording whole, past its words' masking. */}
        <div className="ph-no-capture">
          <TextArea
            ref={field}
            look={TEXT_AREA_LOOK.BARE}
            growLimit={TEXT_AREA_GROW_LIMIT.NONE}
            grow
            label={label}
            placeholder={label}
            rows={compact === true ? 1 : 2}
            maxLength={CHAT_BOUNDS.MAX_TEXT_CHARS}
            enterKeyHint={enterKeyHint()}
            submitKey={enterSubmitKey()}
            value={draft}
            onChange={setDraft}
            // Note that a send goes through the form, whose held submit holds it too.
            onSubmit={() => {
              if (field.current !== null) submitPromptInput(field.current);
            }}
          />
        </div>
        <ComposerFoot empty={empty} />
      </PromptInput>
      <CrowdedNote shown={mentions.crowded(draft)} />
      <NoteLine note={note} onRetry={send} />
    </div>
  );
}
