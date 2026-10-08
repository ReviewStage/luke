import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { EllipsisIcon } from "@sidecar/panel";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DOCUMENT_REGION, folderLine } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { confirmAsked, type HeldConfirm, useConfirm } from "../settings/confirm-state";
import { ConfirmSwap } from "../settings/confirm-swap";

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
 * Delete cannot be undone, so choosing it asks first where the door stands —
 * the ⋯ button or the plan's row turns into the question — through the same
 * confirm every irreversible act in the panel asks through.
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
 * offers it; Delete is last and alone.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  askDelete: () => void,
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const chooseFolder = () => plans.onChooseFolder(planId);
  const groups: MenuAction[][] = [
    drawn ? [{ label: "Copy plan", onSelect: plans.copy.onPress }] : [],
    plans.folders[planId] === undefined
      ? [{ label: "Choose folder…", onSelect: chooseFolder }]
      : [
          { label: "Reveal in Finder", onSelect: () => plans.onRevealFolder(planId) },
          { label: "Change folder…", onSelect: chooseFolder },
        ],
    [{ label: "Delete plan…", onSelect: askDelete, danger: true }],
  ];
  return groups.filter((group) => group.length > 0);
}

/** The question Delete asks where its door stood. */
function deleteQuestion(deletion: HeldConfirm) {
  return {
    question: "Delete this plan? This cannot be undone.",
    stage: deletion.stage,
    verb: "Delete plan",
    running: "Deleting…",
    onKeep: deletion.keep,
    onAct: deletion.run,
  };
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
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
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
              {action.label}
            </button>
          ))}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

/** One plan's menu and its delete question, held for whichever door offers them. */
function usePlanMenu(plans: PlansControl, planId: string) {
  const deletion = useConfirm({ subject: true, surfaceOpen: true }, () =>
    plans.onDeletePlan(planId),
  );
  const [open, setOpen] = useState<OpenMenu | undefined>(undefined);
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
    open === undefined ? null : (
      <ActionMenu
        menu={open}
        groups={planActionGroups(plans, planId, deletion.ask)}
        onClose={close}
      />
    );
  return { deletion, open: open !== undefined, show, close, menu };
}

/** The open plan's ⋯ button in the toolbar, and the menu it drops. */
export function PlanActionsButton({
  plans,
  planId,
}: {
  plans: PlansControl;
  planId: string;
}): React.JSX.Element {
  const actions = usePlanMenu(plans, planId);
  const { deletion } = actions;
  return (
    <>
      {deletion.rejection ? (
        <p className="desktop-toolbar-note" role="alert">
          {deletion.rejection}
        </p>
      ) : null}
      {/* The question is mounted only while it is asked, so the toolbar keeps
          no room for an answer nobody has asked for beside the ⋯. */}
      <ConfirmSwap {...(confirmAsked(deletion.stage) ? { confirm: deleteQuestion(deletion) } : {})}>
        <button
          type="button"
          className="toolbar-button toolbar-icon-button"
          aria-label="Plan actions"
          title="Plan actions"
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
      </ConfirmSwap>
      {actions.menu}
    </>
  );
}

/** A plan in the sidebar: a press opens it, and a right-click offers its actions where the pointer is. */
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
  const actions = usePlanMenu(plans, plan.id);
  const { deletion } = actions;
  const folderPath = plans.folders[plan.id];
  return (
    <li>
      <ConfirmSwap confirm={deleteQuestion(deletion)}>
        <button
          type="button"
          className="sidebar-plan"
          aria-current={current ? "page" : undefined}
          data-menu-open={String(actions.open)}
          disabled={deletion.busy}
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
          {folderPath !== undefined ? (
            <span className="sidebar-plan-repository">{folderLine(folderPath)}</span>
          ) : null}
        </button>
      </ConfirmSwap>
      {deletion.rejection ? (
        <p className="sidebar-note" role="alert">
          {deletion.rejection}
        </p>
      ) : null}
      {actions.menu}
    </li>
  );
}
