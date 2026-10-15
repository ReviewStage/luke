import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { ComposeIcon, ProviderMark } from "@luke/ui";
import { RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu";
import { Spinner } from "../spinner";
import { useDisclosure } from "../use-disclosure";

/**
 * linear-issue-picker.tsx -- New plan from the sidebar, where the listed workspace has Linear connected: the workspace's issues to start a plan from, hung from the button by a notch.
 *
 * The picker opens beside the sidebar's New plan, its notch pointing back
 * at the press that opened it, as a popover names what it came from. Its
 * rows are the issues the workspace's one Linear connection reaches, newest
 * changed first, each by its title with its key and state after it, and a
 * search over them; pinned under them, Blank plan opens the New plan
 * dialog as a press did before Linear was connected. Picking an issue
 * starts its plan at once, named by the issue's title, with no dialog to
 * review: the plan opens and its call starts, and Luke is handed the issue
 * to research. A start that was refused says why in the list's place, and
 * the issues stay to pick again. The issues are read each time the picker
 * opens, so one changed in Linear meanwhile is listed as it stands.
 */

/** What the picker says in the list's place. */
const PICKER_NOTE = {
  NONE: "Linear lists no issues for this workspace yet.",
  NO_MATCH: "No issues match",
  READING: "Loading Linear issues",
  STARTING: "Starting the plan",
} as const;

/** The pinned row that opens the New plan dialog instead. */
const BLANK_PLAN_ROW = "blank-plan";

/** The issues as the picker reads them: still reading, read, or refused with a line. */
type IssuesRead =
  | { readonly issues: readonly LinearIssueSummary[] }
  | { readonly failed: string }
  | undefined;

/** One issue as a row: its title, then its key and the state it stands in. */
function issueRow(issue: LinearIssueSummary): MenuRow {
  return {
    id: issue.id,
    label: issue.title,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />,
    detail: issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`,
    terms: issue.state === undefined ? [issue.identifier] : [issue.identifier, issue.state],
  };
}

export function LinearIssuePicker({
  open,
  read,
  start,
  onBlankPlan,
  onClose,
  onLeave,
}: {
  open: boolean;
  /** Reads the issues the workspace's connection reaches. */
  read: () => Promise<readonly LinearIssueSummary[]>;
  /** Starts the plan from the issue picked; answers why it did not start, or nothing once it has. */
  start: (issue: LinearIssueSummary) => Promise<string | undefined>;
  /** Blank plan was pressed: the owner opens the New plan dialog. */
  onBlankPlan: () => void;
  /** Escape was pressed, or a plan started: the owner closes the picker and hands focus back. */
  onClose: () => void;
  /** Focus left the picker for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element | null {
  const drawn = useDisclosure(open);
  const menuId = useId();
  const [issues, setIssues] = useState<IssuesRead>(undefined);
  const [starting, setStarting] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // Note that the reader is held through a ref, because the sidebar hands a
  // new one on every render and a read is owed to an opening, not a render.
  const latest = useRef(read);
  latest.current = read;

  const readIssues = useCallback(() => {
    setIssues(undefined);
    setRefusal(undefined);
    latest.current().then(
      (listed) => setIssues({ issues: listed }),
      (refused: Error) => setIssues({ failed: refused.message }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    readIssues();
  }, [open, readIssues]);

  if (!drawn.mounted) return null;
  const listed = issues !== undefined && "issues" in issues ? issues.issues : [];
  const pick = (id: string) => {
    const issue = listed.find((each) => each.id === id);
    if (issue === undefined || starting) return;
    setStarting(true);
    setRefusal(undefined);
    start(issue)
      .then((note) => {
        if (note === undefined) onClose();
        else setRefusal(note);
      })
      .finally(() => setStarting(false));
  };
  const foot: FootRow[] = [
    { id: BLANK_PLAN_ROW, label: "Blank task", icon: <ComposeIcon />, onPress: onBlankPlan },
  ];
  const failed = issues !== undefined && "failed" in issues ? issues.failed : undefined;
  const note = starting ? (
    <div className="plan-compose-menu-note">
      <Spinner label={PICKER_NOTE.STARTING} />
    </div>
  ) : refusal !== undefined || failed !== undefined ? (
    <>
      <p className="plan-compose-menu-note" role="alert">
        {refusal ?? failed}
      </p>
      <button type="button" className="menu-item" onClick={readIssues}>
        <RotateCwIcon aria-hidden="true" />
        <span className="plan-compose-menu-name">Retry</span>
      </button>
    </>
  ) : issues === undefined ? (
    <div className="plan-compose-menu-note">
      <Spinner label={PICKER_NOTE.READING} />
    </div>
  ) : listed.length === 0 ? (
    <p className="plan-compose-menu-note">{PICKER_NOTE.NONE}</p>
  ) : undefined;
  // While a start is under way or refused, the note stands in the rows' place.
  const rows = starting || refusal !== undefined ? [] : listed.map(issueRow);
  return (
    <SearchableMenu
      className="linear-issue-picker"
      leaving={drawn.leaving}
      ref={drawn.ref}
      id={menuId}
      label="Start a plan from a Linear issue"
      placeholder="Search Linear issues"
      rows={rows}
      value={undefined}
      note={note}
      noMatch={PICKER_NOTE.NO_MATCH}
      onPick={pick}
      onClose={onClose}
      onLeave={onLeave}
      foot={foot}
    />
  );
}
