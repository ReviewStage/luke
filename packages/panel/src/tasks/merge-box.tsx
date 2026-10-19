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
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  type ButtonVariant,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  ConfirmDialog,
  DIALOG_TONE,
  POPOVER_ALIGN,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Schema } from "effect";
import { ChevronDownIcon, GitMergeIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { readKept, writeKept } from "../desktop/folded-groups.js";
import { PopoverPanel } from "../popover-panel.js";
import type { PullRequestWrites } from "./pull-request-writes.js";

/**
 * merge-box.tsx -- the merge control at the end of an open pull request's title row: one button saying what can happen now, coloured by where the merge stands, and the panel it opens, holding GitHub's sentence and the presses stage-cli's merge status offers.
 *
 * The button names the one thing that may be done from where the pull
 * request stands (`mergeActionOf`), or what holds the merge up where nothing
 * may: Merge, Auto-merge, Merge when ready, Queued #N, Auto-merge on,
 * Conflicts, Review required, Checks failing, Changes requested, Draft. A
 * narrow header draws its glyph and a shorter word (`short`), its name
 * still the whole. It opens a panel under it whose title is GitHub's own
 * sentence for the merge, whose body says the mergeability beside it where
 * that differs, and whose foot holds the press, each a change the service
 * makes on GitHub as the member pressing it (`pull-request-writes.tsx`):
 *
 * - in the merge queue, Remove from queue;
 * - with auto-merge on, Disable auto-merge;
 * - on a base merged through a merge queue, Merge when ready, which turns
 *   auto-merge on with no method, so GitHub adds it to the queue once it is
 *   ready, as `gh pr merge --auto` does;
 * - ready to merge, Merge by the method chosen among those the repository
 *   allows, asked first since a merge cannot be undone from here;
 * - with checks still running and auto-merge allowed, Enable auto-merge by
 *   the method chosen.
 *
 * The method is chosen in the panel, over the press, where the repository
 * allows more than one, and kept per repository across launches, in this
 * window's own storage as the sidebar's folds are (`folded-groups.ts`); the
 * first the repository allows stands until one is chosen. A merge and
 * auto-merge name the head the overview read, so GitHub refuses either
 * against a head pushed since. A press closes the panel; while its change is
 * out the button stands busy, and where GitHub refuses it the tab's write
 * note says why, as it says the pill's.
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

/** Each method's press, as GitHub words it. */
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

/** The panel's own words. */
const BOX_WORDS = {
  MERGE_WHEN_READY: "Merge when ready",
  ENABLE_AUTO_MERGE: "Enable auto-merge",
  DISABLE_AUTO_MERGE: "Disable auto-merge",
  DEQUEUE: "Remove from queue",
  CHOOSE_METHOD: "Choose how to merge",
  CLOSE: "Close",
  queued: (position: number) => `#${position} in the merge queue`,
  autoMerge: (method: MergeMethod | null) =>
    method === null ? "Auto-merge is on" : `Auto-merge is on (${METHOD_NOUNS[method]})`,
} as const;

/** What the button says while a change it sent is out. */
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

/** The control's face: its words, the shorter ones a narrow header draws, and its look. */
interface ControlFace {
  readonly label: string;
  readonly short: string;
  readonly variant: ButtonVariant;
}

function face(label: string, short: string, variant: ButtonVariant): ControlFace {
  return { label, short, variant };
}

/** What holds a merge up where nothing may be pressed, quiet: what GitHub says it is blocked on, else where it stands. */
function heldFace(merge: MergeState, merging: PullRequestMerging | undefined): ControlFace {
  const quiet = BUTTON_VARIANT.OUTLINE;
  if (merge === MERGE_STATE.BLOCKED) {
    if (merging?.review === REVIEW_DECISION.CHANGES_REQUESTED) {
      return face("Changes requested", "Changes", quiet);
    }
    if (merging?.review === REVIEW_DECISION.REVIEW_REQUIRED) {
      return face("Review required", "Review", quiet);
    }
    if (merging?.checks === CHECK_SUMMARY.FAILING) return face("Checks failing", "Failing", quiet);
    if (merging?.checks === CHECK_SUMMARY.PENDING) return face("Checks running", "Running", quiet);
    return face("Blocked", "Blocked", quiet);
  }
  if (merge === MERGE_STATE.BEHIND) return face("Out of date", "Behind", quiet);
  if (merge === MERGE_STATE.UNKNOWN) return face("Checking", "Checking", quiet);
  return face("Ready", "Ready", quiet);
}

/** The control's face for where the pull request stands and what it offers. */
function faceOf(pullRequest: CodingAgentOverviewPullRequest, action: MergeAction | undefined) {
  const { merge, merging } = pullRequest;
  const queued = merging?.queued ?? null;
  if (queued !== null) {
    return face(`Queued #${queued.position}`, `#${queued.position}`, BUTTON_VARIANT.WORKING_TINT);
  }
  if ((merging?.autoMerge ?? null) !== null) {
    return face("Auto-merge on", "Auto-merge", BUTTON_VARIANT.WORKING_TINT);
  }
  if (pullRequest.state === PULL_REQUEST_STATE.DRAFT || merge === MERGE_STATE.DRAFT) {
    return face("Draft", "Draft", BUTTON_VARIANT.OUTLINE);
  }
  if (merge === MERGE_STATE.CONFLICTS)
    return face("Conflicts", "Conflicts", BUTTON_VARIANT.DANGER_TINT);
  if (action === MERGE_ACTION.MERGE) return face("Merge", "Merge", BUTTON_VARIANT.PRIMARY);
  if (action === MERGE_ACTION.MERGE_WHEN_READY) {
    return face(BOX_WORDS.MERGE_WHEN_READY, "When ready", BUTTON_VARIANT.PRIMARY);
  }
  if (action === MERGE_ACTION.ENABLE_AUTO_MERGE) {
    return face("Auto-merge", "Auto", BUTTON_VARIANT.OUTLINE);
  }
  return heldFace(merge, merging);
}

/** GitHub's sentence for the merge, the panel's title, and the mergeability under it where that says something else. */
interface MergeSentence {
  readonly title: string;
  readonly words: string | undefined;
}

/** The sentence for where the pull request stands. */
function sentenceOf(pullRequest: CodingAgentOverviewPullRequest): MergeSentence {
  const { merge, merging } = pullRequest;
  const line = mergeWords(merge, pullRequest.base);
  const standing = (merge === MERGE_STATE.BLOCKED ? blockedWords(merging) : undefined) ?? line;
  const queued = merging?.queued ?? null;
  const autoMerge = merging?.autoMerge ?? null;
  const title =
    queued !== null
      ? BOX_WORDS.queued(queued.position)
      : autoMerge !== null
        ? BOX_WORDS.autoMerge(autoMerge.method)
        : standing;
  return { title, words: title === standing ? undefined : standing };
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

/** The press the panel's foot offers for the action, by the method chosen where it takes one. */
interface PanelPress {
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly onPress: () => void;
}

/**
 * The panel the control opens: GitHub's sentence as its title, the
 * mergeability beside it where that differs, the methods to choose among
 * where the press merges by one and the repository allows more than one,
 * and the press. Escape or its × closes it, and so does focus leaving it.
 */
function MergePanel({
  id,
  pullRequest,
  methods,
  method,
  press,
  busy,
  onChoose,
  onClose,
  onLeave,
}: {
  id: string;
  pullRequest: CodingAgentOverviewPullRequest;
  /** The methods the press may merge by; none where it merges by none. */
  methods: readonly MergeMethod[];
  method: MergeMethod | undefined;
  press: PanelPress | undefined;
  busy: boolean;
  onChoose: (method: MergeMethod) => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const pressRef = useRef<HTMLButtonElement>(null);
  const { title, words } = sentenceOf(pullRequest);
  const options: ChoiceOption<MergeMethod>[] = methods.map((each) => ({
    value: each,
    label: METHOD_WORDS[each],
  }));
  return (
    <PopoverPanel
      id={id}
      title={title}
      closeLabel={BOX_WORDS.CLOSE}
      initialFocus={press === undefined ? undefined : pressRef}
      onDismiss={onClose}
      onLeave={onLeave}
    >
      {words === undefined ? null : <p className="merge-panel-words">{words}</p>}
      {options.length < 2 || method === undefined ? null : (
        <ChoiceList<MergeMethod>
          legend={BOX_WORDS.CHOOSE_METHOD}
          look={CHOICE_LOOK.MARKED}
          options={options}
          value={[method]}
          disabled={busy}
          onChange={([next]) => {
            if (next !== undefined) onChoose(next);
          }}
        />
      )}
      {press === undefined ? null : (
        <div className="merge-panel-foot">
          <Button
            ref={pressRef}
            variant={press.variant}
            icon={
              press.variant === BUTTON_VARIANT.PRIMARY ? (
                <GitMergeIcon aria-hidden="true" />
              ) : undefined
            }
            disabled={busy}
            onClick={press.onPress}
          >
            {press.label}
          </Button>
        </div>
      )}
    </PopoverPanel>
  );
}

/**
 * The merge control for an open pull request or a draft, as its overview
 * read it: the button and the panel it opens, and the question a merge asks
 * first. Nothing for one merged or closed.
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
  /** Whether the panel the control stands in is on screen; a merge asked about goes with it. */
  shown: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element | null {
  const { merging } = pullRequest;
  const [method, choose] = useMergeMethod(repository, merging?.methods ?? []);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // The merge asked about, as it stood when Merge was pressed: a read landing under the question never changes what it merges.
  const [asked, setAsked] = useState<{ method: MergeMethod; headSha: string } | undefined>();
  const confirm = useConfirmDialog(
    { subject: asked !== undefined, surfaceOpen: shown },
    async () => {
      if (asked !== undefined) await writes.write({ action: PULL_REQUEST_ACTION.MERGE, ...asked });
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  );
  // Note that a question left behind as its panel hides is let go whole, so the panel comes back asking nothing; one already answered finishes.
  if (!shown && asked !== undefined && !confirm.busy) setAsked(undefined);
  if (!shown && open) setOpen(false);

  // Note that a press outside closes the panel too, as a menu's does, because a press on words nothing can focus moves no focus that would say it was left.
  useEffect(() => {
    if (!open) return undefined;
    const pressed = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", pressed, true);
    return () => document.removeEventListener("pointerdown", pressed, true);
  }, [open]);

  const live =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  if (!live) return null;
  const action =
    merging === undefined || pullRequest.state !== PULL_REQUEST_STATE.OPEN
      ? undefined
      : mergeActionOf(pullRequest.merge, merging);
  const look = faceOf(pullRequest, action);
  const pending = isMergeWrite(writes.pending) ? writes.pending : undefined;
  const busy = writes.pending !== undefined;
  const headSha = merging?.headSha ?? "";

  // Note that we hand focus back to the button, as a menu returns it to its trigger, because closing takes the focused press away with it.
  const close = () => {
    trigger.current?.focus();
    setOpen(false);
  };
  const send = (request: Parameters<PullRequestWrites["write"]>[0]) => {
    close();
    void writes.write(request);
  };
  const pressOf = (): PanelPress | undefined => {
    switch (action) {
      case MERGE_ACTION.DEQUEUE:
        return {
          label: BOX_WORDS.DEQUEUE,
          variant: BUTTON_VARIANT.OUTLINE,
          onPress: () => send({ action: PULL_REQUEST_ACTION.DEQUEUE }),
        };
      case MERGE_ACTION.DISABLE_AUTO_MERGE:
        return {
          label: BOX_WORDS.DISABLE_AUTO_MERGE,
          variant: BUTTON_VARIANT.OUTLINE,
          onPress: () => send({ action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE }),
        };
      case MERGE_ACTION.MERGE_WHEN_READY:
        return {
          label: BOX_WORDS.MERGE_WHEN_READY,
          variant: BUTTON_VARIANT.PRIMARY,
          onPress: () => send({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha }),
        };
      case MERGE_ACTION.MERGE:
        if (method === undefined) return undefined;
        return {
          label: METHOD_WORDS[method],
          variant: BUTTON_VARIANT.PRIMARY,
          onPress: () => {
            close();
            setAsked({ method, headSha });
            confirm.ask();
          },
        };
      case MERGE_ACTION.ENABLE_AUTO_MERGE:
        if (method === undefined) return undefined;
        return {
          label: BOX_WORDS.ENABLE_AUTO_MERGE,
          variant: BUTTON_VARIANT.PRIMARY,
          onPress: () => send({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha }),
        };
      default:
        return undefined;
    }
  };
  const byMethod = action === MERGE_ACTION.MERGE || action === MERGE_ACTION.ENABLE_AUTO_MERGE;
  const busyProps = pending === undefined ? {} : { busy: true, busyLabel: BUSY_WORDS[pending] };
  return (
    <span className="merge-control" ref={root}>
      <Button
        ref={trigger}
        variant={look.variant}
        icon={<GitMergeIcon aria-hidden="true" />}
        label={look.label}
        aria-description={sentenceOf(pullRequest).title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        {...busyProps}
      >
        <span className="merge-control-words">{look.label}</span>
        <span className="merge-control-short" aria-hidden="true">
          {look.short}
        </span>
        <ChevronDownIcon aria-hidden="true" className="merge-control-chevron" />
      </Button>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <MergePanel
            id={panelId}
            pullRequest={pullRequest}
            methods={byMethod ? (merging?.methods ?? []) : []}
            method={method}
            press={pressOf()}
            busy={busy}
            onChoose={choose}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
      {asked === undefined ? null : (
        <ConfirmDialog
          confirm={confirm}
          question={{
            title: `Merge pull request #${pullRequest.number}?`,
            body: `GitHub merges it into ${pullRequest.base} as you, at commit ${asked.headSha.slice(0, 7)}. A merge can't be undone from here.`,
            verb: METHOD_WORDS[asked.method],
            running: "Merging",
            tone: DIALOG_TONE.PRIMARY,
          }}
        />
      )}
    </span>
  );
}
