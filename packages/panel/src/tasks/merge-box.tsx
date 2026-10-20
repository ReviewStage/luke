import {
  CHECK_SUMMARY,
  type CodingAgentOverviewPullRequest,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  REVIEW_DECISION,
} from "@luke/features/coding-agent-wire";
import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_ACTION,
  type PullRequestAction,
} from "@luke/features/pull-request-write-wire";
import {
  BADGE_TONE,
  Badge,
  type BadgeTone,
  BUTTON_VARIANT,
  Button,
  type ButtonVariant,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  SPINNER_SIZE,
  SpinnerRing,
  SplitButton,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Schema } from "effect";
import {
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  GitMergeIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { readKept, writeKept } from "../desktop/folded-groups.js";
import { Tooltip } from "../tooltip.js";
import type { PullRequestWrites } from "./pull-request-writes.js";

/**
 * merge-box.tsx -- the merge control at the end of an open pull request's title row, as stage-cli's merge status is: a chip saying what holds the merge up, and beside it the one press that may be made now.
 *
 * The chip is a status badge at the pill's size, in the tone of where the
 * merge stands, its glyph and its word: Checking, Conflicts, Behind,
 * Review required, Changes requested, Checks failing, Checks running,
 * Blocked, Ready, Auto-merge on. Its hint, and a reader, have
 * GitHub's fuller sentence ("A required review is missing"). It stands only
 * where it says what the press does not: a pull request ready to merge
 * shows the press alone, a draft nothing, its pill saying Draft, and one in
 * the merge queue only Remove from queue, its pill saying Queued and its
 * place, as stage-cli's does. A narrow header draws the chip's glyph alone,
 * its word still read.
 *
 * The press is the one thing that may be done from where the pull request
 * stands (`mergeActionOf`), each a change the service makes on GitHub as
 * the member pressing it (`pull-request-writes.tsx`):
 *
 * - ready to merge, the method chosen as its words ("Squash and merge"), a
 *   split button whose chevron chooses among the methods the repository
 *   allows, merging at once, as stage-cli's does;
 * - on a base merged through a merge queue, Merge when ready, which turns
 *   auto-merge on with no method, so GitHub adds it to the queue once it is
 *   ready, as `gh pr merge --auto` does;
 * - with checks still running and auto-merge allowed, Enable auto-merge by
 *   the method chosen, its chevron choosing it too;
 * - with auto-merge on, Disable auto-merge;
 * - in the merge queue, Remove from queue, asked first, since leaving the
 *   queue may hold up the pull requests behind it.
 *
 * The method is kept per repository across launches, in this window's own
 * storage as the sidebar's folds are (`folded-groups.ts`); the first the
 * repository allows stands until one is chosen. A merge and auto-merge name
 * the head the overview read, so GitHub refuses either against a head
 * pushed since. While a change is out the press stands busy, and where
 * GitHub refuses it the tab's write note says why, in GitHub's words.
 */

/** What the control offers from where the pull request stands. */
const MERGE_ACTION = {
  MERGE: "merge",
  MERGE_WHEN_READY: "merge-when-ready",
  ENABLE_AUTO_MERGE: "enable-auto-merge",
  DISABLE_AUTO_MERGE: "disable-auto-merge",
  DEQUEUE: "dequeue",
} as const;

type MergeAction = (typeof MERGE_ACTION)[keyof typeof MERGE_ACTION];

/** Each method as the press says it, as GitHub's own merge button does. */
const PRESS_WORDS = {
  [MERGE_METHOD.MERGE]: "Merge pull request",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

/** Each method as the chevron's menu offers it, as GitHub's own does. */
const METHOD_WORDS = {
  [MERGE_METHOD.MERGE]: "Create a merge commit",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

/** Each method's word where it says how auto-merge will merge. */
const METHOD_NOUNS = {
  [MERGE_METHOD.MERGE]: "merge commit",
  [MERGE_METHOD.SQUASH]: "squash",
  [MERGE_METHOD.REBASE]: "rebase",
} as const satisfies Record<MergeMethod, string>;

/** The control's own words. */
const BOX_WORDS = {
  MERGE_WHEN_READY: "Merge when ready",
  ENABLE_AUTO_MERGE: "Enable auto-merge",
  DISABLE_AUTO_MERGE: "Disable auto-merge",
  DEQUEUE: "Remove from queue",
  CHOOSE_METHOD: "Choose how to merge",
  queued: (position: number) => `#${position} in the merge queue`,
  autoMerge: (method: MergeMethod | null) =>
    method === null ? "Auto-merge is on" : `Auto-merge is on (${METHOD_NOUNS[method]})`,
} as const;

/** What the press says while a change it sent is out. */
const BUSY_WORDS = {
  [PULL_REQUEST_ACTION.MERGE]: "Merging",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Turning on auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Turning off auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Removing from queue",
} as const;

/** The changes the control sends, whose answer it waits on busy. */
type MergeWrite = keyof typeof BUSY_WORDS;

function isMergeWrite(action: PullRequestAction | undefined): action is MergeWrite {
  return action !== undefined && action in BUSY_WORDS;
}

/** The states GitHub would merge in now: ready, or with checks nothing requires short of passing. */
const MERGEABLE: ReadonlySet<MergeState> = new Set([MERGE_STATE.CLEAN, MERGE_STATE.UNSTABLE]);

/** The one thing the control offers from where the pull request stands, or nothing. */
function mergeActionOf(merge: MergeState, merging: PullRequestMerging): MergeAction | undefined {
  if (merging.queued !== null) return MERGE_ACTION.DEQUEUE;
  if (merging.autoMerge !== null) return MERGE_ACTION.DISABLE_AUTO_MERGE;
  if (merge === MERGE_STATE.CONFLICTS || merge === MERGE_STATE.DRAFT) return undefined;
  if (merging.queue) return MERGE_ACTION.MERGE_WHEN_READY;
  if (merging.methods.length === 0) return undefined;
  if (MERGEABLE.has(merge)) return MERGE_ACTION.MERGE;
  const waiting = merging.checks === CHECK_SUMMARY.PENDING;
  return merging.autoMergeAllowed && waiting ? MERGE_ACTION.ENABLE_AUTO_MERGE : undefined;
}

/** What a merge GitHub says is blocked waits on, where the reviews or checks say; none where neither does. */
function blockedWords(merging: PullRequestMerging | undefined): string | undefined {
  if (merging === undefined) return undefined;
  if (merging.review === REVIEW_DECISION.CHANGES_REQUESTED) return "Changes were requested";
  if (merging.review === REVIEW_DECISION.REVIEW_REQUIRED) return "A required review is missing";
  if (merging.checks === CHECK_SUMMARY.PENDING) return "Waiting on required checks";
  if (merging.checks === CHECK_SUMMARY.FAILING) return "Required checks are failing";
  return undefined;
}

/** Whether the pull request would merge as it stands, as GitHub's own box under a pull request says it, its base named where it matters. */
function mergeWords(merge: MergeState, base: string): string {
  switch (merge) {
    case MERGE_STATE.CLEAN:
      return "Ready to merge";
    case MERGE_STATE.UNSTABLE:
      return "Can merge, though some checks are not passing";
    case MERGE_STATE.BLOCKED:
      return "Merging is blocked by a required review or check";
    case MERGE_STATE.BEHIND:
      return `Behind ${base}; it must be brought up to date`;
    case MERGE_STATE.CONFLICTS:
      return `Conflicts with ${base}`;
    case MERGE_STATE.DRAFT:
      return "A draft; mark it ready for review to merge";
    case MERGE_STATE.UNKNOWN:
      return "GitHub is still checking whether it merges";
  }
}

/**
 * GitHub's whole sentence for the merge, as the chip's hint and a reader
 * have it: what it waits on, or where the queue or auto-merge has it,
 * then the mergeability beside it where that says something else.
 */
function sentenceOf(pullRequest: CodingAgentOverviewPullRequest): string {
  const { merge, merging } = pullRequest;
  const line = mergeWords(merge, pullRequest.base);
  const standing = (merge === MERGE_STATE.BLOCKED ? blockedWords(merging) : undefined) ?? line;
  const queued = merging?.queued ?? null;
  const autoMerge = merging?.autoMerge ?? null;
  const lead =
    queued !== null
      ? BOX_WORDS.queued(queued.position)
      : autoMerge !== null
        ? BOX_WORDS.autoMerge(autoMerge.method)
        : undefined;
  return lead === undefined ? standing : `${lead}. ${standing}`;
}

/** Where the method chosen is kept, by repository. */
const METHODS_KEY = "luke.pullRequestMergeMethods";

const storedMethods = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals(Object.values(MERGE_METHOD))),
);

/** The method chosen for the repository, kept across launches: the one last chosen where the repository still allows it, else the first it allows. */
function useMergeMethod(
  repository: string | null,
  allowed: readonly MergeMethod[],
): readonly [MergeMethod | undefined, (method: MergeMethod) => void] {
  const [kept, setKept] = useState(() => readKept(METHODS_KEY, storedMethods, {}));
  const chosen = repository === null ? undefined : kept[repository];
  const method = chosen !== undefined && allowed.includes(chosen) ? chosen : allowed[0];
  const choose = (next: MergeMethod) => {
    if (repository === null) return;
    const now = { ...readKept(METHODS_KEY, storedMethods, {}), [repository]: next };
    writeKept(METHODS_KEY, storedMethods, now);
    setKept(now);
  };
  return [method, choose];
}

/** The chip's face: its word, its tone, and its glyph. */
interface ChipFace {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon: ReactNode;
}

/** Each chip's glyph, saying its state again beside its word. */
const CHIP_GLYPHS = {
  CHECKING: <SpinnerRing size={SPINNER_SIZE.SMALL} />,
  HELD: <CircleXIcon aria-hidden="true" />,
  BEHIND: <TriangleAlertIcon aria-hidden="true" />,
  REVIEW: <UserRoundIcon aria-hidden="true" />,
  RUNNING: <CircleDotIcon aria-hidden="true" />,
  WAITING: <ClockIcon aria-hidden="true" />,
  READY: <GitMergeIcon aria-hidden="true" />,
} as const;

function chip(label: string, tone: BadgeTone, icon: ReactNode): ChipFace {
  return { label, tone, icon };
}

/** What a merge GitHub says is blocked is held up by, as the chip says it. */
function blockedChip(merging: PullRequestMerging | undefined): ChipFace {
  if (merging?.review === REVIEW_DECISION.CHANGES_REQUESTED) {
    return chip("Changes requested", BADGE_TONE.DANGER, CHIP_GLYPHS.HELD);
  }
  if (merging?.review === REVIEW_DECISION.REVIEW_REQUIRED) {
    return chip("Review required", BADGE_TONE.ATTENTION, CHIP_GLYPHS.REVIEW);
  }
  if (merging?.checks === CHECK_SUMMARY.FAILING) {
    return chip("Checks failing", BADGE_TONE.DANGER, CHIP_GLYPHS.HELD);
  }
  if (merging?.checks === CHECK_SUMMARY.PENDING) {
    return chip("Checks running", BADGE_TONE.WORKING, CHIP_GLYPHS.RUNNING);
  }
  return chip("Blocked", BADGE_TONE.DANGER, CHIP_GLYPHS.HELD);
}

/**
 * The chip for where the pull request stands and what the press offers, or
 * none where it would only say what the press or the pill already does: a
 * merge ready and offered, a draft, or one in the merge queue.
 */
function chipOf(
  pullRequest: CodingAgentOverviewPullRequest,
  action: MergeAction | undefined,
): ChipFace | undefined {
  const { merge, merging } = pullRequest;
  if ((merging?.queued ?? null) !== null) return undefined;
  if ((merging?.autoMerge ?? null) !== null) {
    return chip("Auto-merge on", BADGE_TONE.WORKING, CHIP_GLYPHS.WAITING);
  }
  if (pullRequest.state === PULL_REQUEST_STATE.DRAFT || merge === MERGE_STATE.DRAFT) {
    return undefined;
  }
  switch (merge) {
    case MERGE_STATE.UNKNOWN:
      return chip("Checking", BADGE_TONE.NEUTRAL, CHIP_GLYPHS.CHECKING);
    case MERGE_STATE.CONFLICTS:
      return chip("Conflicts", BADGE_TONE.DANGER, CHIP_GLYPHS.HELD);
    case MERGE_STATE.BEHIND:
      return chip("Behind", BADGE_TONE.ATTENTION, CHIP_GLYPHS.BEHIND);
    case MERGE_STATE.BLOCKED:
      return blockedChip(merging);
    default:
      return action === MERGE_ACTION.MERGE || action === MERGE_ACTION.MERGE_WHEN_READY
        ? undefined
        : chip("Ready", BADGE_TONE.COMPLETE, CHIP_GLYPHS.READY);
  }
}

/** The chip: its glyph and word in its tone, GitHub's sentence in its hint and for a reader. */
function MergeChip({ face, sentence }: { face: ChipFace; sentence: string }): React.JSX.Element {
  return (
    <Tooltip label={sentence}>
      <span className="merge-chip">
        <Badge tone={face.tone} icon={face.icon}>
          {face.label}
        </Badge>
        <span className="visually-hidden">{`: ${sentence}`}</span>
      </span>
    </Tooltip>
  );
}

/** The chevron's menu of the methods the repository allows, the one chosen checked. */
function methodItems(
  methods: readonly MergeMethod[],
  method: MergeMethod | undefined,
  busy: boolean,
  choose: (method: MergeMethod) => void,
): readonly MenuAction[] {
  return methods.map((each) => ({
    label: METHOD_WORDS[each],
    checked: each === method,
    disabled: busy,
    onSelect: () => choose(each),
  }));
}

/** A press as `Button` takes it busy: the ring and what it is doing, while its own change is out. */
function busyProps(busyLabel: string | undefined) {
  return busyLabel === undefined ? {} : { busy: true, busyLabel };
}

/**
 * A press by the method chosen: a split button whose chevron opens the
 * methods the repository allows, the chosen one checked, where it allows
 * more than one; else the press alone.
 */
function MethodPress({
  variant,
  words,
  methods,
  method,
  busy,
  busyLabel,
  onChoose,
  onPress,
}: {
  variant: ButtonVariant;
  words: string;
  methods: readonly MergeMethod[];
  method: MergeMethod | undefined;
  /** Whether any change to the pull request is out. */
  busy: boolean;
  /** What the press says while its own change is out. */
  busyLabel: string | undefined;
  onChoose: (method: MergeMethod) => void;
  onPress: () => void;
}): React.JSX.Element {
  const menu = useMenu(methods.length > 1);
  const icon = variant === BUTTON_VARIANT.PRIMARY ? <GitMergeIcon aria-hidden="true" /> : undefined;
  if (methods.length < 2) {
    return (
      <Button
        variant={variant}
        icon={icon}
        disabled={busy && busyLabel === undefined}
        onClick={onPress}
        {...busyProps(busyLabel)}
      >
        {words}
      </Button>
    );
  }
  return (
    <>
      <SplitButton
        variant={variant}
        icon={icon}
        disabled={busy && busyLabel === undefined}
        busy={busyLabel}
        onClick={onPress}
        menu={{ label: BOX_WORDS.CHOOSE_METHOD, ...menu.trigger() }}
      >
        {words}
      </SplitButton>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={BOX_WORDS.CHOOSE_METHOD}
          menu={menu.drawn}
          groups={[methodItems(methods, method, busy, onChoose)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The question Remove from queue asks first, as stage-cli's does. */
const DEQUEUE_QUESTION: DialogQuestion = {
  title: "Remove from the merge queue?",
  body: "Removing this pull request from the queue could impact other pull requests in the queue.",
  verb: BOX_WORDS.DEQUEUE,
  running: BUSY_WORDS[PULL_REQUEST_ACTION.DEQUEUE],
  tone: DIALOG_TONE.DANGER,
};

/**
 * The merge control for an open pull request or a draft, as its overview
 * read it: the chip, the press, and the question leaving the queue asks
 * first. Nothing for one merged or closed, or where neither a
 * chip nor a press has anything to say.
 */
export function MergeControl({
  pullRequest,
  repository,
  shown,
  writes,
}: {
  pullRequest: CodingAgentOverviewPullRequest;
  /** The agent's repository, which the method chosen is kept by. */
  repository: string | null;
  /** Whether the panel the control stands in is on screen; a question asked goes with it. */
  shown: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element | null {
  const { merging } = pullRequest;
  const methods = merging?.methods ?? [];
  const [method, choose] = useMergeMethod(repository, methods);
  // Whether Remove from queue is being asked about.
  const [asked, setAsked] = useState(false);
  const confirm = useConfirmDialog({ subject: asked, surfaceOpen: shown }, async () => {
    await writes.write({ action: PULL_REQUEST_ACTION.DEQUEUE });
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  });
  // Note that a question left behind as its panel hides is let go whole, so the panel comes back asking nothing; one already answered finishes.
  if (!shown && asked && !confirm.busy) setAsked(false);

  const live =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  if (!live) return null;
  const action =
    merging === undefined || pullRequest.state !== PULL_REQUEST_STATE.OPEN
      ? undefined
      : mergeActionOf(pullRequest.merge, merging);
  const face = chipOf(pullRequest, action);
  const pending = isMergeWrite(writes.pending) ? writes.pending : undefined;
  const busy = writes.pending !== undefined;
  const headSha = merging?.headSha ?? "";
  const askDequeue = () => {
    setAsked(true);
    confirm.ask();
  };
  const busyAs = (write: MergeWrite) => (pending === write ? BUSY_WORDS[write] : undefined);
  const plain = (variant: ButtonVariant, words: string, write: MergeWrite, onPress: () => void) => (
    <Button
      variant={variant}
      disabled={busy && busyAs(write) === undefined}
      onClick={onPress}
      {...busyProps(busyAs(write))}
    >
      {words}
    </Button>
  );
  const press = (): React.JSX.Element | null => {
    switch (action) {
      case MERGE_ACTION.MERGE:
        if (method === undefined) return null;
        return (
          <MethodPress
            variant={BUTTON_VARIANT.PRIMARY}
            words={PRESS_WORDS[method]}
            methods={methods}
            method={method}
            busy={busy}
            busyLabel={busyAs(PULL_REQUEST_ACTION.MERGE)}
            onChoose={choose}
            onPress={() =>
              void writes.write({ action: PULL_REQUEST_ACTION.MERGE, method, headSha })
            }
          />
        );
      case MERGE_ACTION.ENABLE_AUTO_MERGE:
        if (method === undefined) return null;
        return (
          <MethodPress
            variant={BUTTON_VARIANT.OUTLINE}
            words={BOX_WORDS.ENABLE_AUTO_MERGE}
            methods={methods}
            method={method}
            busy={busy}
            busyLabel={busyAs(PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE)}
            onChoose={choose}
            onPress={() =>
              void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha })
            }
          />
        );
      case MERGE_ACTION.MERGE_WHEN_READY:
        return plain(
          BUTTON_VARIANT.PRIMARY,
          BOX_WORDS.MERGE_WHEN_READY,
          PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE,
          () => void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha }),
        );
      case MERGE_ACTION.DISABLE_AUTO_MERGE:
        return plain(
          BUTTON_VARIANT.OUTLINE,
          BOX_WORDS.DISABLE_AUTO_MERGE,
          PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE,
          () => void writes.write({ action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE }),
        );
      case MERGE_ACTION.DEQUEUE:
        return plain(BUTTON_VARIANT.OUTLINE, BOX_WORDS.DEQUEUE, PULL_REQUEST_ACTION.DEQUEUE, () =>
          askDequeue(),
        );
      default:
        return null;
    }
  };
  const drawn = press();
  if (face === undefined && drawn === null && !asked) return null;
  return (
    <span className="merge-control">
      {face === undefined ? null : <MergeChip face={face} sentence={sentenceOf(pullRequest)} />}
      {drawn}
      {asked ? <ConfirmDialog confirm={confirm} question={DEQUEUE_QUESTION} /> : null}
    </span>
  );
}
