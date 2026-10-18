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
} from "@luke/features/pull-request-write-wire";
import {
  BUTTON_VARIANT,
  Button,
  type ButtonVariant,
  ConfirmDialog,
  DIALOG_TONE,
  SplitButton,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Schema } from "effect";
import { GitMergeIcon } from "lucide-react";
import { useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { readKept, writeKept } from "../desktop/folded-groups";
import type { PullRequestWrites } from "./pull-request-writes";

/**
 * merge-box.tsx -- the merge box's presses, at the end of the line saying whether an open pull request would merge, as stage-cli's merge status offers them.
 *
 * The box offers the one thing that may be done from where the pull request
 * stands (`mergeActionOf`), each a change the service makes on GitHub as the
 * member pressing it (`pull-request-writes.tsx`), and draws nothing where
 * the overview did not say how it may be merged:
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
 * The method chosen is kept per repository across launches, in this window's
 * own storage as the sidebar's folds are (`folded-groups.ts`), and the first
 * the repository allows stands until one is chosen. A merge and auto-merge
 * name the head the overview read, so GitHub refuses either against a head
 * pushed since. The line's own words say what a merge waits on where GitHub
 * says it is blocked (`blockedWords`).
 */

/** What the box offers from where the pull request stands. */
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

/** The box's own words. */
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

/** The states GitHub would merge in now: ready, or with checks nothing requires short of passing. */
const MERGEABLE: ReadonlySet<MergeState> = new Set([MERGE_STATE.CLEAN, MERGE_STATE.UNSTABLE]);

/** The one thing the box offers from where the pull request stands, or nothing. */
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
export function blockedWords(merging: PullRequestMerging | undefined): string | undefined {
  if (merging === undefined) return undefined;
  if (merging.review === REVIEW_DECISION.CHANGES_REQUESTED) return "Changes were requested";
  if (merging.review === REVIEW_DECISION.REVIEW_REQUIRED) return "A required review is missing";
  if (merging.checks === CHECK_SUMMARY.PENDING) return "Waiting on required checks";
  if (merging.checks === CHECK_SUMMARY.FAILING) return "Required checks are failing";
  return undefined;
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

/**
 * A press that acts by the method chosen, joined to the chevron that opens
 * the methods the repository allows (`@luke/ui`'s SplitButton); the press
 * alone where the repository allows one method.
 */
function MethodPress({
  variant,
  label,
  methods,
  method,
  disabled,
  onPress,
  onChoose,
}: {
  variant: ButtonVariant;
  label: string;
  methods: readonly MergeMethod[];
  method: MergeMethod;
  disabled: boolean;
  onPress: () => void;
  onChoose: (method: MergeMethod) => void;
}): React.JSX.Element {
  const menu = useMenu(methods.length > 1);
  const icon = variant === BUTTON_VARIANT.PRIMARY ? <GitMergeIcon aria-hidden="true" /> : undefined;
  if (methods.length < 2) {
    return (
      <Button variant={variant} icon={icon} disabled={disabled} onClick={onPress}>
        {label}
      </Button>
    );
  }
  const items: MenuAction[] = methods.map((each) => ({
    label: METHOD_WORDS[each],
    checked: each === method,
    onSelect: () => onChoose(each),
  }));
  return (
    <>
      <SplitButton
        variant={variant}
        icon={icon}
        disabled={disabled}
        onClick={onPress}
        menu={{ label: BOX_WORDS.CHOOSE_METHOD, ...menu.trigger() }}
      >
        {label}
      </SplitButton>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={BOX_WORDS.CHOOSE_METHOD}
          menu={menu.drawn}
          groups={[items]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The box's presses for an open pull request, with what stands of a merge
 * already asked for: its place in the queue, or the auto-merge on.
 */
export function MergeActions({
  pullRequest,
  repository,
  shown,
  writes,
}: {
  pullRequest: CodingAgentOverviewPullRequest;
  /** The agent's repository, which the method chosen is kept by. */
  repository: string | null;
  /** Whether the panel the box stands in is on screen; a merge asked about goes with it. */
  shown: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element | null {
  const { merging } = pullRequest;
  const [method, choose] = useMergeMethod(repository, merging?.methods ?? []);
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
  if (merging === undefined || pullRequest.state !== PULL_REQUEST_STATE.OPEN) return null;
  const action = mergeActionOf(pullRequest.merge, merging);
  const busy = writes.pending !== undefined;
  const { headSha } = merging;
  const press = (label: string, onPress: () => void, variant: ButtonVariant) => (
    <Button
      variant={variant}
      icon={variant === BUTTON_VARIANT.PRIMARY ? <GitMergeIcon aria-hidden="true" /> : undefined}
      disabled={busy}
      onClick={onPress}
    >
      {label}
    </Button>
  );
  return (
    <span className="merge-box-actions">
      {merging.queued === null ? null : (
        <span className="merge-box-note">{BOX_WORDS.queued(merging.queued.position)}</span>
      )}
      {merging.autoMerge === null || merging.queued !== null ? null : (
        <span className="merge-box-note">{BOX_WORDS.autoMerge(merging.autoMerge.method)}</span>
      )}
      {action === MERGE_ACTION.DEQUEUE
        ? press(
            BOX_WORDS.DEQUEUE,
            () => void writes.write({ action: PULL_REQUEST_ACTION.DEQUEUE }),
            BUTTON_VARIANT.OUTLINE,
          )
        : null}
      {action === MERGE_ACTION.DISABLE_AUTO_MERGE
        ? press(
            BOX_WORDS.DISABLE_AUTO_MERGE,
            () => void writes.write({ action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE }),
            BUTTON_VARIANT.OUTLINE,
          )
        : null}
      {action === MERGE_ACTION.MERGE_WHEN_READY
        ? press(
            BOX_WORDS.MERGE_WHEN_READY,
            () => void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha }),
            BUTTON_VARIANT.PRIMARY,
          )
        : null}
      {action === MERGE_ACTION.MERGE && method !== undefined ? (
        <MethodPress
          variant={BUTTON_VARIANT.PRIMARY}
          label={METHOD_WORDS[method]}
          methods={merging.methods}
          method={method}
          disabled={busy}
          onChoose={choose}
          onPress={() => {
            setAsked({ method, headSha });
            confirm.ask();
          }}
        />
      ) : null}
      {action === MERGE_ACTION.ENABLE_AUTO_MERGE && method !== undefined ? (
        <MethodPress
          variant={BUTTON_VARIANT.OUTLINE}
          label={BOX_WORDS.ENABLE_AUTO_MERGE}
          methods={merging.methods}
          method={method}
          disabled={busy}
          onChoose={choose}
          onPress={() =>
            void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha })
          }
        />
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
