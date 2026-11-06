import type { MemorySummary } from "@repo/features/memory-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  countWords,
  readFailedWords,
  readingWords,
  SIGNED_OUT_WORDS,
  TERM,
} from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
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
  usePageScroll,
  VisuallyHidden,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { GLYPH, ListFilterIcon } from "@repo/ui/icons";
import { markdownTree } from "@repo/ui/markdown-words";
import { matchesTokens, searchTokens } from "@repo/ui/search-tokens";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from "react";
import { sendAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, ActorRef, commentAuthor } from "../actor-ref.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { memoriesQuery, memoriesRetryMutation } from "../live-reads.js";
import { MarkdownMessage } from "../markdown-message.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { PEOPLE_FILTER_WORDS } from "../member-rows.js";

const PAGE_LINE = {
  FAILED: readFailedWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES_FAILED: readFailedWords("your workspaces"),
  SIGNED_OUT: SIGNED_OUT_WORDS,
  EMPTY: `${PRODUCT_NAME} hasn't remembered anything yet.`,
  FORGET_FAILED: "The memory could not be deleted. Try again.",
  NO_MATCH: "No memories match",
  CLEAR: "Clear search and filter",
} as const;

const FILTER = "Filter";
const KEPT_BY = "Kept by";

const MEMORY_ACT = {
  FORGET: "Delete",
  COPY: "Copy words",
} as const;

const FORMER_KEY = "former";

const FORMER_WORDS = "Former members";

const NO_CAPTURE = "ph-no-capture";

const READING_LABEL = {
  MEMORY: readingWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES: readingWords("your workspaces"),
} as const;

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

const MEMORY_ROW =
  "memory-row relative list-none rounded-control px-row-inset ps-select-gutter py-ui-8 hover:bg-muted";
const MEMORY_NOTE = "memory-note pointer-events-none";
const LIFTED = "pointer-events-auto relative z-1";
const MEMORY_WORDS = "memory-words [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-1";

const SEARCH_LINE =
  "memory-search flex items-center gap-control-gap [&>:first-child]:min-w-0 [&>:first-child]:flex-1";

const MEMORY_LIST = "memory-list";

const MEMORY_ESTIMATE_PX = 72;

const MEMORY_GAP_PX = 2;

const SELECTION_FOOT =
  "memory-selection pointer-events-none sticky bottom-ui-16 z-4 flex justify-center *:pointer-events-auto";

interface WordsNode {
  readonly value?: unknown;
  readonly children?: readonly object[];
}

function wordsIn(node: WordsNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map((child) => wordsIn(child)).join("");
}

function keeperKey(memory: MemorySummary, actor: Actor): string {
  if (memory.keptBy === null || actor.kind !== ACTOR_KIND.PERSON) return FORMER_KEY;
  return memory.keptBy.userId;
}

function forgetterOf(memory: MemorySummary, actor: Actor): string {
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) return "You: its words are yours";
  if (memory.forgettable) return "You, as an owner or admin of the workspace";
  const keeper = actor.kind === ACTOR_KIND.PERSON ? actor.name : undefined;
  return keeper === undefined
    ? "Only an owner or an admin"
    : `Only ${keeper}, or an owner or admin`;
}

interface ShownMemory {
  readonly memory: MemorySummary;
  readonly actor: Actor;
  readonly keeper: string;
}

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

interface ChosenMemories {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

function anchorOnly(): void {}

function MemoryRow({
  shown,
  place,
  found,
  locked,
  chosen,
  onForget,
  onCopy,
}: {
  shown: ShownMemory;
  place: VirtualRowPlace;
  found: readonly string[];
  locked: boolean;
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
        replayMasked: !memory.forgettable,
        onSelect: onForget,
      },
    ],
  ];
  return (
    <li {...place} className={MEMORY_ROW}>
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
          heading={
            chosen === undefined ? undefined : (
              <ReplayUnmask>{countWords(chosen.count, TERM.MEMORY)}</ReplayUnmask>
            )
          }
          menu={menu.drawn}
          groups={chosen === undefined ? own : selectionMenu(chosen.acts)}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </li>
  );
}

interface Keeper {
  readonly key: string;
  readonly label: string;
  readonly face: ReactNode;
  readonly count: number;
  readonly named: boolean;
}

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
    byKey.set(key, { key, label, face, count: 1, named: !former && !you });
  }
  const rank = (keeper: Keeper) =>
    keeper.label === PEOPLE_FILTER_WORDS.ME ? 0 : keeper.key === FORMER_KEY ? 2 : 1;
  return [...byKey.values()].sort(
    (one, other) => rank(one) - rank(other) || one.label.localeCompare(other.label),
  );
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

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
    replayMasked: keeper.named,
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
          heading={KEPT_BY}
          groups={[people]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

const keeperChipKey = (keeper: Keeper): string => keeper.key;

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

function forgetQuestion(asked: readonly MemorySummary[], left: number) {
  const one = asked.length === 1;
  const them = one ? "it" : "them";
  const body = `No agent will recall ${them} in any later task in this workspace, for anyone.`;
  const kept =
    left === 0
      ? ""
      : ` ${countWords(left, TERM.MEMORY)} you may not delete ${left === 1 ? "stays" : "stay"}.`;
  return {
    title: one ? "Delete this memory?" : `Delete ${countWords(asked.length, TERM.MEMORY)}?`,
    body: `${body}${kept}`,
    verb: `${MEMORY_ACT.FORGET} ${one ? TERM.MEMORY.one : TERM.MEMORY.many}`,
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

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
        replayUnmasked
      />
    );
  }
  return <SettingsLine>{PAGE_LINE.EMPTY}</SettingsLine>;
}

function memoriesForgetMutation(workspaceId: string) {
  return mutationOptions({
    mutationKey: [ACT_KIND.MEMORIES_FORGET, workspaceId],
    mutationFn: (ids: readonly string[]): Promise<ActionResult> =>
      ids.reduce<Promise<ActionResult>>(
        (before, id) =>
          before.then((result) =>
            result.status !== ACTION_RESULT_STATUS.ACCEPTED
              ? result
              : sendAct(ACT_KIND.MEMORIES_FORGET, { workspaceId, id })
                  .catch(() => undefined)
                  .then(
                    (answer): ActionResult =>
                      answer === undefined || "failure" in answer
                        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.FORGET_FAILED }
                        : { status: ACTION_RESULT_STATUS.ACCEPTED },
                  ),
          ),
        Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      ),
  });
}

function MemoryList({
  readerId,
  memories,
  workspaceId,
}: {
  readerId: string | undefined;
  memories: readonly MemorySummary[];
  workspaceId: string;
}): React.JSX.Element {
  const forgets = memoriesForgetMutation(workspaceId);
  const forgettingAll = useMutation(forgets);
  const forgetting = useIsMutating({ mutationKey: forgets.mutationKey }) > 0;
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
  const drawn = new Set(listed.map((each) => each.memory.id));
  const standing: ReadonlySet<string> = new Set([...selected].filter((id) => drawn.has(id)));
  if (standing.size !== selected.size) setSelected(standing);
  const chosen = listed.filter((each) => standing.has(each.memory.id)).map((each) => each.memory);
  const forgettable = asked.filter((memory) => memory.forgettable);
  const forgetConfirmAct = useConfirmAct(forgettingAll, {
    send: () => forgettingAll.mutateAsync(forgettable.map((memory) => memory.id)),
    answered: sameAnswer,
  });
  const forgetConfirm = useConfirmDialog(
    { subject: asked.length > 0, surfaceOpen: true },
    forgetConfirmAct,
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
  const { scroller, shiftedBy } = usePageScroll();
  const run = useRef<VirtualRowsHandle>(null);
  const keys = useMemo(() => listed.map((each) => each.memory.id), [listed]);
  const order = useMemo(() => [keys], [keys]);
  const bringIn = useCallback(
    (key: string, then: () => void) => run.current?.bringIn(key, then) ?? false,
    [],
  );
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
          <SelectionRegion
            id={regionId}
            selection={{ selected: standing, onChange: setSelected }}
            order={order}
            bringIn={bringIn}
          >
            <VirtualRows
              scroller={scroller}
              shiftedBy={shiftedBy}
              keys={keys}
              estimate={MEMORY_ESTIMATE_PX}
              gap={MEMORY_GAP_PX}
              anchor={VIRTUAL_ROWS_ANCHOR.START}
              listItems
              holdsFocus
              className={MEMORY_LIST}
              handle={run}
            >
              {(index, place) => {
                const shown = listed[index];
                return shown === undefined ? null : (
                  <MemoryRow
                    shown={shown}
                    place={place}
                    found={found}
                    locked={forgetting}
                    chosen={
                      several !== undefined && standing.has(shown.memory.id) ? several : undefined
                    }
                    onForget={() => askForget([shown.memory])}
                    onCopy={() => copyAll([shown.memory])}
                  />
                );
              }}
            </VirtualRows>
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
  workspace: Workspace | undefined;
  readerId: string | undefined;
  workspacesFailed: boolean;
  onRetryWorkspaces: (() => void) | undefined;
}): React.JSX.Element {
  const workspaceId = workspace?.id;
  const memories = useQuery(memoriesQuery(signedIn ? workspaceId : undefined));
  const retryMemories = useMutation(memoriesRetryMutation());
  if (!signedIn) return <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>;
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
      {memories.data !== undefined ? (
        <MemberDirectory workspace={workspace} readerId={readerId}>
          <MemoryList readerId={readerId} memories={memories.data} workspaceId={workspace.id} />
        </MemberDirectory>
      ) : memories.isError ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.MEMORIES_READ, { workspaceId: workspace.id })}
            onRetry={() => retryMemories.mutate({ workspaceId: workspace.id })}
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
