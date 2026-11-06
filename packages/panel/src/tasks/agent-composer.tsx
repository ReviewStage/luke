import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  AGENT_BOUNDS,
  AGENT_STATUS,
  type AgentBrief,
  type AgentContext,
  type AgentPayer,
  type AgentPullRequestAnswer,
  type AgentStatus,
  type AgentUsage,
  hasWordsOrFiles,
} from "@repo/features/agent-wire";
import {
  FAILURE_REASON,
  type Failure,
  remedyLabel,
  retriesBesideRemedy,
} from "@repo/features/failure-remedy";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { pasteCutWords } from "@repo/features/words";
import type { ShortcutChord } from "@repo/settings/shortcuts";
import {
  ComposerBody,
  ComposerFoot,
  MicrophoneIcon,
  MoreButton,
  moreLabel,
  PlusIcon,
  riseAboveEnd,
  useMenu,
} from "@repo/ui";
import { SERVER_HANDED } from "@repo/ui/agent-servers-model";
import { GLYPH } from "@repo/ui/icons";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { type ReportedFailure, UNREPORTED, type Unreported } from "@repo/ui/reported-failure";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { PromptInput, submitPromptInput } from "../ai-elements/prompt-input.js";
import { useSideBundles } from "../bundle-loader.js";
import { useConnected } from "../connection.js";
import { ActionMenu, type MenuEntry } from "../desktop/action-menu.js";
import { modEnterSends } from "../enter-sends.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "../description-editor/contract.js";
import { useAttachedFiles } from "../use-attached-files.js";
import { AgentContextRing, ContextRingIcon } from "./agent-context.js";
import { contextHint } from "./agent-context-model.js";
import { noteWhileOffline } from "./agent-model.js";
import { AgentModelChip } from "./agent-model-chip.js";
import { BranchChip, type PublishedDoors } from "./agent-published.js";
import { type AgentServersControl, serversMenuPanel } from "./agent-servers.js";
import { AttachFilesButton, type AttachPicker, attachmentRow } from "./attach-files-button.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ComposerField } from "./composer-field.js";
import { useComposerPickers } from "./composer-pickers.js";
import { DictateButton, DictationStrip } from "./dictation-strip.js";
import { MENTION_MENU_SIDE, type MentionMenuSide } from "./mention-picker.js";
import { ComposerQuoteView } from "./reply-to-selection.js";
import { useRepositoryRemedy } from "./repository-remedy.js";
import type { SkillSource } from "./skill-picker.js";
import { useMentionBox } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { AgentModelControl } from "./use-agent-model.js";
import { useModifierHeld } from "./use-modifier-held.js";

const EDITOR_LOAD_FAILED = "The message box could not be loaded.";

export const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow up",
} as const;

export interface ComposerWords {
  readonly placeholder: string;
  readonly label: string;
  readonly send: string;
  readonly chord?: ShortcutChord | undefined;
}

export const BUTTON = {
  SEND: "Send",
  STOP: "Stop",
  STOPPING: "Stopping",
  SENDING: "Sending",
  ATTACH: "Attach files",
  ADD: "Add files and more",
  MORE_THING: "Composer",
  QUEUE: "Queue",
  STEER: "Steer",
  SAVE: "Save",
} as const;

const FOLD_WIDTH = {
  PUBLISHED: 520,
  ACTIONS: 400,
  MODEL: 300,
} as const;

type FoldWidth = (typeof FOLD_WIDTH)[keyof typeof FOLD_WIDTH];

const FOLD_LINES = Object.values(FOLD_WIDTH).toSorted((a, b) => a - b);

const OVERFLOW_PRESS = {
  ATTACH: "agent-composer-attach",
  CONTEXT: "agent-context-button",
  DICTATE: "dictate-button",
} as const;

type OverflowPress = (typeof OVERFLOW_PRESS)[keyof typeof OVERFLOW_PRESS];

interface OverflowOffer {
  press: OverflowPress;
  entries: readonly MenuEntry[];
}

function hiddenPresses(card: HTMLElement | null): readonly OverflowPress[] {
  if (card === null) return [];
  return Object.values(OVERFLOW_PRESS).filter((press) => {
    const element = card.querySelector(`.${press}`);
    return element !== null && getComputedStyle(element).display === "none";
  });
}

function useFootFold(card: RefObject<HTMLDivElement | null>): FoldWidth | undefined {
  const [under, setUnder] = useState<FoldWidth | undefined>(undefined);
  useEffect(() => {
    const form = card.current?.querySelector("form");
    if (form === null || form === undefined) return undefined;
    const measure = () => {
      const style = getComputedStyle(form);
      const inner =
        form.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      setUnder(inner > 0 ? FOLD_LINES.find((line) => inner < line) : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    return () => observer.disconnect();
  }, [card]);
  return under;
}

export const COMPOSER_ROOM_CLASS =
  "agent-composer relative flex flex-col gap-control-gap px-ui-16 pt-0 pb-list-inset";

export const COMPOSER_DOCK_CLASS = "px-ui-16 pt-0 pb-row-inset";

export const LOG_OVER_COMPOSER_CLASS = "agent-log-over-composer";

export function ComposerCard({
  children,
  ...props
}: Omit<ComponentProps<"div">, "className">): React.JSX.Element {
  return (
    <div className={COMPOSER_ROOM_CLASS} {...props}>
      {children}
    </div>
  );
}

export function ComposerAttach({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="agent-composer-attach flex">{children}</span>;
}

export function ComposerActions({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="agent-composer-actions relative flex min-w-0 flex-initial items-center gap-tight-gap">
      {children}
    </div>
  );
}

function ComposerMore({
  card,
  offers,
}: {
  card: RefObject<HTMLDivElement | null>;
  offers: readonly OverflowOffer[];
}): React.JSX.Element {
  const menu = useMenu(true);
  const [taken, setTaken] = useState<readonly OverflowPress[]>([]);
  const trigger = menu.trigger(riseAboveEnd);
  const standing = menu.open !== undefined;
  const { close } = menu;
  useEffect(() => {
    const box = card.current;
    if (!standing || box === null) return undefined;
    const width = box.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      if (box.getBoundingClientRect().width !== width) close(false);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [standing, close, card]);
  const actions = offers
    .filter((offer) => taken.includes(offer.press))
    .flatMap((each) => each.entries);
  return (
    <>
      <span className="agent-composer-more hidden">
        <MoreButton
          thing={BUTTON.MORE_THING}
          {...trigger}
          onClick={(event) => {
            setTaken(hiddenPresses(card.current));
            trigger.onClick(event);
          }}
        />
      </span>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={moreLabel(BUTTON.MORE_THING)}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

export interface ComposerQueueing {
  readonly working: boolean;
  readonly enterQueues: boolean;
  readonly onQueue: () => void;
  readonly editing: boolean;
  readonly onSave: () => void;
  readonly onSteer: () => void;
  readonly onCancel: () => void;
}

export function AgentComposer({
  agentId,
  status,
  stoppable = status === AGENT_STATUS.RUNNING,
  composer,
  model,
  models,
  modelsFailed,
  readModels,
  usage,
  payer,
  servers,
  plus = [],
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
  maxLength = AGENT_BOUNDS.MAX_MESSAGE_CHARS,
  tools,
  actions,
  beforeSend,
  sendable = true,
  onKey,
  onLeave,
  focusedByOwner = false,
  takesFocus = true,
  listSide = MENTION_MENU_SIDE.ABOVE,
  queueing,
}: {
  agentId?: string | undefined;
  status: AgentStatus;
  stoppable?: boolean;
  composer: AgentComposerControl;
  model: AgentModelControl | undefined;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  readModels: () => void;
  usage: AgentUsage | undefined;
  payer?: AgentPayer | undefined;
  servers: AgentServersControl | undefined;
  plus?: readonly MenuEntry[] | undefined;
  context?: AgentContext | undefined;
  brief?: AgentBrief | undefined;
  published: AgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  onStop: () => Promise<boolean>;
  followsUp: boolean;
  keywords?: readonly string[] | undefined;
  skills?: SkillSource | undefined;
  replyDoor?: RefObject<((words: string) => void) | undefined> | undefined;
  sendsEmpty?: boolean;
  closedRemedy?: ReactNode;
  wording?: ComposerWords | undefined;
  maxLength?: number;
  tools?: ((narrow: boolean) => ReactNode) | undefined;
  actions?: ((narrow: boolean) => ReactNode) | undefined;
  beforeSend?: ((narrow: boolean) => ReactNode) | undefined;
  sendable?: boolean;
  onKey?: ((event: KeyboardEvent) => boolean) | undefined;
  onLeave?: (() => void) | undefined;
  focusedByOwner?: boolean;
  takesFocus?: boolean;
  listSide?: MentionMenuSide;
  queueing?: ComposerQueueing | undefined;
}): React.JSX.Element {
  const connected = useConnected();
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const picker = useRef<AttachPicker>(null);
  const footFold = useFootFold(card);
  const folds = (below: FoldWidth) => footFold !== undefined && footFold <= below;
  const [contextOpen, setContextOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  if (stopping && !stoppable) setStopping(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [filesRefused, setFilesRefused] = useState(false);
  const [cut, setCut] = useState(false);
  const latest = useRef(composer);
  latest.current = composer;
  const closed = composer.closed !== undefined;
  const held = composer.sending || closed;
  const files = useAttachedFiles({
    holder: { attachments: composer.attachments, update: composer.setAttachments },
    held,
    onRefusal: (words) => {
      setRefusal(words);
      setFilesRefused(words !== undefined);
    },
  });
  const editingQueued = queueing?.editing === true;
  const sendHeld = held || !sendable || files.reading;
  const empty =
    !sendsEmpty && !editingQueued && !hasWordsOrFiles(composer.draft.trim(), composer.attachments);
  const showsStop = empty && stoppable && !composer.sending && !editingQueued;
  const queues = queueing?.working && !empty && !held && !files.reading && !editingQueued;
  const modifierHeld = useModifierHeld(queues || editingQueued);
  const queuesNow = queues && queueing.enterQueues !== modifierHeld;
  const { descriptionEditor } = useSideBundles();
  const bundle = useAtomValue(descriptionEditor);
  const retryBundle = useAtomRefresh(descriptionEditor);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  const [mountedFirst] = useState(module !== undefined);
  const statuses = useIntegrationStatuses();
  const unloaded = AsyncResult.isFailure(bundle) ? EDITOR_LOAD_FAILED : undefined;
  const sendNote = noteWhileOffline(composer.note, connected);
  const words =
    composer.closed ??
    refusal ??
    (cut && sendNote === undefined ? pasteCutWords(maxLength) : undefined) ??
    unloaded ??
    (sendNote === undefined ? model?.note : undefined);
  const note: Failure | undefined =
    words !== undefined ? { reason: FAILURE_REASON.OTHER, text: words } : sendNote;
  const retries = note !== undefined && note === sendNote;
  const reloads = unloaded !== undefined && words === unloaded;
  const noteFailure: ReportedFailure | Unreported | undefined =
    note === undefined
      ? undefined
      : (cut && words === pasteCutWords(maxLength)) ||
          (filesRefused && words !== undefined && words === refusal)
        ? UNREPORTED.INPUT
        : reloads
          ? unreadShown(FAILURE_SURFACE.BUNDLE_LOAD)
          : note === sendNote
            ? failureShown({
                surface: FAILURE_SURFACE.AGENT_SEND,
                cause: sendNote?.cause ?? note,
                about: { agentId },
              })
            : failureShown({
                surface: FAILURE_SURFACE.AGENT_COMPOSER,
                cause: note.reason,
                about: { agentId },
                refused: true,
              });
  const repositoryRemedy = useRepositoryRemedy();
  const remedy =
    note === undefined
      ? undefined
      : repositoryRemedy(note, () => {
          if (latest.current.note === note) latest.current.retry();
        });
  const remedyWords = note === undefined ? undefined : remedyLabel(note);
  const placeholder = closed
    ? ""
    : (wording?.placeholder ?? (followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST));
  const sendLabel = wording?.send ?? BUTTON.SEND;

  const refocus = useRef(false);
  const [sends, setSends] = useState(0);
  useEffect(() => {
    if (sends === 0 || held || !refocus.current) return;
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
  }, [held, sends]);

  useEffect(() => {
    if (replyDoor === undefined) return undefined;
    replyDoor.current = (words) => {
      editor.current?.insertQuote(words);
    };
    return () => {
      replyDoor.current = undefined;
    };
  }, [replyDoor]);

  const pickers = useComposerPickers({
    editor,
    room,
    draft: composer.draft,
    placeholder,
    self: agentId,
    skills,
    keywords,
    servers: {
      statuses,
      place: {
        disabled: servers?.disabled ?? [],
        handed: stoppable ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    onNote: (words) => {
      setRefusal(words);
      setFilesRefused(false);
    },
    onLeave: editingQueued ? queueing?.onCancel : onLeave,
    side: listSide,
  });
  const { dictation, dictating } = pickers;
  useMentionBox((mention) => editor.current?.insertMention(mention));

  const stop = () => {
    setStopping(true);
    onStop().then(
      (took) => setStopping(took),
      () => setStopping(false),
    );
  };

  const sentBy = (go: () => void) => {
    setRefusal(undefined);
    setCut(false);
    refocus.current = card.current?.contains(document.activeElement) === true;
    go();
    setSends((count) => count + 1);
  };
  const steer = () => sentBy(composer.send);
  const submit = () => {
    if (editingQueued) return sentBy(queueing.onSave);
    if (queuesNow) return sentBy(queueing.onQueue);
    steer();
  };
  const sendOtherWay = (pressQueues: boolean) => {
    if (editingQueued) return sentBy(queueing.onSteer);
    if (pressQueues) return steer();
    if (queueing !== undefined) sentBy(queueing.onQueue);
  };
  const queueKey = (event: KeyboardEvent): boolean => {
    if (queueing === undefined) return false;
    if (!modEnterSends(event)) return false;
    if (editingQueued) {
      if (!sendHeld) sendOtherWay(false);
      return true;
    }
    if (!queues || !sendable) return false;
    sendOtherWay(queueing.enterQueues);
    return true;
  };
  const sendWay =
    editingQueued && !modifierHeld
      ? { label: BUTTON.SAVE, icon: <GLYPH.DONE /> }
      : queuesNow
        ? { label: BUTTON.QUEUE, icon: <GLYPH.QUEUED /> }
        : (queues || editingQueued) && modifierHeld
          ? { label: BUTTON.STEER, icon: <GLYPH.STEER /> }
          : undefined;

  const handBack = (set: (open: boolean) => void) => (open: boolean) => {
    const more = card.current?.querySelector<HTMLElement>(".agent-composer-more") ?? null;
    const press = more?.querySelector<HTMLElement>("button") ?? null;
    const returning =
      !open && (document.activeElement?.closest(".ui-anchored-popover") ?? null) !== null;
    set(open);
    if (returning && more !== null && press !== null && getComputedStyle(more).display !== "none") {
      queueMicrotask(() => press.focus());
    }
  };

  const plusRows: readonly MenuEntry[] = [
    ...(servers === undefined ? [] : [serversMenuPanel(servers, statuses)]),
    ...plus,
  ];
  const openPicker = () => picker.current?.open();
  const offers: OverflowOffer[] = [
    {
      press: OVERFLOW_PRESS.ATTACH,
      entries:
        plusRows.length === 0
          ? [{ label: BUTTON.ATTACH, icon: <PlusIcon />, disabled: held, onSelect: openPicker }]
          : [attachmentRow(openPicker, held), ...plusRows],
    },
    ...(context === undefined
      ? []
      : [
          {
            press: OVERFLOW_PRESS.CONTEXT,
            entries: [
              {
                label: contextHint(context),
                icon: <ContextRingIcon context={context} />,
                onSelect: () => setContextOpen(true),
              },
            ],
          },
        ]),
    {
      press: OVERFLOW_PRESS.DICTATE,
      entries: [
        {
          label: dictation.keyMissing ? OPENAI_KEY_MISSING_NOTE : "Dictate",
          icon: <MicrophoneIcon />,
          disabled: held || module === undefined,
          onSelect: dictation.start,
        },
      ],
    },
  ];

  return (
    <ComposerCard
      ref={card}
      data-status={status}
      data-closed={closed ? "" : undefined}
      {...files.drop.target}
    >
      <PromptInput
        className={closed ? "opacity-60" : undefined}
        dropping={files.drop.dropping}
        onSubmit={submit}
      >
        <ComposerBody
          files={
            <AttachedFileChips
              files={attachmentChips(composer.attachments)}
              onRemove={held ? undefined : files.remove}
            />
          }
        >
          <ComposerField
            module={module}
            editor={editor}
            room={room}
            draft={composer.draft}
            setDraft={(text) => {
              setCut(false);
              composer.setDraft(text);
            }}
            onPasteCut={() => setCut(true)}
            placeholder={placeholder}
            label={wording?.label ?? "Message to the agent"}
            input={
              held
                ? COMPOSER_INPUT.DISABLED
                : dictating
                  ? COMPOSER_INPUT.READ_ONLY
                  : COMPOSER_INPUT.EDITABLE
            }
            maxLength={maxLength}
            takesFocus={takesFocus && !(focusedByOwner && mountedFirst)}
            {...pickers.field}
            onKey={(event) =>
              pickers.field.onKey(event) ||
              queueKey(event) ||
              (!files.reading && onKey?.(event) === true)
            }
            onEnter={() => {
              if (room.current !== null) submitPromptInput(room.current);
            }}
            onPasteFiles={files.paste}
            quote={(quote) => <ComposerQuoteView quote={quote} held={held} />}
          />
        </ComposerBody>
        <ComposerFoot
          tools={
            <>
              <ComposerAttach>
                <AttachFilesButton
                  label={plusRows.length === 0 ? BUTTON.ATTACH : BUTTON.ADD}
                  disabled={held}
                  picker={picker}
                  onFiles={files.attach}
                  more={plusRows}
                />
              </ComposerAttach>
              <BranchChip
                published={published}
                doors={doors}
                narrow={folds(FOLD_WIDTH.PUBLISHED)}
              />
              {tools?.(folds(FOLD_WIDTH.PUBLISHED))}
            </>
          }
          counter={{ length: composer.draft.length, limit: maxLength }}
          actions={
            <ComposerActions>
              {actions?.(folds(FOLD_WIDTH.ACTIONS))}
              {model === undefined ? null : (
                <AgentModelChip
                  model={model}
                  models={models}
                  modelsFailed={modelsFailed}
                  readModels={readModels}
                  usage={usage}
                  payer={payer}
                  narrow={folds(FOLD_WIDTH.MODEL)}
                />
              )}
              <AgentContextRing
                context={context}
                brief={brief}
                open={contextOpen}
                onOpenChange={handBack(setContextOpen)}
              />
              <DictateButton dictation={dictation} disabled={held || module === undefined} />
              <ComposerMore card={card} offers={offers} />
              {beforeSend?.(folds(FOLD_WIDTH.ACTIONS))}
            </ComposerActions>
          }
          strip={dictating ? <DictationStrip dictation={dictation} /> : undefined}
          send={{
            label: sendWay?.label ?? sendLabel,
            ...(sendWay === undefined ? undefined : { icon: sendWay.icon }),
            chord: wording?.chord,
            onHold: queues || editingQueued ? () => sendOtherWay(queuesNow === true) : undefined,
            empty,
            held: sendHeld,
            busy: composer.sending,
            busyLabel: BUTTON.SENDING,
          }}
          stop={
            showsStop
              ? { label: BUTTON.STOP, onStop: stop, busy: stopping, busyLabel: BUTTON.STOPPING }
              : undefined
          }
          note={
            note === undefined || noteFailure === undefined
              ? undefined
              : {
                  words: note.text,
                  failure: noteFailure,
                  remedy:
                    remedyWords === undefined || remedy === undefined
                      ? undefined
                      : { label: remedyWords, onClick: remedy },
                  onRetry: reloads
                    ? retryBundle
                    : retries && (remedyWords === undefined || retriesBesideRemedy(note))
                      ? composer.retry
                      : undefined,
                  mends: closed ? closedRemedy : undefined,
                }
          }
        />
      </PromptInput>
    </ComposerCard>
  );
}
