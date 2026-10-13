import { Option, Schema } from "effect";
import { useState } from "react";

/**
 * folded-groups.ts -- which of the sidebar's groups the developer folded, Pinned and the repositories', kept across launches, and the Inbox board's Waiting kept the same way.
 *
 * A fold is this window's alone, as the sidebar's width is, so it is kept in
 * the renderer's own storage rather than on the account: a group folded on
 * one Mac stays open on another. A group is kept by its repository's full
 * name, and the plans with no repository by null. A repository whose last
 * plan goes leaves its entry behind: it is a few bytes, and a plan on it
 * later comes back folded as it was left. Pinned is kept under a key of
 * its own, since it is no repository. A fixture run starts with every group open
 * and keeps nothing, so its frames never wear a developer's folds. The
 * Inbox board's Waiting is kept on the same terms under a key of its own;
 * a fixture run draws no inbox, so it has no staged fold to keep apart.
 */

/** Where the folds are kept in the renderer's storage. */
const STORAGE_KEY = {
  GROUPS: "luke.sidebarFoldedGroups",
  PINNED: "luke.sidebarPinnedFolded",
  INBOX_WAITING: "luke.inboxWaitingFolded",
} as const;

/** The folded groups, each by its repository, null for the plans with none. */
const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

/** Whether Pinned is folded. */
const storedFolded = Schema.fromJsonString(Schema.Boolean);

/** Every fold the sidebar keeps. */
interface Folds {
  readonly groups: readonly (string | null)[];
  readonly pinned: boolean;
}

const OPEN: Folds = { groups: [], pinned: false };

/** A kept value, or `fallback` where none was kept, it no longer reads, or storage refuses the read. */
function readKept<A>(key: string, schema: Schema.Codec<A, string>, fallback: A): A {
  try {
    const decoded = Schema.decodeUnknownOption(schema)(window.localStorage.getItem(key));
    return Option.getOrElse(decoded, () => fallback);
  } catch {
    return fallback;
  }
}

/** Keeps a value; a write that fails costs only a group open again next launch, so it is not worth a word. */
function writeKept<A>(key: string, schema: Schema.Codec<A, string>, value: A): void {
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
    pinned: readKept(STORAGE_KEY.PINNED, storedFolded, OPEN.pinned),
  };
}

/** Keeps every fold. */
function writeFolds(folds: Folds): void {
  writeKept(STORAGE_KEY.GROUPS, storedFolds, folds.groups);
  writeKept(STORAGE_KEY.PINNED, storedFolded, folds.pinned);
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

/** Whether the Inbox board's Waiting is folded, and the press that folds or unfolds it. */
export interface WaitingFold {
  folded: boolean;
  toggle: () => void;
}

/** The Inbox board's Waiting, open until it is first folded, and kept as it is pressed. */
export function useWaitingFold(): WaitingFold {
  const [folded, setFolded] = useState(() =>
    readKept(STORAGE_KEY.INBOX_WAITING, storedFolded, false),
  );
  return {
    folded,
    toggle: () => {
      setFolded(!folded);
      writeKept(STORAGE_KEY.INBOX_WAITING, storedFolded, !folded);
    },
  };
}
