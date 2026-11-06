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

const KIND_WORDS = {
  [TASK_CREATE_RELATION_KIND.SUB_TASK_OF]: "Sub-task of",
  [TASK_CREATE_RELATION_KIND.PARENT_OF]: "Parent of",
  [TASK_CREATE_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_CREATE_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskCreateRelationKind, string>;

const KIND_ORDER: readonly TaskCreateRelationKind[] = [
  TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  TASK_CREATE_RELATION_KIND.PARENT_OF,
  TASK_CREATE_RELATION_KIND.BLOCKED_BY,
  TASK_CREATE_RELATION_KIND.BLOCKS,
];

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

const KIND_ROW_ID = "relation-kind";

const ROW_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.END,
];

export interface NewTaskRelation {
  readonly kind: TaskCreateRelationKind;
  readonly task: TaskSummary;
}

interface RelationPlace {
  readonly repository: string | null;
  readonly held: boolean;
}

export function treeKind(kind: TaskCreateRelationKind): boolean {
  return (
    kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF || kind === TASK_CREATE_RELATION_KIND.PARENT_OF
  );
}

export function treeRelationOf(relations: readonly NewTaskRelation[]): NewTaskRelation | undefined {
  return relations.find((relation) => treeKind(relation.kind));
}

export function relationsAsked(relations: readonly NewTaskRelation[]): TaskCreateRelation[] {
  return relations.map((relation) => ({ kind: relation.kind, taskId: relation.task.id }));
}

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

function sameRepository(one: string | null, other: string | null): boolean {
  if (one === null || other === null) return one === other;
  return one.toLowerCase() === other.toLowerCase();
}

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

function takesParentOf(relation: NewTaskRelation, kind: TaskCreateRelationKind): boolean {
  return (
    kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF &&
    relation.kind === TASK_CREATE_RELATION_KIND.SUB_TASK_OF
  );
}

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

function withKind(
  relations: readonly NewTaskRelation[],
  at: number,
  kind: TaskCreateRelationKind,
): readonly NewTaskRelation[] {
  const moved = relations[at];
  return moved === undefined ? relations : withRelation(relations, { kind, task: moved.task });
}

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

function relationRows(
  tasks: readonly TaskSummary[],
  workspaceName: string,
  relations: readonly NewTaskRelation[],
  kind: TaskCreateRelationKind,
  place: RelationPlace,
  adds: boolean,
): readonly MenuRow[] {
  const related = new Map(relations.map((each) => [each.task.id, each.kind]));
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
      replayMasked: true,
      ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
      ...(detail === undefined ? {} : { detail }),
      ...(key === undefined ? {} : { terms: [key] }),
      ...(disabled === undefined ? {} : { disabled }),
    };
  });
}

export interface NewTaskRelations {
  readonly relations: readonly NewTaskRelation[];
  readonly tasks: readonly TaskSummary[];
  readonly workspaceName: string;
  readonly repository: string | null;
  readonly disabled: boolean;
  onChange: (relations: readonly NewTaskRelation[]) => void;
}

function placeOf(control: NewTaskRelations): RelationPlace {
  return {
    repository: control.repository,
    held: treeRelationOf(control.relations) !== undefined,
  };
}

function swapPlaceOf(control: NewTaskRelations, at: number): RelationPlace {
  const left = treeRelationOf(control.relations.filter((_, index) => index !== at));
  return left === undefined
    ? { repository: null, held: false }
    : { repository: left.task.repository, held: true };
}

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
        replayUnmasked
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
          replayUnmasked
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
