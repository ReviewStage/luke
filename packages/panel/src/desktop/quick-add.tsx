import type { Failure } from "@repo/features/failure-remedy";
import { TASK_BOUNDS, type TaskStanding, type TaskSummary } from "@repo/features/task-wire";
import {
  ANNOUNCE,
  CHIP_LOOK,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  usePressAway,
} from "@repo/ui";
import { Fragment, type RefObject, useMemo, useRef, useState } from "react";
import { useMemberDirectory } from "../member-directory.js";
import type { QuickAddInto, TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { AssigneeChip, PriorityChip, StatusChip } from "./task-row-parts.js";

const DRAFT_WORDS = {
  PLACEHOLDER: "Task title",
  LABEL: "New task title",
} as const;

const DRAFT_SELECTOR = "[data-quick-add]";
const CHIP_MENU = '[role="menu"]';

function refusedWords(name: string, refused: Failure): string {
  return `Could not add “${name}”. ${refused.text}`;
}

interface PendingAdd {
  readonly id: number;
  readonly name: string;
}

type DraftStanding = Pick<TaskSummary, "status" | "priority" | "assignee">;

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

function askedOf(draft: DraftStanding): TaskStanding {
  return {
    ...(draft.status === undefined ? undefined : { status: draft.status }),
    ...(draft.priority === undefined ? undefined : { priority: draft.priority }),
    ...(draft.assignee === undefined ? undefined : { assigneeId: draft.assignee.userId }),
  };
}

export interface QuickAdd {
  readonly drafting: boolean;
  readonly round: number;
  readonly draft: DraftStanding;
  readonly pending: readonly PendingAdd[];
  readonly note: string | undefined;
  readonly shown: boolean;
  readonly open: () => void;
  readonly end: (edit: InlineEditEnd) => void;
  readonly onStanding: (standing: TaskStanding) => void;
}

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

export interface DraftParts {
  readonly title: React.ReactNode;
  readonly status: React.ReactNode;
  readonly priority: React.ReactNode;
  readonly assignee: React.ReactNode;
}

export type QuickAddLine = (line: {
  readonly draft?: DraftParts;
  readonly pending?: string;
  readonly refused?: string;
}) => React.ReactNode;

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
