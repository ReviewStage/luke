import { ISSUE_PRIORITY_WORDS, ISSUE_STATUS_WORDS } from "@luke/features/issue-list-model";
import {
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  ISSUE_STATUS_ORDER,
  type IssuePriority,
  type IssueStatus,
} from "@luke/features/issue-wire";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CircleXIcon,
  EllipsisIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
} from "lucide-react";
import type { MenuRow } from "../searchable-menu";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { GLYPH_STATE, StateGlyph } from "../state-glyph";

/**
 * issue-pickers.tsx -- an issue's status and priority as glyphs, and the two chips that change them.
 *
 * A status wears its glyph wherever it is drawn, a row of the list, a
 * group's heading, and the detail's chip alike; a priority its mark, an
 * unweighed issue none in the list and a dash on its chip. Each chip drops
 * the window's own menu (`picker-row.tsx`), short enough to read whole, and
 * a pick is handed back for the page to send.
 */

/** Each status's glyph. */
const STATUS_GLYPH = {
  [ISSUE_STATUS.BACKLOG]: <CircleDashedIcon />,
  [ISSUE_STATUS.TODO]: <CircleIcon />,
  [ISSUE_STATUS.IN_PROGRESS]: <CircleDotIcon />,
  [ISSUE_STATUS.DONE]: <CircleCheckIcon />,
  [ISSUE_STATUS.CANCELED]: <CircleXIcon />,
} as const satisfies Record<IssueStatus, React.ReactNode>;

/** Each priority's mark; an unweighed issue wears none in the list. */
const PRIORITY_GLYPH = {
  [ISSUE_PRIORITY.NONE]: null,
  [ISSUE_PRIORITY.URGENT]: <CircleAlertIcon />,
  [ISSUE_PRIORITY.HIGH]: <SignalHighIcon />,
  [ISSUE_PRIORITY.MEDIUM]: <SignalMediumIcon />,
  [ISSUE_PRIORITY.LOW]: <SignalLowIcon />,
} as const satisfies Record<IssuePriority, React.ReactNode>;

/** The priorities as the menu lists them, the most pressing first and the unweighed last. */
const PRIORITY_ORDER: readonly IssuePriority[] = [
  ISSUE_PRIORITY.URGENT,
  ISSUE_PRIORITY.HIGH,
  ISSUE_PRIORITY.MEDIUM,
  ISSUE_PRIORITY.LOW,
  ISSUE_PRIORITY.NONE,
];

/** A status's glyph, coloured by the status it stands for. */
export function StatusGlyph({ status }: { status: IssueStatus }): React.JSX.Element {
  return (
    <span className="issue-status-glyph" data-status={status}>
      <StateGlyph glyph={STATUS_GLYPH[status]} state={GLYPH_STATE.REST} />
    </span>
  );
}

/** A priority's mark where an issue is listed, a row's or a card's, its words for a reader who cannot see it; none where the issue is unweighed. */
export function PriorityMark({ priority }: { priority: IssuePriority }): React.JSX.Element | null {
  const glyph = PRIORITY_GLYPH[priority];
  if (glyph === null) return null;
  const words = ISSUE_PRIORITY_WORDS[priority];
  return (
    <span className="issue-priority-mark" data-priority={priority} title={words}>
      {glyph}
      <span className="visually-hidden">{words}</span>
    </span>
  );
}

/** A priority's mark on its chip and in its menu: a dash where the issue is unweighed. */
function PriorityGlyph({ priority }: { priority: IssuePriority }): React.JSX.Element {
  return (
    <span className="issue-priority-mark" data-priority={priority}>
      {PRIORITY_GLYPH[priority] ?? <EllipsisIcon />}
    </span>
  );
}

const STATUS_ROWS: readonly MenuRow[] = ISSUE_STATUS_ORDER.map((status) => ({
  id: status,
  label: ISSUE_STATUS_WORDS[status],
  icon: <StatusGlyph status={status} />,
}));

const PRIORITY_ROWS: readonly MenuRow[] = PRIORITY_ORDER.map((priority) => ({
  id: priority,
  label: ISSUE_PRIORITY_WORDS[priority],
  icon: <PriorityGlyph priority={priority} />,
}));

/** Whether a picked row names a status. */
function isStatus(id: string): id is IssueStatus {
  return ISSUE_STATUS_ORDER.some((status) => status === id);
}

/** Whether a picked row names a priority. */
function isPriority(id: string): id is IssuePriority {
  return PRIORITY_ORDER.some((priority) => priority === id);
}

/** The chip naming where an issue stands, and the menu that moves it. */
export function StatusMenu({
  status,
  disabled,
  onPick,
}: {
  status: IssueStatus;
  /** Whether the chip takes no pick now, as while what it picks for is being sent. */
  disabled?: boolean | undefined;
  onPick: (status: IssueStatus) => void;
}): React.JSX.Element {
  return (
    <Picker
      label="Status"
      value={status}
      valueLabel={ISSUE_STATUS_WORDS[status]}
      valueIcon={<StatusGlyph status={status} />}
      rows={STATUS_ROWS}
      noMatch="No such status"
      align={PICKER_ALIGN.START}
      disabled={disabled}
      onPick={(id) => {
        if (isStatus(id) && id !== status) onPick(id);
      }}
    />
  );
}

/** The chip naming how much an issue matters, and the menu that weighs it. */
export function PriorityMenu({
  priority,
  disabled,
  onPick,
}: {
  priority: IssuePriority;
  /** Whether the chip takes no pick now, as while what it picks for is being sent. */
  disabled?: boolean | undefined;
  onPick: (priority: IssuePriority) => void;
}): React.JSX.Element {
  return (
    <Picker
      label="Priority"
      value={priority}
      valueLabel={ISSUE_PRIORITY_WORDS[priority]}
      valueIcon={<PriorityGlyph priority={priority} />}
      rows={PRIORITY_ROWS}
      noMatch="No such priority"
      align={PICKER_ALIGN.START}
      disabled={disabled}
      onPick={(id) => {
        if (isPriority(id) && id !== priority) onPick(id);
      }}
    />
  );
}
