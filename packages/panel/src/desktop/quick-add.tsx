import type { Failure } from "@luke/features/failure-remedy";
import { TASK_BOUNDS, type TaskStanding, type TaskSummary } from "@luke/features/task-wire";
import {
  ANNOUNCE,
  CHIP_LOOK,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  usePressAway,
} from "@luke/ui";
import { Fragment, type RefObject, useMemo, useRef, useState } from "react";
import { useMemberDirectory } from "../member-directory.js";
import type { QuickAddInto, TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { AssigneeChip, PriorityChip, StatusChip } from "./task-row-parts.js";

/**
 * quick-add.tsx -- a Tasks page group's quick add: its + opens a new task's draft at the group's top, its title written in place as a line on a plan is, and Return adds the task there with no agent, opening nothing.
 *
 * The draft is drawn as its view draws a task, a Board's card or a List's
 * row (`QuickAddLine`), so it reads as the task it is about to be: the
 * title in `InlineEdit`'s well look, bare in the type around it with no
 * ring, its muted placeholder saying what to write, as an empty line on a
 * plan does, and the chips a task's card wears for its status, priority,
 * and assignee, each changing the draft as it changes a task. The draft
 * starts where the group stands (`quickAddInto`), and keeps what its chips
 * chose from one add to the next. Return adds the task with the draft's
 * title and standing, and its repository where the group is one's, and
 * opens the draft again, empty, for the next, as Return on a plan opens the
 * next line. Escape, Return on nothing, or a press outside an empty draft
 * lets it go; the focus leaving for a chip's menu keeps it, so the title
 * ends by its keys alone.
 *
 * Note that an added task waits for the task list to carry it before its
 * card draws (`compose-tasks.ts`'s quiet start), so its name stands muted
 * under the draft meanwhile, and an add the service refused says so in its
 * place, with the name it was refused.
 */

/** What the empty draft says, and what it is called for a reader. */
const DRAFT_WORDS = {
  PLACEHOLDER: "Task title",
  LABEL: "New task title",
} as const;

/** The draft standing, which the view draws, and a menu one of its chips dropped, which stands outside it: a press on either leaves the draft standing. */
const DRAFT_SELECTOR = "[data-quick-add]";
const CHIP_MENU = '[role="menu"]';

/** What stands in an add's place where the service refused it. */
function refusedWords(name: string, refused: Failure): string {
  return `Could not add “${name}”. ${refused.text}`;
}

/** One add out, its name drawn muted until the list carries its task. */
interface PendingAdd {
  readonly id: number;
  readonly name: string;
}

/** Where the draft's task will stand, as its chips draw it: a task's own fields, so they draw it as they draw a task. */
type DraftStanding = Pick<TaskSummary, "status" | "priority" | "assignee">;

/** The group's standing as the draft starts on it, the assignee by the directory's name for them. */
function draftOf(
  into: QuickAddInto,
  nameOf: (userId: string) => string | undefined,
): DraftStanding {
  const asked = into.standing ?? {};
  const assigneeId = asked.assigneeId ?? null;
  const name = assigneeId === null ? undefined : nameOf(assigneeId);
  return {
    ...(asked.status === undefined ? undefined : { status: asked.status }),
    ...(asked.priority === undefined ? undefined : { priority: asked.priority }),
    ...(assigneeId === null || name === undefined
      ? undefined
      : { assignee: { userId: assigneeId, name } }),
  };
}

/** The standing a draft's add asks for: what its chips chose, no one assigned asked as nothing. */
function askedOf(draft: DraftStanding): TaskStanding {
  return {
    ...(draft.status === undefined ? undefined : { status: draft.status }),
    ...(draft.priority === undefined ? undefined : { priority: draft.priority }),
    ...(draft.assignee === undefined ? undefined : { assigneeId: draft.assignee.userId }),
  };
}

/** A group's quick add, held by the group: whether its draft stands, what its chips chose, the adds out, and why the last was refused. */
export interface QuickAdd {
  readonly drafting: boolean;
  /** Which draft stands, so one opened again after an add is a fresh field. */
  readonly round: number;
  readonly draft: DraftStanding;
  readonly pending: readonly PendingAdd[];
  readonly note: string | undefined;
  /** Whether anything of the quick add stands among the group's lines. */
  readonly shown: boolean;
  /** Opens the draft, as the group's + asks. */
  readonly open: () => void;
  /** How the draft's title ended. */
  readonly end: (edit: InlineEditEnd) => void;
  /** Moves the draft as one of its chips picks. */
  readonly onStanding: (standing: TaskStanding) => void;
}

/** A group's quick add into `into`, through the Tasks tab's quiet start. */
export function useQuickAdd(tasks: TasksControl, into: QuickAddInto): QuickAdd {
  const { members } = useMemberDirectory();
  const nameOf = (userId: string) => members?.find((member) => member.userId === userId)?.name;
  const [drafting, setDrafting] = useState(false);
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<DraftStanding>({});
  const [pending, setPending] = useState<readonly PendingAdd[]>([]);
  const [note, setNote] = useState<string | undefined>(undefined);
  const ids = useRef(0);
  useAnnounceShown(ANNOUNCE.ALERT, note ?? "");
  // Note that a press outside an empty draft lets it go, since the title no longer ends as the focus leaves it.
  const layer = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        return document.querySelector<HTMLElement>(DRAFT_SELECTOR);
      },
    }),
    [],
  );
  usePressAway(layer, () => undefined, {
    onPressAway: drafting
      ? () => {
          const field = layer.current?.querySelector("input");
          if ((field?.value.trim() ?? "") === "") setDrafting(false);
        }
      : undefined,
    holds: (target) => target instanceof Element && target.closest(CHIP_MENU) !== null,
  });
  const add = (name: string) => {
    ids.current += 1;
    const id = ids.current;
    setPending((out) => [...out, { id, name }]);
    setNote(undefined);
    const asked = {
      ...(into.repository === undefined ? undefined : { repository: into.repository }),
      standing: askedOf(draft),
    };
    void tasks.onQuickAdd(name, asked).then((refused) => {
      setPending((out) => out.filter((each) => each.id !== id));
      if (refused !== undefined) setNote(refusedWords(name, refused));
    });
  };
  const end = ({ value, byKey }: InlineEditEnd) => {
    if (value !== undefined) add(value);
    // Note that Return on words opens the next draft, as Return on a plan opens the next line.
    if (value !== undefined && byKey) setRound((was) => was + 1);
    else setDrafting(false);
  };
  const open = () => {
    setNote(undefined);
    if (!drafting) setDraft(draftOf(into, nameOf));
    setDrafting(true);
    setRound((was) => was + 1);
  };
  const onStanding = (standing: TaskStanding) =>
    setDraft((was) => {
      if (standing.status !== undefined) return { ...was, status: standing.status };
      if (standing.priority !== undefined) {
        return { ...was, priority: standing.priority };
      }
      const { assignee: _was, ...rest } = was;
      const id = standing.assigneeId ?? null;
      const name = id === null ? undefined : nameOf(id);
      return id === null || name === undefined ? rest : { ...rest, assignee: { userId: id, name } };
    });
  const shown = drafting || pending.length > 0 || note !== undefined;
  return { drafting, round, draft, pending, note, shown, open, end, onStanding };
}

/** The draft's own parts, each standing where its view draws a task's: its title's field, and the chips for its status, priority, and assignee. */
export interface DraftParts {
  readonly title: React.ReactNode;
  readonly status: React.ReactNode;
  readonly priority: React.ReactNode;
  readonly assignee: React.ReactNode;
}

/** How a view draws one of its quick add's lines: the draft, as its parts, an add's name while it is out, or why one was refused. */
export type QuickAddLine = (line: {
  readonly draft?: DraftParts;
  readonly pending?: string;
  readonly refused?: string;
}) => React.ReactNode;

/** A group's quick add as its first lines, each drawn as its view draws one (`line`): the draft, while it stands, the adds out under it, and why the last was refused. */
export function QuickAddLines({
  quick,
  line,
}: {
  quick: QuickAdd;
  line: QuickAddLine;
}): React.JSX.Element {
  const chip = { task: quick.draft, look: CHIP_LOOK.TOOLBAR, onStanding: quick.onStanding };
  return (
    <>
      {quick.drafting ? (
        <Fragment key="draft">
          {line({
            draft: {
              title: (
                <InlineEdit
                  key={quick.round}
                  value=""
                  label={DRAFT_WORDS.LABEL}
                  placeholder={DRAFT_WORDS.PLACEHOLDER}
                  maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                  look={INLINE_EDIT_LOOK.WELL}
                  endsOnBlur={false}
                  editing
                  onEnd={quick.end}
                />
              ),
              status: <StatusChip {...chip} />,
              priority: <PriorityChip {...chip} />,
              assignee: <AssigneeChip {...chip} />,
            },
          })}
        </Fragment>
      ) : null}
      {quick.pending.map((each) => (
        <Fragment key={each.id}>{line({ pending: each.name })}</Fragment>
      ))}
      {quick.note === undefined ? null : (
        <Fragment key="note">{line({ refused: quick.note })}</Fragment>
      )}
    </>
  );
}
