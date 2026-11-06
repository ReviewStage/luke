import { COPY_LOOK, CopyButton } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { copyThroughShell } from "../copy-feedback.js";

function headName(head: string, owner: string | undefined): string {
  return owner === undefined ? head : `${owner}:${head}`;
}

const CHIP_ROOM = {
  BASE: "max-w-branch-base flex-none",
  HEAD: "max-w-branch-chip flex-[0_1_auto]",
} as const;

type ChipRoom = (typeof CHIP_ROOM)[keyof typeof CHIP_ROOM];

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

export function PullRequestBranches({
  base,
  head,
  headOwner,
}: {
  base: string;
  head: string;
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
