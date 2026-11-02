import type { MemorySummary } from "@luke/features/memory-wire";
import { PRODUCT_NAME } from "@luke/features/product-name";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  countWords,
  readFailedWords,
  readingWords,
  SIGNED_OUT_WORDS,
  TERM,
} from "@luke/features/words";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CardPress,
  CHIP_LOOK,
  Chip,
  ChipName,
  CONFIRM_LOSS,
  Comment,
  CommentSkeleton,
  type CommentSkeletonLine,
  ConfirmDialog,
  CornerDot,
  EmptyState,
  ErrorState,
  GAP,
  IconButton,
  Inline,
  LIST_MOTION_WAY,
  ListMotion,
  MoreButton,
  SELECT_BOX_PLACE,
  SETTINGS_SECTION_FRAME,
  SearchField,
  SearchIcon,
  type SelectionAct,
  SelectionBar,
  SelectionRegion,
  SettingsLine,
  SettingsSection,
  SkeletonRegion,
  Stack,
  selectionMenu,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useLeaving,
  useMenu,
  VisuallyHidden,
} from "@luke/ui";
import { ACTOR_KIND, type Actor, actorName, personActor } from "@luke/ui/actor-model";
import { GLYPH, ListFilterIcon } from "@luke/ui/icons";
import { markdownTree } from "@luke/ui/markdown-words";
import { matchesTokens, searchTokens } from "@luke/ui/search-tokens";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, ActorRef, commentAuthor } from "../actor-ref.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { confirmFailure, failureShown, unreadShown } from "../failure-report.js";
import { MarkdownMessage } from "../markdown-message.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { PEOPLE_FILTER_WORDS } from "../member-rows.js";

/**
 * memory-page.tsx -- Settings › Memory: the facts and conventions the workspace's coding agents kept, found by search and by whose they are, and forgotten one at a time or several at once.
 *
 * A coding agent keeps a memory as it works without asking, and corrects one
 * in place when its developer says otherwise. They are the workspace's: every
 * member's agents in it recall them, and nothing crosses into another
 * workspace.
 *
 * At the top, a search over the words and their keeper's name
 * (`searchTokens`), lit where it landed, and the Tasks page's Filter, its
 * glyph alone with a dot while it keeps anything, whose one field is Kept by,
 * each keeper with their face and how many they kept, and everyone who left
 * the workspace as one; a chip under the search says each one kept, its ×
 * lifting it, beside a Clear.
 *
 * Each memory reads as a note: its keeper's face and name, the name the
 * panel's person chip hanging their card, when it was last kept, and its
 * words whole at any width, drawn as the notes are, since a memory is
 * Markdown (`pnpm db:generate` in backticks). It opens nothing, so a plain
 * press on it only marks where a run of ⇧-clicks starts. Its ⋯ and a
 * right-click offer Copy words and Forget, which stands unavailable, saying
 * who may, on a memory the reader may not forget: its words are theirs, or
 * they own or administer the workspace.
 *
 * Memories are chosen together as the Tasks page's rows are (#5761): the box
 * in a row's gutter under the pointer, X, ⌘- and ⇧-clicks, ⌘A, and Esc. A
 * bar floating at the page's foot then forgets or copies them all, and a
 * chosen row's ⋯ and right-click offer the bar's acts under how many it acts
 * on. Forget, of one or of several, asks once first, in red, as the Inbox's
 * Resolve does, since no memory comes back once forgotten; several are
 * forgotten one after another, since every answer is the workspace's
 * memories whole and two in flight could land out of order, and the memories
 * the reader may not forget are left chosen and said so. The whole page is
 * kept out of the screen recording, since a memory is members' own words
 * about their work.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: readFailedWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES_FAILED: readFailedWords("your workspaces"),
  SIGNED_OUT: SIGNED_OUT_WORDS,
  EMPTY: `${PRODUCT_NAME} hasn't remembered anything yet.`,
  FORGET_FAILED: "The memory could not be forgotten. Try again.",
  NO_MATCH: "No memories match",
  CLEAR: "Clear search and filter",
} as const;

/** What the Filter is called, on its tooltip and its menu, and its one field. */
const FILTER = "Filter";
const KEPT_BY = "Kept by";

/** What the selection's acts and a row's menu say. */
const MEMORY_ACT = {
  FORGET: "Forget",
  COPY: "Copy words",
} as const;

/** The key the Kept by filter keeps everyone who left the workspace under, together. */
const FORMER_KEY = "former";

/** What everyone who left is called in the filter. */
const FORMER_WORDS = "Former members";

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** What the skeletons say to a reader who cannot see them. */
const READING_LABEL = {
  MEMORY: readingWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES: readingWords("your workspaces"),
} as const;

/** The memories that stand while they are read: each a name over a line or two of words. */
const MEMORIES_SKELETON: readonly {
  readonly key: string;
  readonly name: string;
  readonly lines: readonly CommentSkeletonLine[];
}[] = [
  { key: "first", name: "18%", lines: [{ key: "line", width: "82%" }] },
  {
    key: "second",
    name: "24%",
    lines: [
      { key: "line", width: "94%" },
      { key: "end", width: "40%" },
    ],
  },
  { key: "third", name: "20%", lines: [{ key: "line", width: "66%" }] },
];

/**
 * A memory's row: a list row's box, filled under the pointer, keeping a
 * gutter at its start for its box (`SELECT_BOX_PLACE.GUTTER`) as the Tasks
 * list's rows do. Its note stands over the row's press with the pointer let
 * through, and what in it is a control of its own, the keeper's chip, a
 * link, and the ⋯, lifted over the press so a press on one is its own.
 */
const MEMORY_ROW =
  "memory-row relative list-none rounded-control px-row-inset ps-select-gutter py-luke-8 [&:hover]:bg-muted";
const MEMORY_NOTE = "memory-note pointer-events-none";
const LIFTED = "pointer-events-auto relative z-1";
const MEMORY_WORDS = "memory-words [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-1";

/** The search's line: the field taking the room the Filter beside it leaves. */
const SEARCH_LINE =
  "memory-search flex items-center gap-control-gap [&>:first-child]:min-w-0 [&>:first-child]:flex-1";

/** The memories' list, a column of rows. */
const MEMORY_LIST = "memory-list m-0 flex flex-col gap-luke-2 p-0";

/** Where the selection bar floats: at the foot of the page, over the rows, as the Tasks list's does. */
const SELECTION_FOOT =
  "memory-selection pointer-events-none sticky bottom-luke-16 z-4 flex justify-center *:pointer-events-auto";

/** A Markdown node, as far as its words go: the words it holds itself, and what it holds. */
interface WordsNode {
  readonly value?: unknown;
  readonly children?: readonly object[];
}

/** The words a node holds, its marks left out: what a row's press is named by, so a reader hears no backticks. */
function wordsIn(node: WordsNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map((child) => wordsIn(child)).join("");
}

/** Whom the Kept by filter files a memory under: its keeper, or everyone who left as one. */
function keeperKey(memory: MemorySummary, actor: Actor): string {
  if (memory.keptBy === null || actor.kind !== ACTOR_KIND.PERSON) return FORMER_KEY;
  return memory.keptBy.userId;
}

/** Who may forget a memory, as its unavailable Forget says it. */
function forgetterOf(memory: MemorySummary, actor: Actor): string {
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) return "You: its words are yours";
  if (memory.forgettable) return "You, as an owner or admin of the workspace";
  const keeper = actor.kind === ACTOR_KIND.PERSON ? actor.name : undefined;
  return keeper === undefined
    ? "Only an owner or an admin"
    : `Only ${keeper}, or an owner or admin`;
}

/** One memory with whose words it holds, as the members the panel reads name them. */
interface ShownMemory {
  readonly memory: MemorySummary;
  readonly actor: Actor;
  readonly keeper: string;
}

/** The memories while they are read: the notes' own shapes, under a label a reader hears. */
function MemoriesSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <Stack gap={GAP.BLOCK}>
        {MEMORIES_SKELETON.map((each) => (
          <CommentSkeleton key={each.key} name={each.name} lines={each.lines} />
        ))}
      </Stack>
    </SkeletonRegion>
  );
}

/** What a row chosen among several acts on: how many, and the bar's acts. */
interface ChosenMemories {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

/** A plain press on a memory, which has nothing to open: it only marks where a run of ⇧-clicks starts. */
function anchorOnly(): void {}

/** One memory's row: its note, and its ⋯ and right-click. */
function MemoryRow({
  shown,
  found,
  locked,
  chosen,
  onForget,
  onCopy,
}: {
  shown: ShownMemory;
  /** The words the search asks for, lit where they landed. */
  found: readonly string[];
  /** Whether a forget is out, which every Forget waits out. */
  locked: boolean;
  /** The selection the row stands in among several, whose acts its menu offers; none otherwise. */
  chosen: ChosenMemories | undefined;
  onForget: () => void;
  onCopy: () => void;
}): React.JSX.Element {
  const { memory, actor } = shown;
  const menu = useMenu(true);
  const own: readonly (readonly MenuEntry[])[] = [
    [{ label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onSelect: onCopy }],
    [
      {
        label: MEMORY_ACT.FORGET,
        icon: <TrashIcon />,
        danger: true,
        disabled: !memory.forgettable || locked,
        detail: memory.forgettable ? undefined : forgetterOf(memory, actor),
        onSelect: onForget,
      },
    ],
  ];
  return (
    <li className={MEMORY_ROW}>
      <CardPress
        selectKey={memory.id}
        selectBox={SELECT_BOX_PLACE.GUTTER}
        onPress={anchorOnly}
        contextMenu={menu.contextMenu()}
      >
        <VisuallyHidden>{wordsIn(markdownTree(memory.text))}</VisuallyHidden>
      </CardPress>
      <div className={MEMORY_NOTE}>
        <Comment
          author={commentAuthor(actor)}
          nameRef={
            <span className={LIFTED}>
              <ActorRef actor={actor} nameOnly />
            </span>
          }
          at={memory.updatedAt}
          trailing={
            <span className={LIFTED}>
              <MoreButton thing="Memory" {...menu.trigger()} />
            </span>
          }
        >
          <div className={MEMORY_WORDS}>
            <MarkdownMessage words={memory.text} className="memory-text" found={found} />
          </div>
        </Comment>
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={chosen === undefined ? "Memory actions" : countWords(chosen.count, TERM.MEMORY)}
          heading={chosen === undefined ? undefined : countWords(chosen.count, TERM.MEMORY)}
          menu={menu.drawn}
          groups={chosen === undefined ? own : selectionMenu(chosen.acts)}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/** One keeper the Kept by filter offers: whom it files under, their name and face, and how many they kept. */
interface Keeper {
  readonly key: string;
  readonly label: string;
  readonly face: ReactNode;
  readonly count: number;
}

/** The keepers of `listed`, the reader first as Me, then each by name, everyone who left last. */
function keepersOf(listed: readonly ShownMemory[]): readonly Keeper[] {
  const byKey = new Map<string, Keeper>();
  for (const { memory, actor } of listed) {
    const key = keeperKey(memory, actor);
    const known = byKey.get(key);
    if (known !== undefined) {
      byKey.set(key, { ...known, count: known.count + 1 });
      continue;
    }
    const former = key === FORMER_KEY;
    const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
    const label = former ? FORMER_WORDS : you ? PEOPLE_FILTER_WORDS.ME : actorName(actor);
    const face = former ? <GLYPH.PEOPLE /> : <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />;
    byKey.set(key, { key, label, face, count: 1 });
  }
  const rank = (keeper: Keeper) =>
    keeper.label === PEOPLE_FILTER_WORDS.ME ? 0 : keeper.key === FORMER_KEY ? 2 : 1;
  return [...byKey.values()].sort(
    (one, other) => rank(one) - rank(other) || one.label.localeCompare(other.label),
  );
}

/** Puts `key` in the set or takes it out. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** The Tasks page's Filter: its glyph alone, named by its tooltip, a dot at its corner while it keeps anything, and Kept by its one field. */
function KeptByFilter({
  keepers,
  kept,
  onKept,
}: {
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const people: MenuAction[] = keepers.map((keeper) => ({
    label: keeper.label,
    icon: <>{keeper.face}</>,
    detail: `${String(keeper.count)} kept`,
    checked: kept.has(keeper.key),
    stays: true,
    onSelect: () => onKept(toggled(kept, keeper.key)),
  }));
  return (
    <>
      <CornerDot shown={kept.size > 0}>
        <Tooltip label={FILTER}>
          <IconButton icon={<ListFilterIcon />} label={FILTER} {...menu.trigger()} />
        </Tooltip>
      </CornerDot>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={FILTER}
          menu={menu.drawn}
          groups={[[{ label: KEPT_BY, icon: <GLYPH.PERSON />, items: people }]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The keeper a chip stands for, by which its chip leaves. */
const keeperChipKey = (keeper: Keeper): string => keeper.key;

/** The filter's chips and Clear, a chip lifted scaling out where it stood. */
function KeptByLine({
  line,
  keepers,
  kept,
  onKept,
}: {
  line: React.RefObject<HTMLElement | null>;
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element | null {
  // Note that the keepers are read again on every render, so the list the chips leave by is kept until another keeper is kept.
  const listed = keepers.filter((keeper) => kept.has(keeper.key));
  const [stable, setStable] = useState(listed);
  const same =
    stable.length === listed.length &&
    stable.every(
      (keeper, at) => keeper.key === listed[at]?.key && keeper.label === listed[at]?.label,
    );
  if (!same) setStable(listed);
  const drawn = useLeaving(same ? stable : listed, keeperChipKey);
  if (drawn.length === 0) return null;
  return (
    <Inline gap={GAP.TIGHT} ref={line} moves>
      {drawn.map(({ key, value: keeper, leaving }) => (
        <Chip
          key={key}
          look={CHIP_LOOK.FILTER}
          motionKey={key}
          removeLabel={`Show memories kept by anyone, not only ${keeper.label}`}
          onRemove={() => {
            if (!leaving) onKept(toggled(kept, keeper.key));
          }}
        >
          {keeper.face}
          <ChipName>{`${KEPT_BY} ${keeper.label === PEOPLE_FILTER_WORDS.ME ? "me" : keeper.label}`}</ChipName>
        </Chip>
      ))}
      {kept.size === 0 ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => onKept(new Set())}>
          Clear
        </Button>
      )}
    </Inline>
  );
}

/** What the filter keeps, a chip for each keeper, its × lifting them, and Clear, under a motion that scales a chip in and out (`ListMotion`). */
function KeptByChips(props: {
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const line = useRef<HTMLElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <KeptByLine line={line} {...props} />
    </ListMotion>
  );
}

/** What Forget asks, of one memory or of several, and what it says of those the reader may not forget. */
function forgetQuestion(asked: readonly MemorySummary[], left: number) {
  const one = asked.length === 1;
  const them = one ? "it" : "them";
  const body = `No agent will recall ${them} in any later task in this workspace, for anyone.`;
  const kept =
    left === 0
      ? ""
      : ` ${countWords(left, TERM.MEMORY)} you may not forget ${left === 1 ? "stays" : "stay"}.`;
  return {
    title: one ? "Forget this memory?" : `Forget ${countWords(asked.length, TERM.MEMORY)}?`,
    body: `${body}${kept}`,
    verb: MEMORY_ACT.FORGET,
    running: "Forgetting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/** What the list says where it holds nothing: a search or the filter that leaves nothing, or a workspace that has kept nothing yet. */
function NothingShown({
  narrowed,
  onClear,
}: {
  narrowed: boolean;
  onClear: () => void;
}): React.JSX.Element {
  if (narrowed) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={PAGE_LINE.NO_MATCH}
        action={{ label: PAGE_LINE.CLEAR, onClick: onClear }}
      />
    );
  }
  return <SettingsLine>{PAGE_LINE.EMPTY}</SettingsLine>;
}

/** The memories as read: the search and the filter, the list, and the bar over what is chosen. */
function MemoryList({
  readerId,
  memories,
  forgetting,
  onForget,
}: {
  /** The signed-in account, whose own memories read as You and Me. */
  readerId: string | undefined;
  memories: readonly MemorySummary[];
  /** Whether a forget is out, which every Forget waits out. */
  forgetting: boolean;
  onForget: (ids: readonly string[]) => Promise<ActionResult>;
}): React.JSX.Element {
  const { members, former } = useMemberDirectory();
  const copy = useCopyToast();
  const regionId = useId();
  const [query, setQuery] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [asked, setAsked] = useState<readonly MemorySummary[]>([]);
  const found = searchTokens(query);
  const all = memories.map((memory): ShownMemory => {
    const actor = personActor(memory.keptBy ?? undefined, members, readerId, former);
    const keeper = memory.keptBy?.name ?? "";
    return { memory, actor, keeper };
  });
  const searched = all.filter((each) => matchesTokens([each.memory.text, each.keeper], found));
  const listed = searched.filter(
    (each) => kept.size === 0 || kept.has(keeperKey(each.memory, each.actor)),
  );
  // Note that a memory no longer drawn leaves the selection for good, as a task does, so one a search hid is not chosen again unasked.
  const drawn = new Set(listed.map((each) => each.memory.id));
  const standing: ReadonlySet<string> = new Set([...selected].filter((id) => drawn.has(id)));
  if (standing.size !== selected.size) setSelected(standing);
  const chosen = listed.filter((each) => standing.has(each.memory.id)).map((each) => each.memory);
  const forgettable = asked.filter((memory) => memory.forgettable);
  const forgetConfirm = useConfirmDialog(
    { subject: asked.length > 0, surfaceOpen: true },
    () => onForget(forgettable.map((memory) => memory.id)),
    confirmFailure(FAILURE_SURFACE.MEMORY_FORGET),
  );
  const askForget = (memories: readonly MemorySummary[]) => {
    setAsked(memories);
    forgetConfirm.ask();
  };
  const copyAll = (memories: readonly MemorySummary[]) =>
    copy(
      memories.map((memory) => memory.text).join("\n\n"),
      memories.length === 1
        ? "Memory copied"
        : `${countWords(memories.length, TERM.MEMORY)} copied`,
    );
  const acts: readonly SelectionAct[] = [
    ...(chosen.some((memory) => memory.forgettable) && !forgetting
      ? [{ label: MEMORY_ACT.FORGET, icon: <TrashIcon />, onAct: () => askForget(chosen) }]
      : []),
    { label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onAct: () => copyAll(chosen) },
  ];
  const several: ChosenMemories | undefined =
    chosen.length > 1 ? { count: chosen.length, acts } : undefined;
  const clear = () => {
    setQuery("");
    setKept(new Set());
  };
  const keepers = keepersOf(searched);
  return (
    <SettingsSection anchor={SETTINGS_SEARCH_ROW.MEMORY} frame={SETTINGS_SECTION_FRAME.NONE}>
      <Stack gap={GAP.SECTION}>
        <Stack gap={GAP.CONTROL}>
          <div className={SEARCH_LINE}>
            <SearchField
              label="Search memories"
              placeholder="Search memories"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery("")}
              onEscape={() => setQuery("")}
              {...(found.length === 0 ? {} : { tally: { count: listed.length } })}
            />
            <KeptByFilter keepers={keepers} kept={kept} onKept={setKept} />
          </div>
          <KeptByChips keepers={keepersOf(all)} kept={kept} onKept={setKept} />
        </Stack>
        {listed.length === 0 ? (
          <NothingShown narrowed={found.length > 0 || kept.size > 0} onClear={clear} />
        ) : (
          <SelectionRegion id={regionId} selection={{ selected: standing, onChange: setSelected }}>
            <ul className={MEMORY_LIST}>
              {listed.map((shown) => (
                <MemoryRow
                  key={shown.memory.id}
                  shown={shown}
                  found={found}
                  locked={forgetting}
                  chosen={
                    several !== undefined && standing.has(shown.memory.id) ? several : undefined
                  }
                  onForget={() => askForget([shown.memory])}
                  onCopy={() => copyAll([shown.memory])}
                />
              ))}
            </ul>
          </SelectionRegion>
        )}
      </Stack>
      <div className={SELECTION_FOOT}>
        <SelectionBar
          count={chosen.length}
          acts={acts}
          onClear={() => setSelected(new Set())}
          controls={regionId}
        />
      </div>
      <ConfirmDialog
        open
        confirm={forgetConfirm}
        question={forgetQuestion(asked, asked.length - forgettable.length)}
      />
    </SettingsSection>
  );
}

export function MemorySection({
  signedIn,
  workspace,
  readerId,
  workspacesFailed,
  onRetryWorkspaces,
}: {
  signedIn: boolean;
  /** The workspace Settings shows, whose memories the page reads; absent before the workspaces are read. */
  workspace: Workspace | undefined;
  /** The signed-in account, whose own memories read as You. */
  readerId: string | undefined;
  /** Whether the read the workspaces arrive with failed, so no workspace will arrive until it is asked again. */
  workspacesFailed: boolean;
  /** Asks for the workspaces again. */
  onRetryWorkspaces: (() => void) | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const [memories, setMemories] = useState<readonly MemorySummary[] | undefined>(undefined);
  /** What the last read failed with, its answer or its error, which its failure is reported as; absent while none failed. */
  const [readFailure, setReadFailure] = useState<{ readonly cause: unknown } | undefined>(
    undefined,
  );
  const [attempt, setAttempt] = useState(0);
  const [forgetting, setForgetting] = useState<string | undefined>(undefined);
  // Note that every change of workspace or reader starts a new scope, because a forget still out
  // from the one before answers that scope's list, which must never be drawn under this one.
  const scope = useRef(0);
  /** The workspace the page shows now, which a forget answered after the page moved on checks against. */
  const shown = useRef<string | undefined>(undefined);
  // Note that every read and forget is numbered as it is sent, and a list is drawn only when it
  // answers a later request than the list drawn last, so an older answer arriving late never
  // puts back a memory a newer one already forgot.
  const sent = useRef(0);
  const drawn = useRef(0);
  // Note that a read out while a forget landed may have read the list before that forget's delete,
  // so its answer is not drawn; the page reads again instead.
  const forgotten = useRef(0);

  /** Draws the list one request answered, unless a later request's list is drawn already; answers whether it drew. */
  const draw = useCallback((request: number, list: readonly MemorySummary[]): boolean => {
    if (request < drawn.current) return false;
    drawn.current = request;
    setMemories(list);
    return true;
  }, []);

  const workspaceId = workspace?.id;
  useEffect(() => {
    scope.current += 1;
    shown.current = workspaceId;
    setForgetting(undefined);
  }, [signedIn, workspaceId, readerId]);

  // The page opening reads the memories as the service holds them now, which a call may just have added to.
  useEffect(() => {
    if (!signedIn || workspaceId === undefined) return;
    let live = true;
    sent.current += 1;
    const request = sent.current;
    const forgottenBefore = forgotten.current;
    // Nothing of an earlier read, an earlier account, or another workspace stands while this one is out.
    setMemories(undefined);
    setReadFailure(undefined);
    act(ACT_KIND.MEMORIES_READ, { workspaceId }).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailure({ cause: answer });
        else if (forgotten.current !== forgottenBefore) setAttempt((count) => count + 1);
        else draw(request, answer.memories);
      },
      (error: unknown) => {
        if (live) setReadFailure({ cause: error });
      },
    );
    return () => {
      live = false;
    };
  }, [act, draw, signedIn, workspaceId, readerId, attempt]);

  const forget = useCallback(
    (id: string): Promise<ActionResult> => {
      if (workspaceId === undefined) {
        return Promise.resolve({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PAGE_LINE.FORGET_FAILED,
        });
      }
      const asked = scope.current;
      sent.current += 1;
      const request = sent.current;
      setForgetting(id);
      return act(ACT_KIND.MEMORIES_FORGET, { workspaceId, id })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (asked === scope.current) setForgetting(undefined);
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.FORGET_FAILED };
          }
          forgotten.current += 1;
          // A forget answered while the page shows another workspace draws nothing there.
          if (shown.current !== workspaceId) return { status: ACTION_RESULT_STATUS.ACCEPTED };
          // Its own scope's list, unless a later one is drawn; otherwise a read again, since the list
          // on the page may predate the forget, and the newest read's answer is the one that stands.
          const drew = asked === scope.current && draw(request, answer.memories);
          if (!drew) setAttempt((count) => count + 1);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        });
    },
    [act, draw, workspaceId],
  );

  // Note that several are forgotten one after another, each sent once the one before answered, and the first refusal stops the rest.
  const forgetAll = useCallback(
    (ids: readonly string[]): Promise<ActionResult> =>
      ids.reduce<Promise<ActionResult>>(
        (before, id) =>
          before.then((result) =>
            result.status === ACTION_RESULT_STATUS.ACCEPTED ? forget(id) : result,
          ),
        Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      ),
    [forget],
  );

  if (!signedIn) return <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>;
  // Note that no workspace is a read not answered yet or one that failed, never a workspace-less account, which holds its own.
  if (workspace === undefined) {
    return workspacesFailed ? (
      <SettingsLine>
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.WORKSPACES_READ)}
          onRetry={onRetryWorkspaces}
        >
          {PAGE_LINE.WORKSPACES_FAILED}
        </ErrorState>
      </SettingsLine>
    ) : (
      <MemoriesSkeleton label={READING_LABEL.WORKSPACES} />
    );
  }
  return (
    <div className={NO_CAPTURE}>
      {memories !== undefined ? (
        // Note that the keepers are read in the workspace Settings shows, which may not be the one the window's tasks stand in.
        <MemberDirectory workspace={workspace} readerId={readerId}>
          <MemoryList
            readerId={readerId}
            memories={memories}
            forgetting={forgetting !== undefined}
            onForget={forgetAll}
          />
        </MemberDirectory>
      ) : readFailure !== undefined ? (
        <SettingsLine>
          <ErrorState
            failure={failureShown({
              surface: FAILURE_SURFACE.MEMORIES_READ,
              cause: readFailure.cause,
              about: { workspaceId: workspace.id },
            })}
            onRetry={() => setAttempt((count) => count + 1)}
          >
            {PAGE_LINE.FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <MemoriesSkeleton label={READING_LABEL.MEMORY} />
      )}
    </div>
  );
}
