/**
 * pull-request-branches.tsx -- the branches a pull request merges, in its header: each a chip whose press copies its name, as stage-cli's do.
 *
 * The branch it merges into, then the one it merges from, as GitHub writes
 * them (`main ← topic`), each a compact pill in the code face, a long name
 * cut in its middle so its last words, which tell one branch of a stack
 * from the next, stand whole, and the whole name in its hint. Where the row
 * runs short the head gives way and the base stands whole, since a base is
 * short (`main`) and a cut one reads as nothing (`mai`); a base longer than
 * half the row is cut to that half, so the head keeps the other. A head on a
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

/** How a branch's chip takes the row's room: the base kept whole, the head giving way. */
const CHIP_ROOM = {
  BASE: "max-w-branch-base flex-none",
  HEAD: "max-w-branch-chip flex-[0_1_auto]",
} as const;

type ChipRoom = (typeof CHIP_ROOM)[keyof typeof CHIP_ROOM];

/** One branch as a chip that copies its name, taking the row's room as `room` says. */
function BranchChip({ name, room }: { name: string; room: ChipRoom }): React.JSX.Element {
  return (
    <span className={`inline-flex min-w-0 ${room}`}>
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
      <BranchChip name={base} room={CHIP_ROOM.BASE} />
      <span className="flex-none text-muted-foreground" aria-hidden="true">
        {" ← "}
      </span>
      <BranchChip name={headName(head, headOwner)} room={CHIP_ROOM.HEAD} />
    </span>
  );
}
