import { ISSUE_STATE, type IssueState } from "@repo/features/github-repositories-wire";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";

const ISSUE_GLYPH = {
  [ISSUE_STATE.OPEN]: CircleDotIcon,
  [ISSUE_STATE.CLOSED]: CircleCheckIcon,
  [ISSUE_STATE.NOT_PLANNED]: CircleSlashIcon,
} as const;

const ISSUE_MARK_WORDS = {
  [ISSUE_STATE.OPEN]: "open",
  [ISSUE_STATE.CLOSED]: "closed",
  [ISSUE_STATE.NOT_PLANNED]: "not planned",
} as const satisfies Record<IssueState, string>;

export function IssueMark({
  issue,
}: {
  issue: { readonly number: number; readonly state: IssueState };
}): React.JSX.Element {
  const Glyph = ISSUE_GLYPH[issue.state];
  return (
    <Glyph
      className="issue-mark"
      data-issue-mark=""
      data-issue-state={issue.state}
      role="img"
      aria-label={`Issue #${issue.number}, ${ISSUE_MARK_WORDS[issue.state]}`}
    />
  );
}
