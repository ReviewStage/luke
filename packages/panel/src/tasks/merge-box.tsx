import {
  type AgentOverviewPullRequest,
  CHECK_SUMMARY,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  REVIEW_DECISION,
} from "@repo/features/agent-wire";
import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_ACTION,
  type PullRequestAction,
} from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  Badge,
  BUTTON_VARIANT,
  Button,
  type ButtonVariant,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  SPINNER_SIZE,
  SpinnerRing,
  SplitButton,
  STATUS_TONE,
  type StatusTone,
  Tooltip,
  useConfirmDialog,
  useMenu,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@repo/ui";
import { Schema } from "effect";
import { CircleXIcon, GitMergeIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { keptKey, useKept } from "../use-kept.js";
import { queuedLabel } from "./agent-model.js";
import { type PullRequestWrites, QUEUE_WARNING } from "./pull-request-writes.js";

const MERGE_ACTION = {
  MERGE: "merge",
  MERGE_WHEN_READY: "merge-when-ready",
  ENABLE_AUTO_MERGE: "enable-auto-merge",
  DISABLE_AUTO_MERGE: "disable-auto-merge",
  DEQUEUE: "dequeue",
} as const;

type MergeAction = (typeof MERGE_ACTION)[keyof typeof MERGE_ACTION];

const PRESS_WORDS = {
  [MERGE_METHOD.MERGE]: "Merge pull request",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

const METHOD_WORDS = {
  [MERGE_METHOD.MERGE]: "Create a merge commit",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

const METHOD_NOUNS = {
  [MERGE_METHOD.MERGE]: "merge commit",
  [MERGE_METHOD.SQUASH]: "squash",
  [MERGE_METHOD.REBASE]: "rebase",
} as const satisfies Record<MergeMethod, string>;

const BOX_WORDS = {
  MERGE_WHEN_READY: "Merge when ready",
  ENABLE_AUTO_MERGE: "Enable auto-merge",
  DISABLE_AUTO_MERGE: "Disable auto-merge",
  DEQUEUE: "Remove from queue",
  CHOOSE_METHOD: "Choose how to merge",
  autoMerge: (method: MergeMethod | null) =>
    method === null ? "Auto-merge is on" : `Auto-merge is on (${METHOD_NOUNS[method]})`,
} as const;

const BUSY_WORDS = {
  [PULL_REQUEST_ACTION.MERGE]: "Merging",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Turning on auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Turning off auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Removing from queue",
} as const;

type MergeWrite = keyof typeof BUSY_WORDS;

function isMergeWrite(action: PullRequestAction | undefined): action is MergeWrite {
  return action !== undefined && action in BUSY_WORDS;
}

const MERGEABLE: ReadonlySet<MergeState> = new Set([MERGE_STATE.CLEAN, MERGE_STATE.UNSTABLE]);

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

function blockedWords(merging: PullRequestMerging | undefined): string | undefined {
  if (merging === undefined) return undefined;
  if (merging.review === REVIEW_DECISION.CHANGES_REQUESTED) return "Changes were requested";
  if (merging.review === REVIEW_DECISION.REVIEW_REQUIRED) return "A required review is missing";
  if (merging.checks === CHECK_SUMMARY.PENDING) return "Waiting on required checks";
  if (merging.checks === CHECK_SUMMARY.FAILING) return "Required checks are failing";
  return undefined;
}

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

function sentenceOf(pullRequest: AgentOverviewPullRequest): string {
  const { merge, merging } = pullRequest;
  const line = mergeWords(merge, pullRequest.base);
  const standing = (merge === MERGE_STATE.BLOCKED ? blockedWords(merging) : undefined) ?? line;
  const queued = merging?.queued ?? null;
  const autoMerge = merging?.autoMerge ?? null;
  const lead =
    queued !== null
      ? queuedLabel(queued.position)
      : autoMerge !== null
        ? BOX_WORDS.autoMerge(autoMerge.method)
        : undefined;
  return lead === undefined ? standing : `${lead}. ${standing}`;
}

const storedMethods = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals(Object.values(MERGE_METHOD))),
);

const KEPT = { METHODS: keptKey("app.pullRequestMergeMethods", storedMethods) } as const;

function useMergeMethod(
  repository: string | null,
  allowed: readonly MergeMethod[],
): readonly [MergeMethod | undefined, (method: MergeMethod) => void] {
  const [kept, , change] = useKept(KEPT.METHODS, {});
  const chosen = repository === null ? undefined : kept[repository];
  const method = chosen !== undefined && allowed.includes(chosen) ? chosen : allowed[0];
  const choose = (next: MergeMethod) => {
    if (repository === null) return;
    change((held) => ({ ...held, [repository]: next }));
  };
  return [method, choose];
}

interface ChipFace {
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: ReactNode;
}

const CHIP_GLYPHS = {
  CHECKING: <SpinnerRing size={SPINNER_SIZE.SMALL} />,
  HELD: <CircleXIcon aria-hidden="true" />,
  BEHIND: <TriangleAlertIcon aria-hidden="true" />,
  REVIEW: <UserRoundIcon aria-hidden="true" />,
  READY: <GitMergeIcon aria-hidden="true" />,
} as const;

function chip(label: string, tone: StatusTone, icon: ReactNode): ChipFace {
  return { label, tone, icon };
}

function blockedChip(merging: PullRequestMerging | undefined): ChipFace | undefined {
  if (merging?.review === REVIEW_DECISION.CHANGES_REQUESTED) {
    return chip("Changes requested", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
  }
  if (merging?.review === REVIEW_DECISION.REVIEW_REQUIRED) {
    return chip("Review required", STATUS_TONE.ATTENTION, CHIP_GLYPHS.REVIEW);
  }
  if (merging?.checks === CHECK_SUMMARY.FAILING || merging?.checks === CHECK_SUMMARY.PENDING) {
    return undefined;
  }
  return chip("Blocked", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
}

function chipOf(
  pullRequest: AgentOverviewPullRequest,
  action: MergeAction | undefined,
): ChipFace | undefined {
  const { merge, merging } = pullRequest;
  if ((merging?.queued ?? null) !== null) return undefined;
  if (pullRequest.state === PULL_REQUEST_STATE.DRAFT || merge === MERGE_STATE.DRAFT) {
    return undefined;
  }
  switch (merge) {
    case MERGE_STATE.UNKNOWN:
      return chip("Checking", STATUS_TONE.WORKING, CHIP_GLYPHS.CHECKING);
    case MERGE_STATE.CONFLICTS:
      return chip("Conflicts", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
    case MERGE_STATE.BEHIND:
      return chip("Behind", STATUS_TONE.ATTENTION, CHIP_GLYPHS.BEHIND);
    case MERGE_STATE.BLOCKED:
      return blockedChip(merging);
    default:
      return action === undefined
        ? chip("Ready", STATUS_TONE.COMPLETE, CHIP_GLYPHS.READY)
        : undefined;
  }
}

function MergeChip({ face, sentence }: { face: ChipFace; sentence: string }): React.JSX.Element {
  return (
    <Tooltip label={sentence}>
      <span className="merge-chip inline-flex min-w-0">
        <Badge tone={face.tone} icon={face.icon} hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}>
          {face.label}
        </Badge>
        <VisuallyHidden>{`: ${sentence}`}</VisuallyHidden>
      </span>
    </Tooltip>
  );
}

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

function busyProps(busyLabel: string | undefined) {
  return busyLabel === undefined ? {} : { busy: true, busyLabel };
}

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
  busy: boolean;
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
        onClick={onPress}
        {...busyProps(busyLabel)}
        menu={{ label: BOX_WORDS.CHOOSE_METHOD, ...menu.trigger() }}
      >
        {words}
      </SplitButton>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={BOX_WORDS.CHOOSE_METHOD}
          menu={menu.drawn}
          groups={[methodItems(methods, method, busy, onChoose)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

const DEQUEUE_QUESTION: DialogQuestion = {
  title: "Remove from the merge queue?",
  body: QUEUE_WARNING,
  verb: BOX_WORDS.DEQUEUE,
  running: BUSY_WORDS[PULL_REQUEST_ACTION.DEQUEUE],
  loss: CONFIRM_LOSS.AFFECTS_OTHERS,
  replayUnmasked: true,
};

export function MergeControl({
  pullRequest,
  repository,
  shown,
  writes,
}: {
  pullRequest: AgentOverviewPullRequest;
  repository: string | null;
  shown: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element | null {
  const { merging } = pullRequest;
  const methods = merging?.methods ?? [];
  const [method, choose] = useMergeMethod(repository, methods);
  const [asked, setAsked] = useState(false);
  const inQueue = (merging?.queued ?? null) !== null;
  const confirm = useConfirmDialog(
    { subject: asked && inQueue, surfaceOpen: shown },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.DEQUEUE }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_DEQUEUE),
  );
  if ((!shown || !inQueue) && asked && !confirm.busy) setAsked(false);

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
    <span className="merge-control flex min-h-control min-w-0 items-center gap-control-gap">
      {face === undefined ? null : <MergeChip face={face} sentence={sentenceOf(pullRequest)} />}
      {drawn}
      <ConfirmDialog open confirm={confirm} question={DEQUEUE_QUESTION} />
    </span>
  );
}
