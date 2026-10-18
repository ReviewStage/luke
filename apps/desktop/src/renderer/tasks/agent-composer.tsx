import { useAtomValue } from "@effect/atom-react";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentContext,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentUsage,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import {
  FAILURE_REASON,
  type Failure,
  remedyLabel,
  retriesBesideRemedy,
} from "@luke/features/failure-remedy";
import type { CatalogModel } from "@luke/features/models-wire";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "@luke/panel/ai-elements/prompt-input";
import { useSideBundles } from "@luke/panel/bundle-loader";
import { ActionMenu, type MenuAction } from "@luke/panel/desktop/action-menu";
import { imageFiles } from "@luke/panel/feedback-images";
import { GRANT_OUTCOME, useIntegrationGrant } from "@luke/panel/integration-grant";
import { useIntegrationStatuses } from "@luke/panel/integration-statuses";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "@luke/panel/plan-editor/contract";
import { readFiles, withFiles } from "@luke/panel/tasks/attached-files";
import { ComposerField } from "@luke/panel/tasks/composer-field";
import { DictateButton, DictationStrip } from "@luke/panel/tasks/dictation-strip";
import { ComposerQuoteView } from "@luke/panel/tasks/reply-to-selection";
import { useRepositoryRemedy } from "@luke/panel/tasks/repository-remedy";
import { Tooltip } from "@luke/panel/tooltip";
import {
  BUTTON_TYPE,
  EllipsisIcon,
  ErrorState,
  IconButton,
  McpIcon,
  MicrophoneIcon,
  PlusIcon,
  riseAboveEnd,
  SUBMIT_STATE,
  useMenu,
} from "@luke/ui";
import { lapsedServer, SERVER_HANDED } from "@luke/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { AgentContextRing } from "./agent-context";
import { contextHint } from "./agent-context-model";
import { AgentModelChip } from "./agent-model-chip";
import { BranchChip, type PublishedDoors } from "./agent-published";
import { AgentServersButton, type AgentServersControl } from "./agent-servers";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips";
import { useComposerPickers } from "./composer-pickers";
import type { SkillSource } from "./skill-picker";
import { useMentionBox } from "./task-mentions";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentModelControl } from "./use-agent-model";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, two chips at its foot, one button, and a note under it when a message or a change did not go or a server's sign-in expired.
 *
 * The box is the shared composer card (../ai-elements/prompt-input.tsx),
 * at its default type. Its foot is laid
 * out as ChatGPT's and Codex's are: at the left the "+" that attaches
 * files and, once the agent has pushed a branch with no pull request yet,
 * the branch's chip, which opens it on GitHub (`agent-published.tsx`); a
 * pull request, once one stands, is the row pinned over the card rather
 * than a chip here (`agent-tab.tsx`); at the right,
 * in this order, the model chip naming what the agent runs on, which opens
 * the menu that changes it for the next step (`agent-model-chip.tsx`),
 * the ring that shows, once a step has ended, how full the agent's model's
 * context is and opens what fills it (`agent-context.tsx`), the
 * microphone, and the round button. The box takes a message to the agent:
 * Enter sends it, Shift+Enter is a new line, and Escape leaves the box; the
 * box is an editor (`composer-field.tsx`) that holds plain words and a
 * chosen skill's chip, and the message is its words as a string. A
 * message sent while a turn runs steers it, so the agent sees it at its
 * next step; sent idle, it opens a new turn. The box reads the same
 * whatever the agent is doing: one size, the same chips, no hint under it,
 * and one placeholder asking for a follow up, since a started agent's
 * conversation opens on its plan or task, because the tab's glyph and the transcript's "Working…"
 * line already say where the agent stands. The one thing that follows the agent's state is
 * the button at the card's right, the way every chat draws it: Send while
 * there are words or files, disabled while there are neither and the agent
 * is idle, and Stop while there are neither and a turn runs, which is the
 * one Stop the tab has. A message that did not go stays in the box with why under the card
 * and what mends it (`@luke/ui`'s `ErrorState`): Retry, which sends it again
 * under the same key, so a send whose answer was lost reaches the agent
 * once, or, for a repository out of reach, the press its reason names
 * (`repository-remedy.tsx`), a move of the task sending it again by itself
 * once it lands; an agent that takes no message any more keeps the box,
 * disabled, with the reason under it; a change of model that did not take
 * says why in the same place, and with nothing else to say there, a server
 * the agent has on whose sign-in expired is offered to reconnect, in place, as
 * the MCP popover reconnects it; an editor bundle that could not be loaded
 * says so there too. The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the plan, and a message sent
 * from the box, by Enter or by Send, hands the caret back to the box as it
 * opens again, unless the developer went somewhere else meanwhile, so the
 * next message is written at once. A draft agent's tab
 * draws the same box over a start rather than a message, asking for the
 * first message of its still empty conversation, and its model chip once
 * the choice it starts on is known.
 *
 * Files go with a message the way every chat takes them: the "+" at the
 * foot's left opens the system's file picker, an image pasted into the box
 * is taken, and files dropped on the card are, each drawn as a chip above
 * the words with its way off (`attached-file-chips.tsx`). A file that
 * cannot come says why under the card while the rest still come
 * (`attached-files.ts`). A message is words, files, or both, as the wire
 * takes it (`hasWordsOrFiles`), so files alone send too.
 *
 * Words selected in one of the agent's messages and answered with Reply
 * are laid into the words as a quote block under the line the caret stands
 * on, and the caret goes to a fresh line under it, so the developer answers
 * there; Reply again without a word between stacks the quotes, and words
 * between them answer point by point (`reply-to-selection.tsx`). A quote
 * goes out as a Markdown blockquote set apart by a blank line. Note that
 * a quote is part of the words like any other, and sends as they do,
 * because the words cannot tell a Reply's quote from a `>` line the
 * developer typed or pasted, and one of those alone is a message.
 *
 * Words can be spoken into the box as well: the microphone left of the
 * round button records in place of the foot's controls until ✓ or Enter sends the clip
 * to be heard and the words land at the caret, or ✕ or Escape drops it
 * (`use-dictation.ts`, `dictation-strip.tsx`). Why a dictation left nothing
 * is said in the same note a file's refusal is.
 *
 * An `@` at the start of a word, on a task's page, opens the list of what
 * the message can mention, the task's repository's files and folders, the
 * plan's sections, the pages agents showed on it, its other coding agents,
 * the repository's skills, and the account's connected MCP servers and
 * their tools
 * (`mention-picker.tsx`), and the one chosen is written into the words as
 * its link, drawn as its chip (`mention-chip.tsx`). The `@` and `/` lists and the
 * microphone are the Inbox's answer box's too (`composer-pickers.tsx`). A server mentioned is
 * handed to the agent's next turn even where its switch is off, and to that
 * turn alone.
 *
 * A `/` at the start of a word opens the list of the skills the task's
 * repository keeps, at the caret, and the one chosen is written into the
 * words as its chip, read as `/name`, which the agent loads before it acts
 * and a press opens the `SKILL.md` of (`skill-picker.tsx`).
 *
 * The foot answers the card's own width, not the window's, so the box
 * holds in the main column and the side panel alike, the way Cursor's and
 * ChatGPT's narrow panes do (planning.css's `composer` container). As the
 * card narrows, the branch's chip draws its mark alone; then a ⋯ takes in, in this order, the MCP
 * servers, the context ring, and the microphone; then the model chip draws
 * its harness's mark alone; and last the + goes into the ⋯ too. The field
 * and the round Send or Stop always stand whole. The chips drawing their
 * marks alone are `FOLD_WIDTH`'s, read off the card's width here; what the
 * ⋯ takes in is the stylesheet's, which it offers as it opens, read off the
 * foot itself; a popover it opens hangs at the foot's right, where its own
 * hidden press stood.
 *
 * New task's composer is this same box over a start rather than a message
 * (`new-task-composer.tsx`): its owner names what the box asks for and
 * calls its round button (`wording`), lays its Linear issue over the words
 * (`above`), stands its repository and Linear chips after the "+" (`tools`)
 * and its Plan toggle before the model chip (`actions`), holds Start while
 * it cannot start (`sendable`), hears the keys the field leaves (`onKey`),
 * says what Escape does (`onLeave`), and offers no MCP servers, so the
 * box draws no servers' button.
 */

/** What the box's note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The message box could not be loaded.";

/** What the box says it takes: the first message of an empty conversation, then a follow up. */
const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow up",
} as const;

/** What a box other than an agent's own asks for, calls its field, and calls its round button. */
export interface ComposerWords {
  readonly placeholder: string;
  readonly label: string;
  readonly send: string;
}

/** The buttons' names, which are their tooltips too. */
const BUTTON = {
  SEND: "Send",
  STOP: "Stop",
  STOPPING: "Stopping…",
  ATTACH: "Attach files",
  MORE: "More",
} as const;

/**
 * The card widths below which a chip draws its mark alone: the branch's
 * chip first, then the model chip. Note that they are steps of the same
 * order as the stylesheet's (tasks.css's `composer` queries, at 400 and 240),
 * because the room each leaves is counted on the steps before it.
 */
const FOLD_WIDTH = {
  PUBLISHED: 520,
  MODEL: 300,
} as const;

/** The presses a narrow card's ⋯ takes in, by the class each wears on the foot. */
const OVERFLOW_PRESS = {
  ATTACH: "agent-composer-attach",
  SERVERS: "agent-servers-button",
  CONTEXT: "agent-context-button",
  DICTATE: "dictate-button",
} as const;

type OverflowPress = (typeof OVERFLOW_PRESS)[keyof typeof OVERFLOW_PRESS];

/** A press the ⋯ may take in, and what the menu offers in its place. */
interface OverflowOffer {
  press: OverflowPress;
  action: MenuAction;
}

/** Whether a drag carries files, which is all the card takes from one. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/** The presses standing on the foot that the stylesheet hid for want of room. */
function hiddenPresses(foot: HTMLElement | null): readonly OverflowPress[] {
  if (foot === null) return [];
  return Object.values(OVERFLOW_PRESS).filter((press) => {
    const element = foot.querySelector(`.${press}`);
    return element !== null && getComputedStyle(element).display === "none";
  });
}

/**
 * The width the card's form lays its foot out in, the box the stylesheet's
 * `composer` queries read, followed as it resizes; nothing before it was
 * laid out, which draws every chip whole.
 */
function useFootWidth(card: RefObject<HTMLDivElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const form = card.current?.querySelector("form");
    if (form === null || form === undefined) return undefined;
    const measure = () => {
      const style = getComputedStyle(form);
      const inner =
        form.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      setWidth(inner > 0 ? inner : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [card]);
  return width;
}

/**
 * The foot's ⋯, which the stylesheet shows only once the card is too narrow
 * for every press: opened, it offers each press the stylesheet hid, read as
 * it opens, so it never offers one still standing beside it. The card
 * changing width closes it, since what it offers was read at the old
 * width; the panel beside it may be dragged with no window resize.
 */
function ComposerMore({
  foot,
  offers,
}: {
  foot: RefObject<HTMLDivElement | null>;
  offers: readonly OverflowOffer[];
}): React.JSX.Element {
  const menu = useMenu(true);
  const [taken, setTaken] = useState<readonly OverflowPress[]>([]);
  const trigger = menu.trigger(riseAboveEnd);
  const standing = menu.open !== undefined;
  const { close } = menu;
  useEffect(() => {
    const card = foot.current;
    if (!standing || card === null) return undefined;
    const width = card.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      if (card.getBoundingClientRect().width !== width) close(false);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [standing, close, foot]);
  const actions = offers.filter((offer) => taken.includes(offer.press)).map((each) => each.action);
  return (
    <>
      <span className="agent-composer-more">
        <Tooltip label={BUTTON.MORE}>
          <IconButton
            icon={<EllipsisIcon />}
            label={BUTTON.MORE}
            {...trigger}
            onClick={(event) => {
              setTaken(hiddenPresses(foot.current));
              trigger.onClick(event);
            }}
          />
        </Tooltip>
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={BUTTON.MORE} menu={menu.drawn} groups={[actions]} onClose={menu.close} />
      )}
    </>
  );
}

export function AgentComposer({
  agentId,
  status,
  composer,
  model,
  models,
  readModels,
  usage,
  servers,
  context,
  brief,
  published,
  doors,
  onStop,
  followsUp,
  keywords = [],
  skills,
  replyDoor,
  sendsEmpty = false,
  closedRemedy,
  wording,
  above,
  tools,
  actions,
  sendable = true,
  onKey,
  onLeave,
  focusedByOwner = false,
}: {
  /** The agent the box writes to, which its `@` list does not offer; none for a draft not yet started. */
  agentId?: string | undefined;
  status: CodingAgentStatus;
  composer: AgentComposerControl;
  /** What the agent runs on and its chip's change; nothing while it is not yet known, which draws no chip. */
  model: AgentModelControl | undefined;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  readModels: () => void;
  /** What the agent has cost, said at the chip's menu's foot; nothing before a turn settled. */
  usage: CodingAgentUsage | undefined;
  /** The MCP servers the agent is handed and their switches; none where the box offers none, as New task's does. */
  servers: AgentServersControl | undefined;
  /** What the agent's model's context holds, which the ring draws; nothing before a step ended, which draws no ring. */
  context?: CodingAgentContext | undefined;
  /** What the agent was handed, which names the brief's part of the context. */
  brief?: CodingAgentBrief | undefined;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** Stops the agent; the promise settles once the service has answered. */
  onStop: () => Promise<void>;
  /** Whether the conversation already holds a message, so the box takes a follow up rather than the first. */
  followsUp: boolean;
  /** The words a dictation is likely to say, read off the plan (`dictation-keywords.ts`). */
  keywords?: readonly string[] | undefined;
  /** Where the skills a `/` offers are read from (`skill-picker.tsx`); nothing where the box offers none. */
  skills?: SkillSource | undefined;
  /** Where the box hands the transcript's Reply the door that lays a quote in at its caret; none where nothing replies. */
  replyDoor?: RefObject<((words: string) => void) | undefined> | undefined;
  /** Whether an empty box sends too, as a fork's draft does, which needs no words of its own. */
  sendsEmpty?: boolean;
  /** What mends a box closed for good, drawn after its note: Continue in new agent (`continue-agent.tsx`); none where nothing does. */
  closedRemedy?: ReactNode;
  /** What the box asks for, calls its field, and calls its round button, where its owner says other than an agent's box does, as New task's does. */
  wording?: ComposerWords | undefined;
  /** What stands over the words inside the card, before the files attached: New task's Linear issue. */
  above?: ReactNode;
  /** What stands after the "+" at the foot's left: New task's repository and Linear chips. */
  tools?: ReactNode;
  /** What stands first among the foot's right-hand presses, before the model chip: New task's Plan toggle. */
  actions?: ReactNode;
  /** Whether the round button may send at all, beside the words: New task's is held while Agent mode has no repository. */
  sendable?: boolean;
  /** A key pressed in the field that neither its lists nor dictation took, and none while a file is still being read; answers whether it took it. */
  onKey?: ((event: KeyboardEvent) => boolean) | undefined;
  /** What Escape in the field does where no list or dictation takes it; the field gives up the caret where none is given. */
  onLeave?: (() => void) | undefined;
  /** Whether the owner hands the field focus where it stands as the box first draws, as a dialog's card does, so the field takes it itself only where its editor lands later. */
  focusedByOwner?: boolean;
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const footWidth = useFootWidth(card);
  const folds = (below: number) => footWidth !== undefined && footWidth < below;
  // The popovers the ⋯ may open in place of their hidden presses.
  const [serversOpen, setServersOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  // How many hand-offs are still being read, during which Send waits, so no
  // message goes without a file the developer already handed the box.
  const [reading, setReading] = useState(0);
  // Note that files are read through a ref, because reading them takes a
  // while and the box they land in is whichever render is current by then.
  const latest = useRef(composer);
  latest.current = composer;
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = status === CODING_AGENT_STATUS.RUNNING;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const empty = !sendsEmpty && !hasWordsOrFiles(composer.draft.trim(), composer.attachments);
  const showsStop = empty && stoppable && !composer.sending;
  const bundle = useAtomValue(useSideBundles().planEditor);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  // Whether the editor stood as the box first drew, which an owner that focuses the field focuses.
  const [mountedFirst] = useState(module !== undefined);
  const statuses = useIntegrationStatuses();
  const grant = useIntegrationGrant(statuses);
  // A reconnect that could not begin says so in the note, as Settings' row does.
  const [reconnectFailed, setReconnectFailed] = useState<string | undefined>(undefined);
  const reconnect = (server: string) => {
    setReconnectFailed(undefined);
    void grant.begin(server).then((outcome) => {
      if (outcome === GRANT_OUTCOME.NOT_OPENED || outcome === GRANT_OUTCOME.REFUSED) {
        setReconnectFailed(server);
      }
    });
  };
  // Note that a box handing no servers, as New task's, offers none to reconnect either.
  const lapsed =
    servers === undefined
      ? undefined
      : lapsedServer({
          statusOf: statuses.statusOf,
          accountsOf: statuses.accountsOf,
          disabled: servers.disabled,
        });
  const unloaded = AsyncResult.isFailure(bundle) ? EDITOR_LOAD_FAILED : undefined;
  const words =
    composer.closed ??
    refusal ??
    unloaded ??
    (composer.note === undefined ? model?.note : undefined);
  const note: Failure | undefined =
    words !== undefined
      ? { reason: FAILURE_REASON.OTHER, text: words }
      : (composer.note ??
        (lapsed === undefined
          ? undefined
          : {
              reason: FAILURE_REASON.RECONNECT_INTEGRATION,
              text:
                reconnectFailed === lapsed.connection
                  ? `${lapsed.name}'s sign-in expired, and Luke could not start reconnecting it. Try again in a moment.`
                  : `${lapsed.name}'s sign-in expired.`,
              provider: lapsed.provider,
              ...(lapsed.connection === lapsed.provider
                ? undefined
                : { connection: lapsed.connection, name: lapsed.name }),
            }));
  // Retry is the composer's own: a change of model that did not take is made again from the chip.
  const retries = note !== undefined && note === composer.note;
  const repositoryRemedy = useRepositoryRemedy();
  const remedy =
    note === undefined
      ? undefined
      : note.reason === FAILURE_REASON.RECONNECT_INTEGRATION
        ? () => reconnect(note.connection ?? note.provider)
        : // Note that a move's retry is the box's as the move lands, and only while the refusal it
          // was pressed for still stands, so an edit or a later send meanwhile is never sent over.
          repositoryRemedy(note, () => {
            if (latest.current.note === note) latest.current.retry();
          });
  // Note that a remedy finished where Luke cannot watch keeps Retry beside it, since the same send goes once it is done.
  const remedyWords = note === undefined ? undefined : remedyLabel(note);
  // Note that a closed box asks for nothing, since it takes nothing.
  const placeholder = closed
    ? ""
    : (wording?.placeholder ?? (followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST));
  const sendLabel = wording?.send ?? BUTTON.SEND;

  // Note that a held box gives up the caret, because a field that takes no
  // words, and a Send disabled under the press, can hold none; a send made
  // from the box hands it back as the box opens again, unless the caret went
  // somewhere else meanwhile: to another field, or to a press or a menu in
  // the box's own foot, such as the model chip's search.
  const refocus = useRef(false);
  useEffect(() => {
    if (held || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    const dropped =
      active === null ||
      active === document.body ||
      room.current?.contains(active) === true ||
      (active instanceof HTMLButtonElement &&
        active.type === "submit" &&
        card.current?.contains(active) === true);
    if (dropped) {
      editor.current?.focus();
    }
  }, [held]);

  // The transcript's Reply lays its quote in where the caret stands, for as long as the box stands.
  useEffect(() => {
    if (replyDoor === undefined) return undefined;
    replyDoor.current = (words) => {
      editor.current?.insertQuote(words);
    };
    return () => {
      replyDoor.current = undefined;
    };
  }, [replyDoor]);

  // The `@` and `/` lists, dictation, and the keys that work them, as the Inbox's answer box has them.
  const pickers = useComposerPickers({
    editor,
    room,
    draft: composer.draft,
    placeholder,
    self: agentId,
    skills,
    keywords,
    // A server's chip in the box says what a send now does with it: opens a turn, or steers the one running.
    servers: {
      statuses,
      place: {
        disabled: servers?.disabled ?? [],
        handed: stoppable ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    onNote: setRefusal,
    onLeave,
  });
  const { dictation, dictating } = pickers;
  // A file's lines picked in a File tab on the page (⌥⌘K) are laid in here, where the caret stands.
  useMentionBox((mention) => editor.current?.insertMention(mention));

  const stop = () => {
    setStopping(true);
    onStop().finally(() => setStopping(false));
  };

  // Note that a popover closed by key while the ⋯ stands hands focus to the
  // ⋯, after its own close has handed it to its hidden press, because a
  // hidden press can hold no keyboard; with the press drawn, the ⋯ is not.
  const handBack = (set: (open: boolean) => void) => (open: boolean) => {
    const more = foot.current?.querySelector<HTMLElement>(".agent-composer-more") ?? null;
    const press = more?.querySelector<HTMLElement>("button") ?? null;
    const returning =
      !open && (document.activeElement?.closest(".luke-anchored-popover") ?? null) !== null;
    set(open);
    if (returning && more !== null && press !== null && getComputedStyle(more).display !== "none") {
      queueMicrotask(() => press.focus());
    }
  };

  const offers: OverflowOffer[] = [
    {
      press: OVERFLOW_PRESS.ATTACH,
      action: {
        label: BUTTON.ATTACH,
        icon: <PlusIcon />,
        disabled: held,
        onSelect: () => picker.current?.click(),
      },
    },
    ...(servers === undefined
      ? []
      : [
          {
            press: OVERFLOW_PRESS.SERVERS,
            action: {
              label: "MCP servers",
              icon: <McpIcon />,
              onSelect: () => setServersOpen(true),
            },
          },
        ]),
    ...(context === undefined
      ? []
      : [
          {
            press: OVERFLOW_PRESS.CONTEXT,
            action: { label: contextHint(context), onSelect: () => setContextOpen(true) },
          },
        ]),
    {
      press: OVERFLOW_PRESS.DICTATE,
      action: {
        label: "Dictate",
        icon: <MicrophoneIcon />,
        disabled: held || module === undefined,
        onSelect: dictation.start,
      },
    },
  ];

  const attach = (files: readonly File[]) => {
    if (files.length === 0 || held) return;
    setReading((count) => count + 1);
    readFiles(files)
      .then((read) => {
        // Taken after whatever the box holds as the read lands, so neither a
        // read that landed first nor a chip taken off meanwhile is undone.
        setRefusal(withFiles(latest.current.attachments, read).refusal);
        latest.current.setAttachments((now) => withFiles(now, read).attachments);
      })
      .finally(() => setReading((count) => count - 1));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a drop target alone; the keys it hears come from its own field and buttons.
    <div
      ref={card}
      className="agent-composer"
      data-status={status}
      data-dropping={dropping ? "" : undefined}
      data-closed={closed ? "" : undefined}
      onDragOver={(event) => {
        if (!carriesFiles(event) || held) return;
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
        onSubmit={() => {
          setRefusal(undefined);
          refocus.current = card.current?.contains(document.activeElement) === true;
          composer.send();
        }}
      >
        {above}
        <AttachedFileChips
          files={attachmentChips(composer.attachments)}
          onRemove={
            held
              ? undefined
              : (index) => {
                  setRefusal(undefined);
                  composer.setAttachments((now) => now.filter((_, at) => at !== index));
                }
          }
        />
        <ComposerField
          module={module}
          editor={editor}
          room={room}
          draft={composer.draft}
          setDraft={composer.setDraft}
          placeholder={placeholder}
          label={wording?.label ?? "Message to the agent"}
          input={
            held
              ? COMPOSER_INPUT.DISABLED
              : dictating
                ? COMPOSER_INPUT.READ_ONLY
                : COMPOSER_INPUT.EDITABLE
          }
          maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
          takesFocus={!(focusedByOwner && mountedFirst)}
          {...pickers.field}
          onKey={(event) =>
            pickers.field.onKey(event) ||
            // A file still being read holds the owner's keys too, as it holds Send.
            (reading === 0 && onKey?.(event) === true)
          }
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
          quote={(quote) => <ComposerQuoteView quote={quote} held={held} />}
        />
        <PromptInputFooter ref={foot}>
          {dictating ? (
            <DictationStrip dictation={dictation} />
          ) : (
            <>
              <PromptInputTools>
                <span className="agent-composer-attach">
                  <Tooltip label={BUTTON.ATTACH}>
                    <IconButton
                      icon={<PlusIcon />}
                      label={BUTTON.ATTACH}
                      disabled={held}
                      onClick={() => picker.current?.click()}
                    />
                  </Tooltip>
                </span>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const picked = Array.from(event.currentTarget.files ?? []);
                    // Cleared so the same file can be picked again after it was taken off.
                    event.currentTarget.value = "";
                    attach(picked);
                  }}
                />
                <BranchChip
                  published={published}
                  doors={doors}
                  narrow={folds(FOLD_WIDTH.PUBLISHED)}
                />
                {tools}
              </PromptInputTools>
              <div className="agent-composer-actions">
                {actions}
                {model === undefined ? null : (
                  <AgentModelChip
                    model={model}
                    models={models}
                    readModels={readModels}
                    usage={usage}
                    narrow={folds(FOLD_WIDTH.MODEL)}
                  />
                )}
                {servers === undefined ? null : (
                  <AgentServersButton
                    servers={servers}
                    statuses={statuses}
                    open={serversOpen}
                    onOpenChange={handBack(setServersOpen)}
                  />
                )}
                <AgentContextRing
                  context={context}
                  brief={brief}
                  open={contextOpen}
                  onOpenChange={handBack(setContextOpen)}
                />
                <DictateButton dictation={dictation} disabled={held || module === undefined} />
                <ComposerMore foot={foot} offers={offers} />
                {showsStop ? (
                  <Tooltip label={stopping ? BUTTON.STOPPING : BUTTON.STOP}>
                    <PromptInputSubmit
                      type={BUTTON_TYPE.BUTTON}
                      status={stopping ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.STREAMING}
                      label={stopping ? BUTTON.STOPPING : BUTTON.STOP}
                      disabled={stopping}
                      onClick={stop}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip label={sendLabel}>
                    <PromptInputSubmit
                      label={sendLabel}
                      status={composer.sending ? SUBMIT_STATE.SUBMITTED : SUBMIT_STATE.READY}
                      disabled={held || empty || !sendable || reading > 0}
                    />
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </PromptInputFooter>
      </PromptInput>
      {note !== undefined ? (
        <div className="agent-composer-note">
          <ErrorState
            remedy={
              remedyWords === undefined || remedy === undefined
                ? undefined
                : { label: remedyWords, onClick: remedy }
            }
            onRetry={
              retries && (remedyWords === undefined || retriesBesideRemedy(note))
                ? composer.retry
                : undefined
            }
          >
            {note.text}
          </ErrorState>
          {closed ? closedRemedy : null}
        </div>
      ) : null}
    </div>
  );
}
