import { Option, Schema } from "effect";
import { useState } from "react";
import { INBOX_GROUPING, type InboxGrouping } from "../planning/inbox-model";

/**
 * folded-groups.ts -- which of the sidebar's groups the developer folded, Pinned and the repositories', kept across launches, and the Inbox's plan groups, how it lists its items, and how wide its list stands kept the same way.
 *
 * A fold is this window's alone, as the sidebar's width is, so it is kept in
 * the renderer's own storage rather than on the account: a group folded on
 * one Mac stays open on another. A group is kept by its repository's full
 * name, and the plans with no repository by null. A repository whose last
 * plan goes leaves its entry behind: it is a few bytes, and a plan on it
 * later comes back folded as it was left. Pinned is kept under a key of
 * its own, since it is no repository. A fixture run starts with every group open
 * and keeps nothing, so its frames never wear a developer's folds. The
 * Inbox's plan groups are kept on the same terms, each by its plan's id,
 * and so are its two view choices, Needs you and how it groups, and its
 * list's width; a fixture run draws no inbox, so it has nothing staged to
 * keep apart.
 */

/** Where the folds are kept in the renderer's storage. */
const STORAGE_KEY = {
  GROUPS: "luke.sidebarFoldedGroups",
  PINNED: "luke.sidebarPinnedFolded",
  INBOX_PLANS: "luke.inboxFoldedPlans",
  INBOX_WAITING_ONLY: "luke.inboxWaitingOnly",
  INBOX_GROUPING: "luke.inboxGrouping",
  INBOX_LIST_WIDTH: "luke.inboxListWidth",
} as const;

/**
 * How wide the Inbox's list may be dragged, in CSS pixels, and where it
 * starts: a mail app's message list, never so narrow that its head, with
 * the folded sidebar's buttons standing over its start, cannot name the
 * Inbox beside its own buttons, and starting wide enough that the name
 * stands centred over the list past those buttons.
 */
export const INBOX_LIST_WIDTH = {
  MIN: 300,
  MAX: 520,
  DEFAULT: 360,
} as const;

/** The folded groups, each by its repository, null for the plans with none. */
const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

/** Whether Pinned is folded, or the Inbox lists only what waits. */
const storedFlag = Schema.fromJsonString(Schema.Boolean);

/** The Inbox's folded plans, by id. */
const storedPlans = Schema.fromJsonString(Schema.Array(Schema.String));

/** How wide the Inbox's list stands. */
const storedWidth = Schema.fromJsonString(Schema.Finite);

/** How the Inbox groups its items. */
const storedGrouping = Schema.fromJsonString(Schema.Literals(Object.values(INBOX_GROUPING)));

/** Every fold the sidebar keeps. */
interface Folds {
  readonly groups: readonly (string | null)[];
  readonly pinned: boolean;
}

const OPEN: Folds = { groups: [], pinned: false };

/** A kept value, or `fallback` where none was kept, it no longer reads, or storage refuses the read. */
export function readKept<A>(key: string, schema: Schema.Codec<A, string>, fallback: A): A {
  try {
    const decoded = Schema.decodeUnknownOption(schema)(window.localStorage.getItem(key));
    return Option.getOrElse(decoded, () => fallback);
  } catch {
    return fallback;
  }
}

/** Keeps a value; a write that fails costs only a group open again next launch, so it is not worth a word. */
export function writeKept<A>(key: string, schema: Schema.Codec<A, string>, value: A): void {
  try {
    window.localStorage.setItem(key, Schema.encodeSync(schema)(value));
  } catch {
    // The group opens again on the next launch.
  }
}

/** The kept folds, each open where none was kept. */
function readFolds(): Folds {
  return {
    groups: readKept(STORAGE_KEY.GROUPS, storedFolds, OPEN.groups),
    pinned: readKept(STORAGE_KEY.PINNED, storedFlag, OPEN.pinned),
  };
}

/** Keeps every fold. */
function writeFolds(folds: Folds): void {
  writeKept(STORAGE_KEY.GROUPS, storedFolds, folds.groups);
  writeKept(STORAGE_KEY.PINNED, storedFlag, folds.pinned);
}

/** Whether each group is folded, and the presses that fold or unfold one. */
export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
  pinnedFolded: boolean;
  togglePinned: () => void;
}

/** The sidebar's folds, each kept as it is pressed, unless the run is `staged`. */
export function useFoldedGroups(staged: boolean): FoldedGroups {
  // Note that the fixture run's folds are a state of their own rather than
  // the kept ones reset, because the run is only known a render after the
  // kept folds were read, as `sidebar-collapse.ts` says of its own.
  const [kept, setKept] = useState(readFolds);
  const [stagedFolds, setStagedFolds] = useState<Folds>(OPEN);
  const folds = staged ? stagedFolds : kept;
  const fold = (next: Folds) => {
    if (staged) {
      setStagedFolds(next);
      return;
    }
    setKept(next);
    writeFolds(next);
  };
  const toggle = (repository: string | null) => {
    const groups = folds.groups.includes(repository)
      ? folds.groups.filter((held) => held !== repository)
      : [...folds.groups, repository];
    fold({ ...folds, groups });
  };
  return {
    folded: (repository) => folds.groups.includes(repository),
    toggle,
    pinnedFolded: folds.pinned,
    togglePinned: () => fold({ ...folds, pinned: !folds.pinned }),
  };
}

/** Which of the Inbox's plan groups are folded, and the press that folds or unfolds one. */
export interface InboxPlanFolds {
  folded: (planId: string) => boolean;
  toggle: (planId: string) => void;
}

/** The Inbox's plan groups, each open until it is first folded, and kept as it is pressed. */
export function useInboxPlanFolds(): InboxPlanFolds {
  const [folded, setFolded] = useState(() => readKept(STORAGE_KEY.INBOX_PLANS, storedPlans, []));
  return {
    folded: (planId) => folded.includes(planId),
    toggle: (planId) => {
      const next = folded.includes(planId)
        ? folded.filter((held) => held !== planId)
        : [...folded, planId];
      setFolded(next);
      writeKept(STORAGE_KEY.INBOX_PLANS, storedPlans, next);
    },
  };
}

/** How the Inbox lists its items, and the presses that change it. */
export interface InboxViewChoices {
  waitingOnly: boolean;
  grouping: InboxGrouping;
  onWaitingOnly: (waitingOnly: boolean) => void;
  onGrouping: (grouping: InboxGrouping) => void;
}

/** The Inbox's view choices, every item grouped by plan until first changed, and kept as each is pressed. */
export function useInboxViewChoices(): InboxViewChoices {
  const [waitingOnly, setWaitingOnly] = useState(() =>
    readKept(STORAGE_KEY.INBOX_WAITING_ONLY, storedFlag, false),
  );
  const [grouping, setGrouping] = useState<InboxGrouping>(() =>
    readKept(STORAGE_KEY.INBOX_GROUPING, storedGrouping, INBOX_GROUPING.PLAN),
  );
  return {
    waitingOnly,
    grouping,
    onWaitingOnly: (next) => {
      setWaitingOnly(next);
      writeKept(STORAGE_KEY.INBOX_WAITING_ONLY, storedFlag, next);
    },
    onGrouping: (next) => {
      setGrouping(next);
      writeKept(STORAGE_KEY.INBOX_GROUPING, storedGrouping, next);
    },
  };
}

/** A width held within the list's bounds, in whole pixels. */
function clampListWidth(width: number): number {
  return Math.min(INBOX_LIST_WIDTH.MAX, Math.max(INBOX_LIST_WIDTH.MIN, Math.round(width)));
}

/** How wide the Inbox's list stands, and the drag that asks for another width. */
export interface InboxListWidth {
  /** Always within {@link INBOX_LIST_WIDTH}. */
  width: number;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/** The Inbox list's width, the default until first dragged, and kept as it is. */
export function useInboxListWidth(): InboxListWidth {
  const [width, setWidth] = useState(() =>
    clampListWidth(readKept(STORAGE_KEY.INBOX_LIST_WIDTH, storedWidth, INBOX_LIST_WIDTH.DEFAULT)),
  );
  return {
    width,
    onResize: (asked) => {
      const next = clampListWidth(asked);
      setWidth(next);
      writeKept(STORAGE_KEY.INBOX_LIST_WIDTH, storedWidth, next);
    },
  };
}
