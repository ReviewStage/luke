import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PLAN_ACTOR, type PlanSummary } from "@luke/features/plan-wire";
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalIcon,
  PinIcon,
  ProviderMark,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
} from "@luke/ui";
import { accountActor, creatorActor, teammateCreator } from "@luke/ui/actor-model";
import { confirmAsked } from "@luke/ui/confirm-state";
import { DOCUMENT_REGION, PLAN_MARK, type PlanMark } from "@luke/ui/planning-model";
import { FolderInputIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark, ActorRef, CreatorHeard } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { usePlanDrafted } from "../composer-drafts";
import { useCopyToast } from "../copy-feedback";
import { DraftMark } from "../draft-mark";
import { useMemberDirectory } from "../member-directory";
import { EditedBy, type EditPlace, useEditReader } from "../planning/edit-ref";
import { lastEditOf } from "../planning/plan-body";
import {
  copyPlanLinkItem,
  markReadItem,
  planLinkPlace,
  type ReadMark,
  renamePlanItem,
  versionHistoryItem,
} from "../planning/plan-menu-items";
import { useMinute } from "../planning/plan-time";
import { RelativeTime } from "../planning/relative-time";
import { useReadMarks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "../settings/confirm-dialog";
import { Tooltip } from "../tooltip";
import { useAppState } from "../use-app-state";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { drawnDraftTabs } from "./main-tabs";
import { strandedHome, useMovePlanDialog } from "./move-plan-dialog";
import { PlanStatusMark, planCardOf } from "./plan-card";
import { PlanNameField, usePlanRename } from "./plan-name-field";

/**
 * plan-actions.tsx -- one plan's actions, offered alike from the toolbar's ⋯ button and from a right-click on the plan in the sidebar.
 *
 * Both doors open the same menu over the same plan, so a plan in the list can
 * be acted on without being opened first. The menu is the window's own (`action-menu.tsx`),
 * so both doors draw it the same way and Permanently delete can be drawn red.
 *
 * Copy link copies the plan's address on tryluke.dev, as the ⋯
 * beside the plan's title does (`plan-menu-items.tsx`). Mark as unread
 * draws the task's row in the unread weight until it next opens, and turns
 * to Mark as read on a task already unread. Rename edits the
 * name where the door draws it: the sidebar's row turns into a field, and
 * the toolbar's ⋯ opens its title as one. Version history
 * opens the plan's versions over the whole window, opening the plan first
 * where it is not the open one, the one item that moves it. Pin and Archive
 * move the plan in the sidebar at once, and each is undone from the same
 * menu; a sidebar row also offers both as buttons at its end on hover.
 * Move to workspace opens a dialog listing the account's other workspaces
 * and what the move does (`move-plan-dialog.tsx`), offered on a plan the
 * reader started.
 * Permanently delete cannot be undone, so choosing it asks first in a dialog
 * over the window that names the plan and offers Archive as the way to keep
 * it, whichever door it was chosen from. Under the items, pressed by nothing,
 * the menu says who created the plan and who last edited it, and when.
 */

/** A plan as the list or the open document holds it, archived or not; nothing for a plan neither holds. */
export function planOf(plans: PlansControl, planId: string): PlanSummary | undefined {
  const listed = [...plans.plans, ...plans.archived].find((plan) => plan.id === planId);
  if (listed !== undefined) return listed;
  const { region } = plans;
  return region.kind === DOCUMENT_REGION.READY && region.plan.id === planId
    ? region.plan
    : undefined;
}

/** One way a plan can be moved in the sidebar, as the menu and the row's own buttons both offer it. */
interface PlaceMark {
  mark: PlanMark;
  label: string;
  icon: React.JSX.Element;
}

/**
 * Pin and Archive, each offered as whichever way the plan is not yet. An
 * archived plan offers no pin, because the sidebar draws it among the
 * archived whether or not it is pinned.
 */
function placeMarks(plan: PlanSummary): PlaceMark[] {
  if (plan.archivedAt !== undefined) {
    return [{ mark: PLAN_MARK.UNARCHIVE, label: "Unarchive", icon: <UnarchiveIcon /> }];
  }
  return [
    plan.pinnedAt === undefined
      ? { mark: PLAN_MARK.PIN, label: "Pin", icon: <PinIcon /> }
      : { mark: PLAN_MARK.UNPIN, label: "Unpin", icon: <UnpinIcon /> },
    { mark: PLAN_MARK.ARCHIVE, label: "Archive", icon: <ArchiveIcon /> },
  ];
}

/** Pin and Archive as the menu's items; nothing for a plan neither the list nor the document holds. */
function placeActions(plans: PlansControl, plan: PlanSummary | undefined): MenuAction[] {
  if (plan === undefined) return [];
  return placeMarks(plan).map(({ mark, label, icon }) => ({
    label,
    icon,
    onSelect: () => plans.onMarkPlan(plan.id, mark),
  }));
}

/**
 * Pin and Archive at a sidebar row's end, standing in the time's place while
 * the row is hovered or reached from the keyboard. Rested on, the row hangs
 * the plan's card beside it (`plan-card.tsx`): its name in full, its
 * repository, and its agents and pull requests, read from the list's row. Each runs what its menu
 * item runs, and only the open plan's Archive names ⇧⌘A, because the chord
 * archives the open plan rather than the row under the pointer. They are the
 * row's siblings rather than inside it, so a press on one opens nothing, but
 * part of the row to its card, which stands while the pointer is on them and
 * goes as one is pressed (`Tooltip`'s `cardRegion`).
 */
function SidebarPlanMarks({
  plans,
  plan,
  current,
  disabled,
  onContextMenu,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  current: boolean;
  disabled: boolean;
  /** Offers the row's own menu, so a right-click on a button over its end still reaches it. */
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}): React.JSX.Element {
  return (
    <span className="sidebar-plan-marks">
      {placeMarks(plan).map(({ mark, label, icon }) => (
        <Tooltip
          key={mark}
          label={label}
          {...(current && mark === PLAN_MARK.ARCHIVE ? { command: APP_COMMAND.ARCHIVE_PLAN } : {})}
        >
          <button
            type="button"
            className="sidebar-plan-mark"
            aria-label={label}
            disabled={disabled}
            onClick={() => plans.onMarkPlan(plan.id, mark)}
            onContextMenu={onContextMenu}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </span>
  );
}

/**
 * One plan's actions in the groups a rule divides, offering only those that
 * apply to it now. Copy formats the document drawn, so only the open plan
 * offers it, ahead of Copy link, Mark as unread or read, Rename,
 * and Version history; Pin and Archive follow; the repository is changed from any plan and opened on
 * GitHub where there is one, beside Move to workspace where the plan may be
 * moved; Permanently delete is last and alone. An archived plan takes
 * nothing until it is brought back, so it offers neither Rename, Change
 * repository, nor a move, only what reads it, its link, its read mark, and
 * its version history (which restores nothing), Unarchive, and Permanently
 * delete.
 */
function planActionGroups(
  plans: PlansControl,
  planId: string,
  doors: {
    rename: () => void;
    askDelete: () => void;
    askMove: (() => void) | undefined;
    copy: (words: string, label: string) => void;
    read: ReadMark;
  },
): MenuAction[][] {
  const { region } = plans;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.plan.id === planId;
  const plan = planOf(plans, planId);
  const archived = plan?.archivedAt !== undefined;
  const copy: MenuAction = { label: "Copy plan", icon: <CopyIcon />, onSelect: plans.copy.onPress };
  const link: MenuAction[] =
    plan === undefined
      ? []
      : [
          copyPlanLinkItem(doors.copy, planId, planLinkPlace(plans.workspaces, plan)),
          markReadItem(doors.read),
        ];
  const rename = renamePlanItem(doors.rename);
  const versions = versionHistoryItem(() => plans.history.onOpen(planId));
  const change: MenuAction = {
    label: "Change repository",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => plans.onChangeRepository(planId),
  };
  const move: MenuAction[] =
    doors.askMove === undefined
      ? []
      : [{ label: "Move to workspace", icon: <FolderInputIcon />, onSelect: doors.askMove }];
  const open: MenuAction = {
    label: "Open on GitHub",
    icon: <ExternalIcon />,
    onSelect: () => plans.onOpenOnGitHub(planId),
  };
  const groups: MenuAction[][] = [
    [...(drawn ? [copy] : []), ...link, ...(archived ? [] : [rename]), versions],
    placeActions(plans, plan),
    [
      ...(archived ? [] : [change]),
      ...move,
      ...((plan?.repository ?? null) === null ? [] : [open]),
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
 * The menu's quiet foot, as Notion, Linear, and Google Docs end a document's
 * menu: "Created by [Charles] Charles Pan · 3d ago" and "Last edited by
 * [you] you · 2h ago", each person on their face hanging their card. The
 * last editor is named only for the plan the window has open, whose newest
 * revision it holds, as its "Edited by" line names them; another plan is
 * said only by when it was last saved, and one nobody has saved since it
 * started says only who created it. Nothing here is a press: the menu's
 * items are.
 */
function PlanMenuFooter({
  plans,
  plan,
}: {
  plans: PlansControl;
  plan: PlanSummary;
}): React.JSX.Element {
  const now = useMinute();
  const reader = useEditReader({ readerId: plans.me });
  const account = useAppState()?.account;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  const { region } = plans;
  const opened = region.kind === DOCUMENT_REGION.READY && region.plan.id === plan.id;
  const edit = opened ? lastEditOf(region.plan) : undefined;
  const place: EditPlace = {
    reader,
    sections: (opened ? region.plan.sectionEdits : undefined) ?? [],
    agents: { control: plans.agents, onOpen: undefined },
    now,
  };
  const named = edit !== undefined && edit.actor !== PLAN_ACTOR.EARLIER;
  return (
    <>
      <p className="plan-menu-note actor-line">
        {"Created by "}
        <ActorRef actor={creatorActor(plan, reader, you)} sentence />
        {" · "}
        <RelativeTime at={plan.createdAt} now={now} ago />
      </p>
      {edit === undefined && plan.updatedAt <= plan.createdAt ? null : (
        <p className="plan-menu-note actor-line">
          {named ? "Last edited by " : "Last edited"}
          {edit === undefined ? null : <EditedBy edit={edit} place={place} sentence />}
          {" · "}
          <RelativeTime at={edit?.at ?? plan.updatedAt} now={now} ago />
        </p>
      )}
    </>
  );
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
    title: "Permanently delete task?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: "Permanently delete",
    running: "Deleting",
  };
}

/**
 * One plan's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, the menu does not
 * outlive its door, and the question does not outlive the plan: each is
 * taken down in the render that finds it gone, so neither is left standing
 * over another surface, over a plan deleted elsewhere, or waiting for the
 * next time the panel opens.
 */
function usePlanMenu(
  plans: PlansControl,
  planId: string,
  name: string,
  doors: { rename: () => void; drawn: boolean; unread: boolean },
) {
  const plan = planOf(plans, planId);
  const reads = useReadMarks();
  const deletion = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: plans.shown }, () =>
    plans.onDeletePlan(planId),
  );
  const moving = useMovePlanDialog(plans, plan);
  const copy = useCopyToast();
  const { open, drawn, close, trigger, contextMenu } = useActionMenu(plans.shown && doors.drawn);
  const menu =
    drawn === undefined ? null : (
      <ActionMenu
        label="Task actions"
        menu={drawn}
        footer={plan === undefined ? undefined : <PlanMenuFooter plans={plans} plan={plan} />}
        groups={planActionGroups(plans, planId, {
          rename: doors.rename,
          askDelete: deletion.ask,
          askMove: moving.ask,
          copy,
          read: {
            unread: doors.unread,
            onMark: (unread) => {
              if (plan !== undefined) reads.mark(plan, unread);
            },
          },
        })}
        onClose={close}
      />
    );
  const dialog = (
    <>
      <ConfirmDialog
        confirm={deletion}
        question={deleteQuestion(name, plan?.archivedAt !== undefined)}
      />
      {moving.dialog}
    </>
  );
  return { deletion, open: open !== undefined, close, trigger, contextMenu, menu, dialog };
}

/**
 * The open plan's ⋯ button in the toolbar, and the menu it drops, drawn
 * while the plan's own tab is chosen, because the menu is the plan's and not
 * an agent's. It is also what offers the open plan's Archive and Permanently
 * delete shortcuts, on every tab of the plan, so each runs exactly as its
 * menu item would: Permanently delete still asks first, and an archived plan
 * has no Archive to offer.
 */
export function PlanActions({
  plans,
  plan,
  button,
  onRename,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether the ⋯ button is drawn: the shortcuts and the delete question stand either way. */
  button: boolean;
  /** Opens the toolbar's title as the plan's name field. */
  onRename: () => void;
}): React.JSX.Element {
  // Note that the open plan is unread only by a mark by hand, since its saves are seen as they land.
  const actions = usePlanMenu(plans, plan.id, plan.name, {
    rename: onRename,
    drawn: button,
    unread: useReadMarks().markedUnread(plan.id),
  });
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_PLAN, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(
    APP_COMMAND.ARCHIVE_PLAN,
    plan.archivedAt === undefined ? () => plans.onMarkPlan(plan.id, PLAN_MARK.ARCHIVE) : undefined,
  );
  return (
    <>
      {button ? (
        <Tooltip label="Task actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Task actions"
            disabled={deletion.busy}
            {...actions.trigger()}
          >
            <EllipsisIcon />
          </button>
        </Tooltip>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </>
  );
}

/**
 * A plan in the sidebar, pinned, listed, or archived alike: its name, in the
 * body's weight unless the plan is unread, and at the row's end how long ago
 * it was last updated, led by one mark for a repository that belongs to
 * another workspace, an agent at work, or a pull request (`plan-card.tsx`),
 * the first named in the row's card, before that a pencil while a draft
 * waits in one of its boxes, past those its column's tabs mark themselves
 * while it is the plan open (`draft-mark.tsx`), and before that, on a task
 * someone else created, its creator's face (`teammateCreator`), read against
 * the members of the directory around the list; the reader's own tasks wear
 * none. Its repository's name, muted, where the list hands one (in one run),
 * and no face where its group is its creator's. Its time is the one the
 * list's order chooses. Pin
 * and Archive stand in place of all of it while the row is hovered or
 * reached from the keyboard.
 * A press opens it, and a right-click offers its actions where the pointer is. Renamed,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row.
 *
 */
export function SidebarPlan({
  plans,
  plan,
  current,
  open = current,
  unread,
  now,
  at = plan.updatedAt,
  repository,
  face = true,
  onOpen,
}: {
  plans: PlansControl;
  plan: PlanSummary;
  /** Whether this is the plan the work column is showing. */
  current: boolean;
  /** Whether the plan is open in the window, its column's tabs marking their own drafts; a row the sidebar does not mark may be, as one opened from a pin, and is its own mark unless said. */
  open?: boolean;
  /** Whether the plan was saved since the developer last looked at it on this Mac. */
  unread: boolean;
  /** The time the row's last update is counted back from. */
  now: number;
  /** The time the row shows, which the list's order chooses: its last update unless said. */
  at?: number;
  /** The repository's name the row says, muted before its time, where the list hands one. */
  repository?: string | undefined;
  /** Whether a teammate's task wears its creator's face, which a group by creator says instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = usePlanRename(plan.id, plans.onRenamePlan);
  const actions = usePlanMenu(plans, plan.id, plan.name, {
    rename: rename.begin,
    drawn: true,
    unread,
  });
  const teammate = teammateCreator(plan, useMemberDirectory());
  const creator = face ? teammate : undefined;
  const drafted = usePlanDrafted(
    plan.id,
    open ? drawnDraftTabs(plans.mainTabs, plans.agents) : undefined,
  );
  const row = useRef<HTMLButtonElement | null>(null);
  const item = useRef<HTMLLIElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  // Note that the row is what the menu rings and hands focus back to, even
  // when the right-click lands on Pin or Archive over its end.
  const showMenu = actions.contextMenu(row);
  return (
    <li ref={item} className="sidebar-plan-item">
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
        </div>
      ) : (
        <Tooltip label={plan.name} card={planCardOf(plans, plan, now)} cardBeside cardRegion={item}>
          <button
            ref={row}
            type="button"
            className="sidebar-plan"
            aria-current={current ? "page" : undefined}
            data-menu-open={String(actions.open)}
            data-unread={String(unread)}
            disabled={actions.deletion.busy}
            onClick={() => {
              actions.close(false);
              onOpen();
            }}
            onContextMenu={showMenu}
          >
            <span className="sidebar-plan-line">
              <span className="sidebar-plan-name">{plan.name}</span>
              {unread ? <span className="visually-hidden">(unread)</span> : null}
              {creator === undefined ? null : <CreatorHeard actor={creator} />}
              <span className="sidebar-plan-time">
                {repository === undefined ? null : (
                  <span className="sidebar-plan-repository">{repository}</span>
                )}
                {creator === undefined ? null : (
                  <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
                )}
                {drafted ? <DraftMark /> : null}
                <PlanStatusMark plan={plan} stranded={strandedHome(plans, plan)} />
                <RelativeTime at={at} now={now} hint={false} />
              </span>
            </span>
          </button>
        </Tooltip>
      )}
      {rename.editing ? null : (
        <SidebarPlanMarks
          plans={plans}
          plan={plan}
          current={current}
          disabled={actions.deletion.busy}
          onContextMenu={showMenu}
        />
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
