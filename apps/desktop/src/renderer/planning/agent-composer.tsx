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
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { INTEGRATION_STATUS } from "@luke/features/integration-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { EllipsisIcon, McpIcon, MicrophoneIcon, PlusIcon } from "@luke/ui";
import { lapsedServer, namedServers, SERVER_HANDED } from "@luke/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FileDiffIcon } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "../ai-elements/prompt-input";
import { ActionMenu, type MenuAction, riseAboveEnd, useActionMenu } from "../desktop/action-menu";
import { editorBundleAtom } from "../editor-bundle";
import { FailureNote } from "../failure-note";
import { imageFiles } from "../feedback-images";
import { GRANT_OUTCOME, useIntegrationGrant } from "../integration-grant";
import { useIntegrationStatuses } from "../integration-statuses";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "../plan-editor/contract";
import { Tooltip } from "../tooltip";
import { AgentContextRing } from "./agent-context";
import { contextHint } from "./agent-context-model";
import { AgentModelChip } from "./agent-model-chip";
import { ChangesChip, PublishedChip, type PublishedDoors } from "./agent-published";
import { AgentServersButton, type AgentServersControl } from "./agent-servers";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips";
import { readFiles, withFiles } from "./attached-files";
import { ComposerField } from "./composer-field";
import { DictateButton, DictationStrip } from "./dictation-strip";
import { MentionNodeChip, pastedMentionNode } from "./mention-chip";
import { MENTION_MENU_SIDE, useMentionPicker } from "./mention-picker";
import { useMentionBox, usePlanMentions } from "./plan-mentions";
import { useRepositoryRemedy } from "./repository-remedy";
import { MentionedServers } from "./server-card";
import { useSkillOpener } from "./skill-chip";
import { type SkillSource, useSkillPicker } from "./skill-picker";
import type { AgentComposerControl } from "./use-agent-composer";
import type { AgentModelControl } from "./use-agent-model";
import { DICTATION_PHASE, useDictation } from "./use-dictation";
import { useKnownNames } from "./use-known-names";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, two chips at its foot, one button, and a note under it when a message or a change did not go or a server's sign-in expired.
 *
 * The box is the shared composer card (../ai-elements/prompt-input.tsx),
 * at its default type. Its foot is laid
 * out as ChatGPT's and Codex's are: at the left the "+" that attaches
 * files and, once the agent has pushed, the pull request's or the branch's
 * chip, which opens it on GitHub (`agent-published.tsx`); at the right,
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
 * and what mends it (`../failure-note.tsx`): Retry, which sends it again
 * under the same key, so a send whose answer was lost reaches the agent
 * once, or, for a repository out of reach, the press its reason names
 * (`repository-remedy.tsx`), a move of the plan sending it again by itself
 * once it lands; an agent that takes no message any more keeps the box,
 * disabled, with the reason under it; a change of model that did not take
 * says why in the same place, and with nothing else to say there, a server
 * the agent has on whose sign-in expired is offered to reconnect, in place, as
 * the MCP popover reconnects it; an editor bundle that could not be loaded
 * says so there too. The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the plan. A draft agent's tab
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
 * Words can be spoken into the box as well: the microphone left of the
 * round button records in place of the foot's controls until ✓ or Enter sends the clip
 * to be heard and the words land at the caret, or ✕ or Escape drops it
 * (`use-dictation.ts`, `dictation-strip.tsx`). Why a dictation left nothing
 * is said in the same note a file's refusal is.
 *
 * An `@` at the start of a word, on a plan's page, opens the list of what
 * the message can mention, the plan's repository's files and folders, the
 * plan's sections, the pages agents showed on it, its other coding agents,
 * the repository's skills, and the account's connected MCP servers and
 * their tools
 * (`mention-picker.tsx`), and the one chosen is written into the words as
 * its link, drawn as its chip (`mention-chip.tsx`). A server mentioned is
 * handed to the agent's next turn even where its switch is off, and to that
 * turn alone.
 *
 * A `/` at the start of a word opens the list of the skills the plan's
 * repository keeps, at the caret, and the one chosen is written into the
 * words as its chip, read as `/name`, which the agent loads before it acts
 * and a press opens the `SKILL.md` of (`skill-picker.tsx`).
 *
 * The foot answers the card's own width, not the window's, so the box
 * holds in the main column and the side panel alike, the way Cursor's and
 * ChatGPT's narrow panes do (planning.css's `composer` container). As the
 * card narrows, the chips naming what the agent published draw their marks
 * alone; then a ⋯ takes in, in this order, the Changes chip, the MCP
 * servers, the context ring, and the microphone; then the model chip draws
 * its harness's mark alone; and last the + goes into the ⋯ too. The field
 * and the round Send or Stop always stand whole. The ⋯ offers what the
 * stylesheet hid as it opens, read off the foot itself, so the stylesheet
 * is the one place the order is kept; a popover it opens hangs at the
 * foot's right, where its own hidden press stood.
 */

/** What the box's note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The message box could not be loaded.";

/** What the box says it takes: the first message of an empty conversation, then a follow up. */
const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow up",
} as const;

/** The buttons' names, which are their tooltips too. */
const BUTTON = {
  SEND: "Send",
  STOP: "Stop",
  STOPPING: "Stopping…",
  ATTACH: "Attach files",
  MORE: "More",
} as const;

/** The presses a narrow card's ⋯ takes in, by the class each wears on the foot. */
const OVERFLOW_PRESS = {
  ATTACH: "agent-composer-attach",
  CHANGES: "agent-changes-chip",
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
  const menu = useActionMenu(true);
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
      <Tooltip label={BUTTON.MORE}>
        <button
          type="button"
          className="icon-button agent-composer-more"
          aria-label={BUTTON.MORE}
          {...trigger}
          onClick={(event) => {
            setTaken(hiddenPresses(foot.current));
            trigger.onClick(event);
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
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
  /** The MCP servers the agent is handed and their switches. */
  servers: AgentServersControl;
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
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const foot = useRef<HTMLDivElement>(null);
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
  const empty = !hasWordsOrFiles(composer.draft.trim(), composer.attachments);
  const showsStop = empty && stoppable && !composer.sending;
  const bundle = useAtomValue(editorBundleAtom);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
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
  const lapsed = lapsedServer({
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
  const placeholder = followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST;

  const dictation = useDictation({ editor, keywords, onNote: setRefusal });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;
  const openSkill = useSkillOpener();
  const skillPicker = useSkillPicker({
    editor,
    room,
    draft: composer.draft,
    source: skills,
    onOpen: openSkill,
  });

  // An `@` picks a mention of the plan the box stands on, where it stands on a plan's page.
  const planMentions = usePlanMentions();
  // A Luke address pasted whole is called by the name the window holds for what it names.
  const known = useKnownNames();
  // A file's lines picked in a File tab on the page (⌥⌘K) are laid in here, where the caret stands.
  useMentionBox((mention) => editor.current?.insertMention(mention));
  const mentionPicker = useMentionPicker({
    source: planMentions,
    self: agentId,
    // The repository's skills, a pick written as the `/name` chip the `/` list writes.
    skills:
      skills === undefined
        ? undefined
        : {
            known: skillPicker.known,
            ask: skillPicker.ask,
            onChoose: (name) => editor.current?.chooseSkillAtMention(name),
          },
    // The servers the account connected, each one a mention hands the agent's next turn.
    servers: namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }),
    room,
    side: MENTION_MENU_SIDE.ABOVE,
    onChoose: (mention) => editor.current?.chooseMention(mention),
  });

  const onFieldKey = (event: KeyboardEvent): boolean => {
    if (dictation.onFieldKey(event) || skillPicker.onKey(event) || mentionPicker.onKey(event)) {
      return true;
    }
    if (event.key !== "Escape") return false;
    event.stopPropagation();
    editor.current?.blur();
    return true;
  };

  const stop = () => {
    setStopping(true);
    onStop().finally(() => setStopping(false));
  };

  // Note that a popover closed by key while the ⋯ stands hands focus to the
  // ⋯, after its own close has handed it to its hidden press, because a
  // hidden press can hold no keyboard; with the press drawn, the ⋯ is not.
  const handBack = (set: (open: boolean) => void) => (open: boolean) => {
    const more = foot.current?.querySelector<HTMLElement>(".agent-composer-more") ?? null;
    const returning =
      !open && (document.activeElement?.closest(".anchored-popover") ?? null) !== null;
    set(open);
    if (returning && more !== null && getComputedStyle(more).display !== "none") {
      queueMicrotask(() => more.focus());
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
    ...(published !== undefined && published.pullRequest !== null && doors.openChanges !== undefined
      ? [
          {
            press: OVERFLOW_PRESS.CHANGES,
            action: {
              label: "Show changes",
              icon: <FileDiffIcon aria-hidden="true" />,
              onSelect: doors.openChanges,
            },
          },
        ]
      : []),
    {
      press: OVERFLOW_PRESS.SERVERS,
      action: { label: "MCP servers", icon: <McpIcon />, onSelect: () => setServersOpen(true) },
    },
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
      className="agent-composer"
      data-status={status}
      data-dropping={dropping ? "" : undefined}
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
          composer.send();
        }}
      >
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
          label="Message to the agent"
          className="ph-no-capture agent-composer-input"
          input={
            held
              ? COMPOSER_INPUT.DISABLED
              : dictating
                ? COMPOSER_INPUT.READ_ONLY
                : COMPOSER_INPUT.EDITABLE
          }
          maxLength={CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS}
          skills={skillPicker.names}
          aria={{ ...skillPicker.aria, "aria-placeholder": placeholder }}
          onKey={onFieldKey}
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
          onTrigger={skillPicker.onTrigger}
          chip={skillPicker.chip}
          mentions={
            planMentions === undefined
              ? undefined
              : {
                  onTrigger: mentionPicker.onTrigger,
                  // A server's chip in the box says what a send now does with it: opens a turn, or steers the one running.
                  chip: (mention) => (
                    <MentionedServers
                      value={{
                        disabled: servers.disabled,
                        handed: stoppable ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
                      }}
                    >
                      <MentionNodeChip mention={mention} doors={planMentions.doors} />
                    </MentionedServers>
                  ),
                  pasted: (words) =>
                    pastedMentionNode(words, planMentions.doors.place, {
                      known,
                      planId: planMentions.planId,
                      text: planMentions.text,
                    }),
                }
          }
        >
          {skillPicker.menu}
          {mentionPicker.menu}
        </ComposerField>
        <PromptInputFooter ref={foot}>
          {dictating ? (
            <DictationStrip dictation={dictation} />
          ) : (
            <>
              <PromptInputTools>
                <Tooltip label={BUTTON.ATTACH}>
                  <button
                    type="button"
                    className="icon-button agent-composer-attach"
                    aria-label={BUTTON.ATTACH}
                    disabled={held}
                    onClick={() => picker.current?.click()}
                  >
                    <PlusIcon />
                  </button>
                </Tooltip>
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
                <PublishedChip published={published} doors={doors} />
                <ChangesChip published={published} doors={doors} />
              </PromptInputTools>
              <div className="agent-composer-actions">
                {model === undefined ? null : (
                  <AgentModelChip
                    model={model}
                    models={models}
                    readModels={readModels}
                    usage={usage}
                  />
                )}
                <AgentServersButton
                  servers={servers}
                  statuses={statuses}
                  open={serversOpen}
                  onOpenChange={handBack(setServersOpen)}
                />
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
                      type="button"
                      status={
                        stopping ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.STREAMING
                      }
                      aria-label={stopping ? BUTTON.STOPPING : BUTTON.STOP}
                      disabled={stopping}
                      onClick={stop}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip label={BUTTON.SEND}>
                    <PromptInputSubmit
                      aria-label={BUTTON.SEND}
                      status={
                        composer.sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY
                      }
                      disabled={held || empty || reading > 0}
                    />
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </PromptInputFooter>
      </PromptInput>
      {note !== undefined ? (
        <FailureNote
          failure={note}
          className="error-message agent-composer-note"
          onRetry={retries ? composer.retry : undefined}
          onRemedy={remedy}
        />
      ) : null}
    </div>
  );
}
