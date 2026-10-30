import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, Tooltip } from "@luke/ui";
import type { ReactNode } from "react";
import { pullRequestNumberLabel } from "./agent-model.js";
import {
  PullRequestMark,
  type PullRequestMarked,
  pullRequestMarkState,
} from "./pull-request-mark.js";

/**
 * pull-request-chip.tsx -- a pull request as a compact chip: GitHub's mark in GitHub's colour for where it stands, and its number.
 *
 * The plan's Agents list ends an agent's row with it (`plan-agents.tsx`),
 * and a related task's row ends with one for each of the task's open pull
 * requests (`task-list-row.tsx`), so a pull request reads the same in both.
 * It hangs the card its owner hands, the pull request's one card
 * (`pull-request-card.tsx`), its title its hint. A press opens the pull
 * request as its owner says, in its agent's Pull request tab where the
 * window can, so the browser never follows its address; it is still a link
 * to its page, so a right-click offers its address.
 */

/** What a pull request's chip is drawn from: its mark's, its title, and its page. */
export type ChippedPullRequest = PullRequestMarked & {
  readonly title: string;
  readonly url: string;
};

/** A pull request as a chip: its mark and its number, hanging `card`. */
export function PullRequestChip({
  pullRequest,
  card,
  onOpen,
}: {
  pullRequest: ChippedPullRequest;
  /** The card it hangs. */
  card: ReactNode;
  /** Opens the pull request, as its Pull request tab or its page. */
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
          // Note that the page opens in the window's Pull request tab, so the browser does not follow the address.
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
