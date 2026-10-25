/**
 * pull-request-branches.tsx -- the branches a pull request merges, in its header: each a chip whose press copies its name, as stage-cli's do.
 *
 * The branch it merges into, then the one it merges from, as GitHub writes
 * them (`main ← topic`), each a compact pill in the code face, a long name
 * cut in its middle so its last words, which tell one branch of a stack
 * from the next, stand whole, and the whole name in its hint. A head on a
 * fork is named as GitHub names it, by the fork's account and its branch
 * (`octocat:patch-1`). Each is a `CopyButton` in its chip look: a press
 * copies what the chip names, its glyph, a branch's at rest, turning to the
 * copy glyph under the pointer or the keyboard, then to the check for a
 * moment once the clipboard took it, its hint saying "Copied". Each is a
 * button named for what it copies ("Copy branch main"), so the keyboard
 * reaches it and a reader hears it.
 */

import { COPY_LOOK, CopyButton } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { copyThroughShell } from "../copy-feedback.js";

/** A head's name as GitHub writes it: its branch, after its fork's account where it stands on a fork. */
function headName(head: string, owner: string | undefined): string {
  return owner === undefined ? head : `${owner}:${head}`;
}

/** One branch as a chip that copies its name. */
function BranchChip({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 max-w-branch-chip flex-[0_4_auto] first:shrink">
      <CopyButton
        look={COPY_LOOK.CHIP}
        lead={GLYPH.BRANCH}
        text={name}
        what={`branch ${name}`}
        copy={copyThroughShell}
      />
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
    <span className="pull-request-branches inline-flex min-w-0 max-w-full items-center gap-tight-gap whitespace-nowrap">
      <BranchChip name={base} />
      <span className="flex-none text-muted-foreground" aria-hidden="true">
        {" ← "}
      </span>
      <BranchChip name={headName(head, headOwner)} />
    </span>
  );
}
