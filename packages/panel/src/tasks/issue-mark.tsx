import { ISSUE_STATE, type IssueState } from "@luke/features/github-repositories-wire";
import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";

/**
 * issue-mark.tsx -- a GitHub issue's mark: GitHub's glyph for where it stands, in GitHub's colour for it.
 *
 * A link to an issue wears it on its chip, as a link to a pull request
 * wears `pull-request-mark.tsx`'s: open in the success green, closed as done
 * in the merged purple GitHub closes one in, and closed as not planned in
 * the muted ink. The colour is the stylesheet's, keyed on
 * `data-issue-state` (`planning.css`).
 */

/** The glyph an issue is drawn with for where it stands, as GitHub draws it. */
const ISSUE_GLYPH = {
  [ISSUE_STATE.OPEN]: CircleDotIcon,
  [ISSUE_STATE.CLOSED]: CircleCheckIcon,
  [ISSUE_STATE.NOT_PLANNED]: CircleSlashIcon,
} as const;

/** An issue's words for a reader who cannot see its mark. */
const ISSUE_MARK_WORDS = {
  [ISSUE_STATE.OPEN]: "open",
  [ISSUE_STATE.CLOSED]: "closed",
  [ISSUE_STATE.NOT_PLANNED]: "not planned",
} as const satisfies Record<IssueState, string>;

/** An issue's mark: its glyph for where it stands, coloured for it, and named for a reader who cannot see it. */
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
