import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  CopyIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  TrashIcon,
} from "@sidecar/panel";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { DOCUMENT_REGION, folderLine } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { confirmAsked } from "../settings/confirm-state";
import { Tooltip } from "../tooltip";
import { PlanNameField, usePlanRename } from "./plan-name-field";

/**
 * plan-actions.tsx -- one plan's actions, offered alike from the toolbar's ⋯ button and from a right-click on the plan in the sidebar.
 *
 * Both doors open the same menu over the same plan, so a plan in the list can
 * be acted on without being opened first, and nothing in the menu moves the
 * window to another plan. The menu is drawn here rather than asked of the
 * system so that both doors draw it the same way and Delete can be drawn red.
 * It behaves as a system menu does: focus on its first item, the arrow keys
 * between items, and Escape, Tab, a press elsewhere, or the window losing the
 * keyboard closing it with focus back where it was.
 *
 * Rename edits the name where the door draws it: the sidebar's row turns
 * into a field, and the toolbar's ⋯ opens its title as one. Delete cannot be
 * undone, so choosing it asks first in a dialog over the window that names
 * the plan, whichever door it was chosen from.
 */

/** Which way from the point it hangs at a menu grows: rightward from it, or leftward to it. */
const MENU_ALIGN = {
  START: "start",
  END: "end",
} as const;

type MenuAlign = (typeof MENU_ALIGN)[keyof typeof MENU_ALIGN];

/** The gap a menu keeps from the window's edges, in CSS pixels. */
const MENU_MARGIN = 8;
/** The gap between the ⋯ button and the menu dropped from it. */
const MENU_DROP = 4;
const MENU_ITEM = '[role="menuitem"]';

/** Where a menu hangs: a point in the window, and which way from it the menu grows. */
interface MenuPlacement {
  x: number;
  y: number;
  align: MenuAlign;
}

interface MenuAction {
  label: string;
  /** The glyph leading the label, drawn in a column every item keeps whether or not it has one. */
  icon?: React.JSX.Element;
  onSelect: () => void;
  /** Drawn red: the action cannot be taken back. */
  danger?: boolean;
}

/** A menu standing open: where it hangs, and the control that opened it, which takes focus back. */
interface OpenMenu {
  placement: MenuPlacement;
  opener: HTMLElement;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The item a navigation key moves to from the focused one, or nothing for any other key. */
function itemAfter(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowUp":
      return (at <= 0 ? count : at) - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * One plan's actions in the groups a rule divides, offering only those that
 * apply to it now. Copy formats the document drawn, so only the open plan
 * offers it, ahead of Rename; Delete is last and alone.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  doors: { rename: () => void; askDelete: () => void },
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const chooseFolder = () => plans.onChooseFolder(planId);
  const rename: MenuAction = { label: "Rename", icon: <PencilIcon />, onSelect: doors.rename };
  const groups: MenuAction[][] = [
    drawn
      ? [{ label: "Copy plan", icon: <CopyIcon />, onSelect: plans.copy.onPress }, rename]
      : [rename],
    plans.folders[planId] === undefined
      ? [{ label: "Choose folder", icon: <FolderIcon />, onSelect: chooseFolder }]
      : [
          {
            label: "Reveal in Finder",
            icon: <FolderOpenIcon />,
            onSelect: () => plans.onRevealFolder(planId),
          },
          { label: "Change folder", icon: <FolderIcon />, onSelect: chooseFolder },
        ],
    [{ label: "Delete plan", icon: <TrashIcon />, onSelect: doors.askDelete, danger: true }],
  ];
  return groups.filter((group) => group.length > 0);
}

/**
 * The question Delete asks, naming the plan. Deleting a plan removes its
 * document and its board and clears the conversation its transcript is read
 * from, which nothing in the app brings back.
 */
function deleteQuestion(name: string): DialogQuestion {
  return {
    title: "Delete plan?",
    body: `“${name}” will be permanently deleted, along with its board and transcript. This can’t be undone.`,
    verb: "Delete",
    running: "Deleting…",
  };
}

/**
 * Whether the plan is still there to delete: in the list, or drawn as the
 * open plan while the list has yet to catch up with it.
 */
function planStands(plans: PlansControl, planId: string): boolean {
  const { region } = plans;
  if (region.kind === DOCUMENT_REGION.READY && region.plan.id === planId) return true;
  return plans.plans.some((plan) => plan.id === planId);
}

/**
 * The menu itself, drawn over the window at the point it hangs from. It is
 * measured before it is painted, so it is drawn once and where it fits.
 */
function ActionMenu({
  menu,
  groups,
  onClose,
}: {
  menu: OpenMenu;
  groups: readonly (readonly MenuAction[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { placement, opener } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn === null) return;
    const { width, height } = drawn.getBoundingClientRect();
    const left = placement.align === MENU_ALIGN.END ? placement.x - width : placement.x;
    setAt({
      left: clamp(left, MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      top: clamp(placement.y, MENU_MARGIN, window.innerHeight - height - MENU_MARGIN),
    });
  }, [placement]);

  const placed = at !== undefined;
  useEffect(() => {
    if (placed) element.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [placed]);

  // Note that a press on the opener is left to the opener, because the ⋯
  // button's own press is what closes the menu it opened.
  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (element.current?.contains(target) || opener.contains(target)) return;
      onClose(false);
    };
    const leave = () => onClose(false);
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", leave);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
    };
  }, [onClose, opener]);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The menu is the nearest open layer, so Escape closes it alone and
    // leaves the plan behind it open.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    // Note that Tab hands focus back before the browser moves it, because
    // the browser's own move then goes on from the opener to its neighbour.
    if (event.key === "Tab") {
      onClose(true);
      return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
    const next = itemAfter(
      event.key,
      items.findIndex((item) => item.matches(":focus")),
      items.length,
    );
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={element}
      className="plan-menu"
      role="menu"
      aria-label="Plan actions"
      data-placed={String(placed)}
      style={at ?? { left: placement.x, top: placement.y }}
      onKeyDown={keyDown}
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.label}>
          {index > 0 ? <hr className="plan-menu-rule" /> : null}
          {group.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="plan-menu-item"
              data-danger={action.danger ? "true" : undefined}
              onClick={() => {
                onClose(true);
                action.onSelect();
              }}
            >
              <span className="plan-menu-icon">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

/**
 * One plan's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, and the question does not
 * outlive the plan: each is taken down in the render that finds it gone, so
 * neither is left standing over another surface, over a plan deleted
 * elsewhere, or waiting for the next time the panel opens.
 */
function usePlanMenu(plans: PlansControl, planId: string, name: string, rename: () => void) {
  const deletion = useConfirmDialog(
    { subject: planStands(plans, planId), surfaceOpen: plans.shown },
    () => plans.onDeletePlan(planId),
  );
  const [open, setOpen] = useState<OpenMenu | undefined>(undefined);
  if (open !== undefined && !plans.shown) setOpen(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(undefined);
    if (returnFocus) opener.current?.focus();
  }, []);
  const show = (placement: MenuPlacement, element: HTMLElement) => {
    opener.current = element;
    setOpen({ placement, opener: element });
  };
  const menu =
    open === undefined || !plans.shown ? null : (
      <ActionMenu
        menu={open}
        groups={planActionGroups(plans, planId, { rename, askDelete: deletion.ask })}
        onClose={close}
      />
    );
  const dialog = <ConfirmDialog confirm={deletion} question={deleteQuestion(name)} />;
  return { deletion, open: open !== undefined, show, close, menu, dialog };
}

/**
 * The open plan's ⋯ button in the toolbar, and the menu it drops. It is also
 * what offers the open plan's Delete and Reveal shortcuts, so each asks or
 * acts exactly as its menu item would: Delete still asks first.
 */
export function PlanActionsButton({
  plans,
  plan,
  onRename,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Opens the toolbar's title as the plan's name field. */
  onRename: () => void;
}): React.JSX.Element {
  const actions = usePlanMenu(plans, plan.id, plan.name, onRename);
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_PLAN, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(
    APP_COMMAND.REVEAL_FOLDER,
    plans.folders[plan.id] === undefined ? undefined : () => plans.onRevealFolder(plan.id),
  );
  return (
    <>
      <Tooltip label="Plan actions">
        <button
          type="button"
          className="toolbar-button toolbar-icon-button"
          aria-label="Plan actions"
          aria-haspopup="menu"
          aria-expanded={actions.open}
          disabled={deletion.busy}
          onClick={(event) => {
            if (actions.open) {
              actions.close(true);
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            actions.show(
              { x: bounds.right, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.END },
              event.currentTarget,
            );
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
      {actions.menu}
      {actions.dialog}
    </>
  );
}

/**
 * A plan in the sidebar: a press opens it, and a right-click offers its
 * actions where the pointer is. Renamed, the row is its name's field until
 * the edit ends, and a key that ends it hands focus back to the row.
 */
export function SidebarPlan({
  plans,
  plan,
  current,
  onOpen,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether this is the plan the work column is showing. */
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = usePlanRename(plan.id, plans.onRenamePlan);
  const actions = usePlanMenu(plans, plan.id, plan.name, rename.begin);
  const folderPath = plans.folders[plan.id];
  const row = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  const repository =
    folderPath !== undefined ? (
      <span className="sidebar-plan-repository">{folderLine(folderPath)}</span>
    ) : null;
  return (
    <li>
      {rename.editing ? (
        <div className="sidebar-plan" aria-current={current ? "page" : undefined}>
          <PlanNameField
            name={plan.name}
            className="sidebar-plan-field"
            onEnd={(edit) => {
              refocus.current = edit.byKey;
              rename.end(edit);
            }}
          />
          {repository}
        </div>
      ) : (
        <button
          ref={row}
          type="button"
          className="sidebar-plan"
          aria-current={current ? "page" : undefined}
          data-menu-open={String(actions.open)}
          disabled={actions.deletion.busy}
          onClick={() => {
            actions.close(false);
            onOpen();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            actions.show(
              { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START },
              event.currentTarget,
            );
          }}
        >
          <span className="sidebar-plan-name">{plan.name}</span>
          {repository}
        </button>
      )}
      {rename.note !== undefined ? (
        <p className="sidebar-note" role="alert">
          {rename.note}
        </p>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </li>
  );
}
