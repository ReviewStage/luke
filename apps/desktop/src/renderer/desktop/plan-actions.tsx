import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  CopyIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  TrashIcon,
} from "@sidecar/panel";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { DOCUMENT_REGION, folderLine } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { confirmAsked } from "../settings/confirm-state";
import { Tooltip } from "../tooltip";
import {
  ActionMenu,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  type MenuPlacement,
  type OpenMenu,
} from "./action-menu";
import { PlanNameField, usePlanRename } from "./plan-name-field";

/**
 * plan-actions.tsx -- one plan's actions, offered alike from the toolbar's ⋯ button and from a right-click on the plan in the sidebar.
 *
 * Both doors open the same menu over the same plan, so a plan in the list can
 * be acted on without being opened first, and nothing in the menu moves the
 * window to another plan. The menu is the window's own (action-menu.tsx), so
 * both doors draw it the same way and Delete is drawn red.
 *
 * Rename edits the name where the door draws it: the sidebar's row turns
 * into a field, and the toolbar's ⋯ opens its title as one. Delete cannot be
 * undone, so choosing it asks first in a dialog over the window that names
 * the plan, whichever door it was chosen from.
 */

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
        label="Plan actions"
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
