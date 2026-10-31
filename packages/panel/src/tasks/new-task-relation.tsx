import {
  TASK_CREATE_RELATION_KIND,
  type TaskCreateRelationKind,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  type FootRow,
  type MenuRow,
  POPOVER_ALIGN,
  SearchableMenu,
  TaskStatusMark,
} from "@luke/ui";
import {
  CornerDownRightIcon,
  CornerLeftUpIcon,
  GLYPH,
  HandIcon,
  NetworkIcon,
  OctagonMinusIcon,
} from "@luke/ui/icons";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useId, useRef, useState } from "react";

/**
 * new-task-relation.tsx -- New task's Relation pill: the one other task the new task starts related to, and how, read from the new task's side.
 *
 * The pill stands in New task's head row beside the repository chip, in its
 * look. With no relation it is a quiet "Relation" with the Network glyph and
 * a chevron; with one it names the kind and the other task's key ("Sub-task
 * of STAG-212"), led by the kind's icon, and ends in a × that drops it. A
 * press on either opens one searchable menu over the workspace's tasks, by
 * status mark, name, and key, a search matching the key too, with the kind
 * pinned under them as a submenu switched without losing the search, and
 * Remove relation under it while one stands; a pick sets the relation and
 * closes the menu. A task that cannot take the kind stays listed, dimmed,
 * with why: for Sub-task of and Parent of, one in another repository than
 * the card's, since a tree works in one, and for Parent of, one with a
 * parent already, which the service would refuse. A kind switched to one
 * the task picked cannot take lets that task go. The card holds the
 * relation and starts with it (`new-task-composer.tsx`); on a phone the menu
 * rises as the window's sheet, as every searchable menu does.
 */

/** Each kind as the pill and the kind submenu name it, from the new task's side. */
const KIND_WORDS = {
  [TASK_CREATE_RELATION_KIND.SUB_TASK_OF]: "Sub-task of",
  [TASK_CREATE_RELATION_KIND.PARENT_OF]: "Parent of",
  [TASK_CREATE_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_CREATE_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskCreateRelationKind, string>;

/** The kinds in the order the kind submenu stands them, as the add menu stands its own. */
const KIND_ORDER: readonly TaskCreateRelationKind[] = [
  TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  TASK_CREATE_RELATION_KIND.PARENT_OF,
  TASK_CREATE_RELATION_KIND.BLOCKED_BY,
  TASK_CREATE_RELATION_KIND.BLOCKS,
];

/** The pill's words, its menu's, and why a task cannot take a kind. */
const WORDS = {
  EMPTY: "Relation",
  MENU: "Relation",
  FIND: "Find a task",
  NO_MATCH: "No tasks match",
  REMOVE: "Remove relation",
  OTHER_REPOSITORY: "Another repository",
  HAS_PARENT: "Already has a parent",
} as const;

/** The pinned rows' ids, apart from every task's. */
const FOOT_ID = {
  KIND: "relation-kind",
  REMOVE: "relation-remove",
} as const;

/** The relation New task's card starts its task in: how it stands to the other task, and that task. */
export interface NewTaskRelation {
  readonly kind: TaskCreateRelationKind;
  readonly task: TaskSummary;
}

/** Whether a kind makes a tree, whose two tasks share one repository and the sub-task its parent's place to run. */
export function treeKind(kind: TaskCreateRelationKind): boolean {
  return (
    kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF || kind === TASK_CREATE_RELATION_KIND.PARENT_OF
  );
}

/** Each kind's icon, which leads the pill and its row in the kind submenu. */
function KindIcon({ kind }: { kind: TaskCreateRelationKind }): React.JSX.Element {
  switch (kind) {
    case TASK_CREATE_RELATION_KIND.SUB_TASK_OF:
      return <CornerDownRightIcon aria-hidden="true" />;
    case TASK_CREATE_RELATION_KIND.PARENT_OF:
      return <CornerLeftUpIcon aria-hidden="true" />;
    case TASK_CREATE_RELATION_KIND.BLOCKS:
      return <HandIcon aria-hidden="true" />;
    case TASK_CREATE_RELATION_KIND.BLOCKED_BY:
      return <OctagonMinusIcon aria-hidden="true" />;
  }
}

/** Two repositories as the service compares them: both none, or the same name in any case. */
function sameRepository(one: string | null, other: string | null): boolean {
  if (one === null || other === null) return one === other;
  return one.toLowerCase() === other.toLowerCase();
}

/** Why `other` cannot take `kind` on a card working in `repository`, none chosen judging no repository; none where it can. */
function relationWhyNot(
  other: TaskSummary,
  kind: TaskCreateRelationKind,
  repository: string | null,
): string | undefined {
  if (!treeKind(kind)) return undefined;
  if (repository !== null && !sameRepository(repository, other.repository)) {
    return WORDS.OTHER_REPOSITORY;
  }
  if (kind === TASK_CREATE_RELATION_KIND.PARENT_OF && other.parentTaskId !== undefined) {
    return WORDS.HAS_PARENT;
  }
  return undefined;
}

/** A task's key in its workspace, or its name where it has no number. */
function taskName(task: TaskSummary, workspaceName: string): string {
  return task.number === undefined ? task.name : taskKey(workspaceName, task.number);
}

/** The pill's words for a relation: the kind and the other task's key. */
function relationWords(relation: NewTaskRelation, workspaceName: string): string {
  return `${KIND_WORDS[relation.kind]} ${taskName(relation.task, workspaceName)}`;
}

/** The menu's rows for a kind: every task listed, by status mark, name, and key, each that cannot take the kind dimmed with why. */
function relationRows(
  tasks: readonly TaskSummary[],
  workspaceName: string,
  kind: TaskCreateRelationKind,
  repository: string | null,
): readonly MenuRow[] {
  return tasks.map((each) => {
    const key = each.number === undefined ? undefined : taskKey(workspaceName, each.number);
    const disabled = relationWhyNot(each, kind, repository);
    return {
      id: each.id,
      label: each.name,
      ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
      ...(key === undefined ? {} : { detail: key, terms: [key] }),
      ...(disabled === undefined ? {} : { disabled }),
    };
  });
}

/** The kind of a picked submenu row; none for a row that names none. */
function kindOf(id: string): TaskCreateRelationKind | undefined {
  return KIND_ORDER.find((kind) => kind === id);
}

export function NewTaskRelationPill({
  relation,
  tasks,
  workspaceName,
  repository,
  disabled = false,
  onChange,
}: {
  /** The relation the card starts its task in; none for a task related to none. */
  relation: NewTaskRelation | undefined;
  /** The tasks of the card's workspace, which the menu lists. */
  tasks: readonly TaskSummary[];
  /** The workspace's name, which a task's key is drawn from. */
  workspaceName: string;
  /** The repository the card's own chip chose, which a tree's other task must share; none judging none. */
  repository: string | null;
  /** Whether a start is out, which holds the pill. */
  disabled?: boolean | undefined;
  onChange: (relation: NewTaskRelation | undefined) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [kind, setKind] = useState<TaskCreateRelationKind>(
    relation?.kind ?? TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  );
  const menuId = useId();
  const room = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Note that we hand focus back to what opened the menu, as a native menu returns it to its button, because closing takes the focused field away.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const press = () => {
    if (disabled) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Each opening starts on the relation's own kind, so a kind switched and left unpicked is not kept.
    if (!open) setKind(relation?.kind ?? kind);
    setOpen(!open);
  };
  // A kind switched to one the task picked cannot take lets that task go, keeping the menu on the kind.
  const switchKind = (next: TaskCreateRelationKind) => {
    setKind(next);
    if (relation === undefined) return;
    onChange(
      relationWhyNot(relation.task, next, repository) === undefined
        ? { kind: next, task: relation.task }
        : undefined,
    );
  };
  const foot: FootRow[] = [
    {
      id: FOOT_ID.KIND,
      label: "Relation",
      icon: <KindIcon kind={kind} />,
      detail: KIND_WORDS[kind],
      submenu: {
        label: "Relation",
        rows: KIND_ORDER.map((each) => ({
          id: each,
          label: KIND_WORDS[each],
          icon: <KindIcon kind={each} />,
        })),
        value: kind,
        onPick: (picked) => switchKind(kindOf(picked) ?? kind),
        stays: true,
      },
    },
    ...(relation === undefined
      ? []
      : [
          {
            id: FOOT_ID.REMOVE,
            label: WORDS.REMOVE,
            icon: <GLYPH.CLOSE />,
            onPress: () => {
              close();
              onChange(undefined);
            },
          },
        ]),
  ];
  const byId = new Map(tasks.map((each) => [each.id, each]));
  return (
    <div className="new-task-relation relative min-w-0 max-w-full" ref={room}>
      {relation === undefined ? (
        <Chip
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          chevron
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={press}
        >
          <NetworkIcon aria-hidden="true" />
          <ChipName>{WORDS.EMPTY}</ChipName>
        </Chip>
      ) : (
        <Chip
          look={CHIP_LOOK.FIELD}
          width={CHIP_WIDTH.AUTO}
          onOpen={press}
          onRemove={() => {
            if (!disabled) onChange(undefined);
          }}
          removeLabel={WORDS.REMOVE}
        >
          <KindIcon kind={relation.kind} />
          <ChipName>{relationWords(relation, workspaceName)}</ChipName>
        </Chip>
      )}
      {drawn.mounted ? (
        <SearchableMenu
          id={menuId}
          label={WORDS.MENU}
          placeholder={WORDS.FIND}
          rows={relationRows(tasks, workspaceName, kind, repository)}
          value={relation?.kind === kind ? relation.task.id : undefined}
          noMatch={WORDS.NO_MATCH}
          foot={foot}
          align={POPOVER_ALIGN.START}
          leaving={drawn.leaving}
          ref={drawn.ref}
          onPick={(id) => {
            const task = byId.get(id);
            close();
            if (task !== undefined) onChange({ kind, task });
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && room.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
