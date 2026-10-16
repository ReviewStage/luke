import { encodeMention, MENTION_KIND, type MentionPlace } from "@luke/features/mention-link";
import type { PlanSummary } from "@luke/features/plan-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { PencilIcon } from "@luke/ui";
import { HistoryIcon, LinkIcon, MailIcon, MailOpenIcon } from "lucide-react";
import { LINK_COPY } from "../copy-feedback";
import type { MenuAction } from "../desktop/action-menu";

/**
 * plan-menu-items.tsx -- the items a plan's ⋯ menu and the ⋯ beside its title both offer: Copy link, Mark as unread, Rename, and Version history.
 *
 * Each menu says what pressing one does where it is drawn, so the sidebar's
 * Rename edits the row and the title's edits the title, but both draw the
 * item the same way. The link is the plan's own address on tryluke.dev,
 * written by the mention encoder (`@luke/features/mention-link`) as a mention
 * of the plan is, so it opens the plan in the app as a mention's chip does.
 * Mark as unread turns to Mark as read on a task already unread, as Mail,
 * Slack, and Linear offer it (`use-plan-looks.ts`).
 */

/** Where a plan's links are written: its workspace by slug, or by id until the workspaces are read, and its repository. */
export function planLinkPlace(
  workspaces: readonly Workspace[],
  plan: Pick<PlanSummary, "workspaceId" | "repository">,
): MentionPlace {
  const home = workspaces.find((each) => each.id === plan.workspaceId);
  return { workspace: home?.slug ?? plan.workspaceId, repository: plan.repository };
}

/** Copy link, the plan's, through `copy`, the window's menu copy (`useCopyToast`), which says so in a toast. */
export function copyPlanLinkItem(
  copy: (words: string, label: string) => void,
  planId: string,
  place: MentionPlace,
): MenuAction {
  return {
    label: LINK_COPY.LABEL,
    icon: <LinkIcon aria-hidden="true" />,
    onSelect: () =>
      copy(encodeMention({ kind: MENTION_KIND.PLAN, planId }, place), LINK_COPY.COPIED),
  };
}

/** Whether a task is unread, as its sidebar row's weight says, and the mark that makes it unread or read. */
export interface ReadMark {
  readonly unread: boolean;
  readonly onMark: (unread: boolean) => void;
}

/** Mark as unread, or Mark as read on a task already unread. */
export function markReadItem({ unread, onMark }: ReadMark): MenuAction {
  return unread
    ? { label: "Mark as read", icon: <MailOpenIcon />, onSelect: () => onMark(false) }
    : { label: "Mark as unread", icon: <MailIcon />, onSelect: () => onMark(true) };
}

/** Rename, editing the name where the menu's door draws it. */
export function renamePlanItem(rename: () => void): MenuAction {
  return { label: "Rename", icon: <PencilIcon />, onSelect: rename };
}

/** Version history, opening the plan's versions over the window. */
export function versionHistoryItem(open: () => void): MenuAction {
  return { label: "Version history", icon: <HistoryIcon />, onSelect: open };
}
