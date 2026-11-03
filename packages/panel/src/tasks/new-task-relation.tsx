import {
  TASK_BOUNDS,
  TASK_CREATE_RELATION_KIND,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import {
  BUTTON_SIZE,
  type FootRow,
  IconButton,
  type MenuPanel,
  type MenuRow,
  POPOVER_ALIGN,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
  TaskRows,
  TaskStatusMark,
  VisuallyHidden,
} from "@repo/ui";
import { CornerLeftUpIcon, GLYPH, HandIcon, NetworkIcon, OctagonMinusIcon } from "@repo/ui/icons";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useState } from "react";
import { RelationKindPill } from "./relation-kind-pill.js";
import { TASK_RELATION_MENU } from "./task-relation-menu.js";
import { TASK_STATUS_WORDS, TaskKey } from "./task-standing.js";

/**
 * new-task-relation.tsx -- New task's relations: the other tasks the new task starts related to, and how, read from the new task's side, picked from the + menu and drawn as rows over the card.
 *
 * The card's + menu ends in Task relation (`relationMenuPanel`), which hangs
 * the task search beside the menu as its panel: the workspace's tasks by
 * status mark, name, and key, a search matching the key too, with the kind
 * pinned at its foot as a submenu switched without losing the search. A pick
 * relates the task as the kind standing there and closes the menu. A task
 * takes one relation, so picking one already related changes its kind, its
 * row in the search naming that kind in its key's place; a task has one
 * parent, so a second Sub-task of replaces the first; and a card takes at
 * most `TASK_BOUNDS.MAX_START_RELATIONS`, past which the rest are dimmed. A
 * task that cannot take the kind stays listed, dimmed, with why: for Sub-task
 * of and Parent of, one in another repository than the card's, since a tree
 * works in one, and once a tree relation stands the card's repository is held
 * to its task's, so every tree relation shares it, as the service asks; and
 * for Parent of, one with a parent already, which the service would refuse.
 *
 * Each relation stands as a row docked over the card (`NewTaskRelationRows`),
 * the plan's own task row with no room at its edges, reading as a sentence:
 * the kind as a compact pill that drops the kinds and Remove relation
 * (`relation-kind-pill.tsx`), the task's key, its status mark, its name, and
 * a × that takes the row off. Pressing the name opens the task search under
 * the row to swap its task, keeping its kind. The card holds the relations
 * and starts with them all (`new-task-composer.tsx`).
 */

/** Each kind as the rows, the kind submenu, and the search name it, from the new task's side. */
const KIND_WORDS = {
  [TASK_CREATE_RELATION_KIND.SUB_TASK_OF]: "Sub-task of",
  [TASK_CREATE_RELATION_KIND.PARENT_OF]: "Parent of",
  [TASK_CREATE_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_CREATE_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskCreateRelationKind, string>;

/** The kinds in the order the kind submenu and a row's pill stand them, as the add menu stands its own. */
const KIND_ORDER: readonly TaskCreateRelationKind[] = [
  TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  TASK_CREATE_RELATION_KIND.PARENT_OF,
  TASK_CREATE_RELATION_KIND.BLOCKED_BY,
  TASK_CREATE_RELATION_KIND.BLOCKS,
];

/** The menu's words, the rows', and why a task cannot take a kind. */
const WORDS = {
  MENU: TASK_RELATION_MENU,
  KIND: "Relation",
  FIND: "Find a task",
  NO_MATCH: "No tasks match",
  ROWS: "Related tasks",
  REMOVE: "Remove relation",
  SWAP: "Swap task",
  OTHER_REPOSITORY: "Another repository",
  HAS_PARENT: "Already has a parent",
  FULL: `At most ${TASK_BOUNDS.MAX_START_RELATIONS} relations`,
} as const;

/** The pinned row's id, apart from every task's. */
const KIND_ROW_ID = "relation-kind";

/** The cells a relation's row draws: the kind, the task's key, its status, its name, and its ×. */
const ROW_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.END,
];

/** A relation New task's card starts its task in: how it stands to the other task, and that task. */
export interface NewTaskRelation {
  readonly kind: TaskCreateRelationKind;
  readonly task: TaskSummary;
}

/** The repository a card's tree relations are judged against: the card's, and whether a tree relation already holds it. */
interface RelationPlace {
  /** The repository the card's chip chose, or a tree relation's task's; none chosen. */
  readonly repository: string | null;
  /** Whether a tree relation stands, which holds every other to its task's repository, none among them. */
  readonly held: boolean;
}

/** Whether a kind makes a tree, whose two tasks share one repository and the sub-task its parent's place to run. */
export function treeKind(kind: TaskCreateRelationKind): boolean {
  return (
    kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF || kind === TASK_CREATE_RELATION_KIND.PARENT_OF
  );
}

/** The card's first tree relation, whose task's repository every tree relation shares; none where none stands. */
export function treeRelationOf(relations: readonly NewTaskRelation[]): NewTaskRelation | undefined {
  return relations.find((relation) => treeKind(relation.kind));
}

/** What a start names of the card's relations: each kind and the other task's id. */
export function relationsAsked(relations: readonly NewTaskRelation[]): TaskCreateRelation[] {
  return relations.map((relation) => ({ kind: relation.kind, taskId: relation.task.id }));
}

/**
 * Each kind's icon, the plan's for the same relationship: the up-arrow where
 * the other task is the parent (Sub-task of), the sub-task glyph where it is
 * a sub-task (Parent of).
 */
function kindIcon(kind: TaskCreateRelationKind): React.JSX.Element {
  switch (kind) {
    case TASK_CREATE_RELATION_KIND.SUB_TASK_OF:
      return <CornerLeftUpIcon aria-hidden="true" />;
    case TASK_CREATE_RELATION_KIND.PARENT_OF:
      return <GLYPH.SUB_TASK />;
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

/** Why `other` cannot take `kind` on a card standing at `place`, none chosen and none held judging no repository; none where it can. */
function relationWhyNot(
  other: TaskSummary,
  kind: TaskCreateRelationKind,
  place: RelationPlace,
): string | undefined {
  if (!treeKind(kind)) return undefined;
  const judged = place.held || place.repository !== null;
  if (judged && !sameRepository(place.repository, other.repository)) {
    return WORDS.OTHER_REPOSITORY;
  }
  if (kind === TASK_CREATE_RELATION_KIND.PARENT_OF && other.parentTaskId !== undefined) {
    return WORDS.HAS_PARENT;
  }
  return undefined;
}

/** Whether a relation would take the card's one parent's place: a Sub-task of beside another. */
function takesParentOf(relation: NewTaskRelation, kind: TaskCreateRelationKind): boolean {
  return (
    kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF &&
    relation.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF
  );
}

/**
 * The relations with `next` set in its place: the task's own relation where
 * it has one, else the card's parent where `next` is a second Sub-task of,
 * else added at the end, unless the card holds its most already; any other
 * relation to the same task, or second parent, let go.
 */
function withRelation(
  relations: readonly NewTaskRelation[],
  next: NewTaskRelation,
): readonly NewTaskRelation[] {
  const sameTask = relations.findIndex((each) => each.task.id === next.task.id);
  const at =
    sameTask === -1 ? relations.findIndex((each) => takesParentOf(each, next.kind)) : sameTask;
  if (at === -1) {
    return relations.length < TASK_BOUNDS.MAX_START_RELATIONS ? [...relations, next] : relations;
  }
  return relations.flatMap((each, index) => {
    if (index === at) return [next];
    if (each.task.id === next.task.id || takesParentOf(each, next.kind)) return [];
    return [each];
  });
}

/** The relations with the one at `at` moved to `kind`, any other parent let go where it moves to Sub-task of. */
function withKind(
  relations: readonly NewTaskRelation[],
  at: number,
  kind: TaskCreateRelationKind,
): readonly NewTaskRelation[] {
  const moved = relations[at];
  return moved === undefined ? relations : withRelation(relations, { kind, task: moved.task });
}

/** The relations with the one at `at` relating `task` instead, its kind kept, any other relation to `task` let go. */
function withTask(
  relations: readonly NewTaskRelation[],
  at: number,
  task: TaskSummary,
): readonly NewTaskRelation[] {
  return relations.flatMap((each, index) => {
    if (index === at) return [{ kind: each.kind, task }];
    return each.task.id === task.id ? [] : [each];
  });
}

/**
 * The search's rows for a kind: every task listed, by status mark, name, and
 * key, a related task naming its relation's kind in its key's place, each that
 * cannot take the kind dimmed with why, and every unrelated one dimmed once
 * the card holds its most.
 */
function relationRows(
  tasks: readonly TaskSummary[],
  workspaceName: string,
  relations: readonly NewTaskRelation[],
  kind: TaskCreateRelationKind,
  place: RelationPlace,
  adds: boolean,
): readonly MenuRow[] {
  const related = new Map(relations.map((each) => [each.task.id, each.kind]));
  // Note that a Sub-task of beside the card's parent takes its place rather than adding one, so the card's most never holds it.
  const replacesParent = relations.some((each) => takesParentOf(each, kind));
  const full = adds && !replacesParent && relations.length >= TASK_BOUNDS.MAX_START_RELATIONS;
  return tasks.map((each) => {
    const key = each.number === undefined ? undefined : taskKey(workspaceName, each.number);
    const standing = related.get(each.id);
    const detail = standing === undefined ? key : KIND_WORDS[standing];
    const disabled =
      full && standing === undefined ? WORDS.FULL : relationWhyNot(each, kind, place);
    return {
      id: each.id,
      label: each.name,
      ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
      ...(detail === undefined ? {} : { detail }),
      ...(key === undefined ? {} : { terms: [key] }),
      ...(disabled === undefined ? {} : { disabled }),
    };
  });
}

/** What the card hands its relations' search, its panel, and its rows. */
export interface NewTaskRelations {
  /** The relations the card starts its task in, in the order they were picked. */
  readonly relations: readonly NewTaskRelation[];
  /** The tasks of the card's workspace, which the search lists. */
  readonly tasks: readonly TaskSummary[];
  /** The workspace's name, which a task's key is drawn from. */
  readonly workspaceName: string;
  /** The repository the card's chip chose, held to a tree relation's task's where one stands; none chosen. */
  readonly repository: string | null;
  /** Whether a start is out, which holds the rows. */
  readonly disabled: boolean;
  onChange: (relations: readonly NewTaskRelation[]) => void;
}

/** Where the card's tree relations are judged from. */
function placeOf(control: NewTaskRelations): RelationPlace {
  return {
    repository: control.repository,
    held: treeRelationOf(control.relations) !== undefined,
  };
}

/**
 * Where a swap of the relation at `at` is judged from: the tree relations
 * left beside it, whose repository holds it; none left, no repository, since
 * the one swapped held the chip and the task it takes sets it afresh.
 */
function swapPlaceOf(control: NewTaskRelations, at: number): RelationPlace {
  const left = treeRelationOf(control.relations.filter((_, index) => index !== at));
  return left === undefined
    ? { repository: null, held: false }
    : { repository: left.task.repository, held: true };
}

/**
 * The + menu's Task relation: the task search hung beside the menu as its
 * panel, the kind standing at its foot, which the card keeps from one opening
 * to the next; a pick relates the task as that kind and closes the menu, and
 * Escape goes back to the menu.
 */
export function relationMenuPanel(
  id: string,
  control: NewTaskRelations,
  kind: TaskCreateRelationKind,
  onKind: (kind: TaskCreateRelationKind) => void,
): MenuPanel {
  const place = placeOf(control);
  const byId = new Map(control.tasks.map((each) => [each.id, each]));
  const foot: readonly FootRow[] = [
    {
      id: KIND_ROW_ID,
      label: WORDS.KIND,
      icon: kindIcon(kind),
      detail: KIND_WORDS[kind],
      submenu: {
        label: WORDS.KIND,
        rows: KIND_ORDER.map((each) => ({
          id: each,
          label: KIND_WORDS[each],
          icon: kindIcon(each),
        })),
        value: kind,
        onPick: (picked) => onKind(KIND_ORDER.find((each) => each === picked) ?? kind),
        stays: true,
      },
    },
  ];
  return {
    label: WORDS.MENU,
    icon: <NetworkIcon />,
    panel: ({ back, close }) => (
      <SearchableMenu
        layer={SEARCHABLE_MENU_LAYER.EMBEDDED}
        id={id}
        label={WORDS.MENU}
        placeholder={WORDS.FIND}
        rows={relationRows(
          control.tasks,
          control.workspaceName,
          control.relations,
          kind,
          place,
          true,
        )}
        value={undefined}
        noMatch={WORDS.NO_MATCH}
        foot={foot}
        onPick={(id) => {
          const task = byId.get(id);
          close();
          if (task !== undefined) control.onChange(withRelation(control.relations, { kind, task }));
        }}
        onClose={back}
        onLeave={() => undefined}
      />
    ),
  };
}

/** One relation's row: its kind's pill, the task's key and status, its name, which opens the search that swaps it, and its ×. */
function RelationRow({
  control,
  relation,
  at,
}: {
  control: NewTaskRelations;
  relation: NewTaskRelation;
  at: number;
}): React.JSX.Element {
  const { relations, workspaceName, disabled, onChange } = control;
  const { kind, task } = relation;
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const place = placeOf(control);
  const byId = new Map(control.tasks.map((each) => [each.id, each]));
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  const spoken = [key, task.status === undefined ? undefined : TASK_STATUS_WORDS[task.status]]
    .filter((each) => each !== undefined)
    .map((each) => `, ${each}`)
    .join("");
  return (
    <TaskRow
      taskId={task.id}
      name={task.name}
      said={spoken === "" ? undefined : <VisuallyHidden>{spoken}</VisuallyHidden>}
      cells={ROW_CELLS}
      edges={TASK_ROW_EDGES.BARE}
      disabled={disabled}
      onOpen={() => setOpen(!open)}
      content={{
        [TASK_ROW_CELL.RELATION]: (
          <RelationKindPill
            kind={kind}
            kinds={KIND_ORDER}
            words={KIND_WORDS}
            icon={kindIcon}
            why={(each) => relationWhyNot(task, each, place)}
            disabled={disabled}
            onChange={(to) => onChange(withKind(relations, at, to))}
            onRemove={() => onChange(relations.filter((_, index) => index !== at))}
          />
        ),
        [TASK_ROW_CELL.KEY]: (
          <TaskKey workspaceName={workspaceName} number={task.number} decorative />
        ),
        [TASK_ROW_CELL.STATUS]:
          task.status === undefined ? null : <TaskStatusMark status={task.status} />,
        [TASK_ROW_CELL.END]: (
          <IconButton
            icon={<GLYPH.CLOSE />}
            label={WORDS.REMOVE}
            size={BUTTON_SIZE.COMPACT}
            disabled={disabled}
            onClick={() => onChange(relations.filter((_, index) => index !== at))}
          />
        ),
      }}
    >
      {drawn.mounted ? (
        <SearchableMenu
          id={menuId}
          label={WORDS.SWAP}
          placeholder={WORDS.FIND}
          rows={relationRows(
            control.tasks,
            workspaceName,
            relations,
            kind,
            swapPlaceOf(control, at),
            false,
          )}
          value={task.id}
          noMatch={WORDS.NO_MATCH}
          align={POPOVER_ALIGN.START}
          leaving={drawn.leaving}
          ref={drawn.ref}
          onPick={(id) => {
            const picked = byId.get(id);
            setOpen(false);
            if (picked !== undefined && picked.id !== task.id) {
              onChange(withTask(relations, at, picked));
            }
          }}
          onClose={() => setOpen(false)}
          onLeave={(left) => {
            const row = left instanceof Element ? left.closest("[data-task-id]") : null;
            if (row?.getAttribute("data-task-id") !== task.id) setOpen(false);
          }}
        />
      ) : null}
    </TaskRow>
  );
}

/** The card's relations as rows docked over it, edge to edge with no room at their ends; nothing while it holds none. */
export function NewTaskRelationRows({
  control,
}: {
  control: NewTaskRelations;
}): React.JSX.Element | null {
  if (control.relations.length === 0) return null;
  return (
    <TaskRows label={WORDS.ROWS} cells={ROW_CELLS} more={false} edges={TASK_ROW_EDGES.BARE}>
      {control.relations.map((relation, at) => (
        <RelationRow key={relation.task.id} control={control} relation={relation} at={at} />
      ))}
    </TaskRows>
  );
}
