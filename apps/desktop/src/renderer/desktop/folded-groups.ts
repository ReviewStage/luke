import { Option, Schema } from "effect";
import { useState } from "react";

/**
 * folded-groups.ts -- which of the sidebar's repository groups the developer folded, kept across launches.
 *
 * A fold is this window's alone, as the sidebar's width is, so it is kept in
 * the renderer's own storage rather than on the account: a group folded on
 * one Mac stays open on another. A group is kept by its repository's full
 * name, and the plans with no repository by null. A repository whose last
 * plan goes leaves its entry behind: it is a few bytes, and a plan on it
 * later comes back folded as it was left. A fixture run starts with every
 * group open and keeps nothing, so its frames never wear a developer's folds.
 */

/** Where the folded groups are kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidebarFoldedGroups";

/** The folded groups, each by its repository, null for the plans with none. */
const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

const decodeStored = Schema.decodeUnknownOption(storedFolds);
const encodeStored = Schema.encodeSync(storedFolds);

/** The kept folds, or none where none were kept, they no longer read, or storage refuses the read. */
function readFolds(): readonly (string | null)[] {
  try {
    return Option.getOrElse(decodeStored(window.localStorage.getItem(STORAGE_KEY)), () => []);
  } catch {
    return [];
  }
}

/** Keeps the folds; a write that fails costs only a group open again next launch, so it is not worth a word. */
function writeFolds(folds: readonly (string | null)[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStored(folds));
  } catch {
    // The group opens again on the next launch.
  }
}

/** Whether each repository's group is folded, and the press that folds or unfolds one. */
export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
}

/** The sidebar's folds, each kept as it is pressed, unless the run is `staged`. */
export function useFoldedGroups(staged: boolean): FoldedGroups {
  // Note that the fixture run's folds are a state of their own rather than
  // the kept ones reset, because the run is only known a render after the
  // kept folds were read, as `sidebar-collapse.ts` says of its own.
  const [kept, setKept] = useState(readFolds);
  const [stagedFolds, setStagedFolds] = useState<readonly (string | null)[]>([]);
  const folds = staged ? stagedFolds : kept;
  const toggle = (repository: string | null) => {
    const next = folds.includes(repository)
      ? folds.filter((held) => held !== repository)
      : [...folds, repository];
    if (staged) {
      setStagedFolds(next);
      return;
    }
    setKept(next);
    writeFolds(next);
  };
  return { folded: (repository) => folds.includes(repository), toggle };
}
