import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, pullRequestMarkState, Tooltip } from "@repo/ui";
import type { ReactNode } from "react";
import { pullRequestNumberLabel } from "./agent-model.js";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark.js";

export type ChippedPullRequest = PullRequestMarked & {
  readonly title: string;
  readonly url: string;
};

export function PullRequestChip({
  pullRequest,
  card,
  onOpen,
}: {
  pullRequest: ChippedPullRequest;
  card: ReactNode;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={pullRequest.title} card={card}>
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        data-pull-request-state={pullRequestMarkState(pullRequest)}
        href={pullRequest.url}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        <PullRequestMark pullRequest={pullRequest} />
        <ChipName>{pullRequestNumberLabel(pullRequest)}</ChipName>
      </Chip>
    </Tooltip>
  );
}
