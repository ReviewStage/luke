import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalIcon,
  PencilIcon,
  PinIcon,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
} from "@sidecar/panel";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { useAppCommand } from "../app-commands";
import { DOCUMENT_REGION, PLAN_MARK } from "../planning/planning-model";
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
 * window to another plan. The menu is the window's own (`action-menu.tsx`),
 * so both doors draw it the same way and Permanently delete can be drawn red.
 *
 * Rename edits the name where the door draws it: the sidebar's row turns
 * into a field, and the toolbar's ⋯ opens its title as one. Pin and Archive
 * move the plan in the sidebar at once, and each is undone from the same
 * menu. Permanently delete cannot be undone, so choosing it asks first in a
 * dialog over the window that names the plan and offers Archive as the way
 * to keep it, whichever door it was chosen from.
 */

/** A plan as the list or the open document holds it, archived or not; nothing for a plan neither holds. */
function planOf(plans: PlansControl, planId: string): PlanSummary | undefined {
  const listed = [...plans.plans, ...plans.archived].find((plan) => plan.id === planId);
  if (listed !== undefined) return listed;
  const { region } = plans;
  return region.kind === DOCUMENT_REGION.READY && region.plan.id === planId
    ? region.plan
    : undefined;
}

/**
 * Pin and Archive, each offered as whichever way the plan is not yet. An
 * archived plan offers no pin, because the sidebar draws it among the
 * archived whether or not it is pinned.
 */
function placeActions(plans: PlansControl, plan: PlanSummary | undefined): MenuAction[] {
  if (plan === undefined) return [];
  const mark = (to: Parameters<PlansControl["onMarkPlan"]>[1]) => () =>
    plans.onMarkPlan(plan.id, to);
  if (plan.archivedAt !== undefined) {
    return [{ label: "Unarchive", icon: <UnarchiveIcon />, onSelect: mark(PLAN_MARK.UNARCHIVE) }];
  }
  return [
    plan.pinnedAt === undefined
      ? { label: "Pin", icon: <PinIcon />, onSelect: mark(PLAN_MARK.PIN) }
      : { label: "Unpin", icon: <UnpinIcon />, onSelect: mark(PLAN_MARK.UNPIN) },
    { label: "Archive", icon: <ArchiveIcon />, onSelect: mark(PLAN_MARK.ARCHIVE) },
  ];
}

/**
 * One plan's actions in the groups a rule divides, offering only those that
 * apply to it now. Copy formats the document drawn, so only the open plan
 * offers it, ahead of Rename; Pin and Archive follow; the repository is
 * changed from any plan and opened on GitHub where there is one; Permanently
 * delete is last and alone.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  doors: { rename: () => void; askDelete: () => void },
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const plan = planOf(plans, planId);
  const rename: MenuAction = { label: "Rename", icon: <PencilIcon />, onSelect: doors.rename };
  const change: MenuAction = {
    label: "Change repository…",
    icon: <GitHubMark />,
    onSelect: () => plans.onChangeRepository(planId),
  };
  const groups: MenuAction[][] = [
    drawn
      ? [{ label: "Copy plan", icon: <CopyIcon />, onSelect: plans.copy.onPress }, rename]
      : [rename],
    placeActions(plans, plan),
    (plan?.repository ?? null) === null
      ? [change]
      : [
          change,
          {
            label: "Open on GitHub",
            icon: <ExternalIcon />,
            onSelect: () => plans.onOpenOnGitHub(planId),
          },
        ],
    [
      {
        label: "Permanently delete",
        icon: <TrashIcon />,
        onSelect: doors.askDelete,
        danger: true,
      },
    ],
  ];
  return groups.filter((group) => group.length > 0);
}

/**
 * The question Permanently delete asks, naming the plan. Deleting a plan
 * removes its document and its board and clears the conversation its
 * transcript is read from, which nothing in the app brings back, so a plan
 * not yet archived is pointed at Archive, which keeps all of it.
 */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  const lost = `“${name}” and its board and transcript will be deleted. This can’t be undone.`;
  return {
    title: "Permanently delete plan?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: "Permanently delete",
    running: "Deleting…",
  };
}

/**
 * One plan's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, and the question does not
 * outlive the plan: each is taken down in the render that finds it gone, so
 * neither is left standing over another surface, over a plan deleted
 * elsewhere, or waiting for the next time the panel opens.
 */
function usePlanMenu(plans: PlansControl, planId: string, name: string, rename: () => void) {
  const plan = planOf(plans, planId);
  const deletion = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: plans.shown }, () =>
    plans.onDeletePlan(planId),
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
  const dialog = (
    <ConfirmDialog
      confirm={deletion}
      question={deleteQuestion(name, plan?.archivedAt !== undefined)}
    />
  );
  return { deletion, open: open !== undefined, show, close, menu, dialog };
}

/**
 * The open plan's ⋯ button in the toolbar, and the menu it drops. It is also
 * what offers the open plan's Archive and Permanently delete shortcuts, so
 * each runs exactly as its menu item would: Permanently delete still asks
 * first, and an archived plan has no Archive to offer.
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
    APP_COMMAND.ARCHIVE_PLAN,
    plan.archivedAt === undefined ? () => plans.onMarkPlan(plan.id, PLAN_MARK.ARCHIVE) : undefined,
  );
  return (
    <>
      <Tooltip label="Plan actions">
        <button
          type="button"
          className="icon-button"
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
 * A plan in the sidebar, pinned, listed, or archived alike: a press opens
 * it, and a right-click offers its actions where the pointer is. Renamed,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row. A pin or an archive the service refused says
 * so under the row the plan went back to.
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
  const markNote = plans.markNotes.get(plan.id);
  const row = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  const repository =
    plan.repository !== null ? (
      <span className="sidebar-plan-repository">{plan.repository}</span>
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
      {markNote !== undefined ? (
        <p className="sidebar-note" role="alert">
          {markNote}
        </p>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </li>
  );
}
