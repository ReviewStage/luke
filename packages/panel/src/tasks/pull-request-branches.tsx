/**
 * pull-request-branches.tsx -- the branches a pull request merges, in its header: each a chip whose press copies its name, as stage-cli's do.
 *
 * The branch it merges into, then the one it merges from, as GitHub writes
 * them (`main ← topic`), each a compact pill in the code face, a long name
 * cut in its middle so its last words, which tell one branch of a stack
 * from the next, stand whole, and the whole name in its hint. A head on a
 * fork is named as GitHub names it, by the fork's account and its branch
 * (`octocat:patch-1`). A press copies what the chip names, answered as every
 * copy button is (`copy-feedback.tsx`): its glyph, a branch's at rest, turns
 * to the copy glyph under the pointer or the keyboard, saying what a press
 * does, then to the check for a moment once the clipboard took it, its hint
 * saying "Copied". Each is a button named for what it copies ("Copy branch
 * main"), so the keyboard reaches it and a reader hears it.
 */

import { CHIP_CUT, CHIP_LOOK, CHIP_SIZE, Chip, ChipName, Tooltip } from "@luke/ui";
import { GitBranchIcon } from "lucide-react";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback.js";

/** What a branch's chip is named, for what its press copies. */
function copyLabel(name: string): string {
  return `Copy branch ${name}`;
}

/** A head's name as GitHub writes it: its branch, after its fork's account where it stands on a fork. */
function headName(head: string, owner: string | undefined): string {
  return owner === undefined ? head : `${owner}:${head}`;
}

/** One branch as a chip: its glyph, its name cut in its middle where long, and a press that copies the name. */
function BranchChip({ name }: { name: string }): React.JSX.Element {
  const { state, copy } = useCopyFeedback();
  return (
    <span className="pull-request-branch">
      <Tooltip label={copyHint(state, name)}>
        <Chip
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          aria-label={copyLabel(name)}
          onClick={() => copy(name)}
        >
          <span className="pull-request-branch-glyph" data-state={state}>
            <GitBranchIcon aria-hidden="true" data-glyph="branch" />
            <CopyGlyph state={state} />
          </span>
          <ChipName mono cut={CHIP_CUT.MIDDLE}>
            {name}
          </ChipName>
        </Chip>
      </Tooltip>
    </span>
  );
}

/** The branch it merges into, then the one it merges from, each a chip that copies its name. */
export function PullRequestBranches({
  base,
  head,
  headOwner,
}: {
  base: string;
  head: string;
  /** The account whose fork its head stands on, where it is not the repository's own. */
  headOwner?: string | undefined;
}): React.JSX.Element {
  return (
    <span className="pull-request-branches">
      <BranchChip name={base} />
      <span className="pull-request-branches-arrow" aria-hidden="true">
        {" ← "}
      </span>
      <BranchChip name={headName(head, headOwner)} />
    </span>
  );
}
