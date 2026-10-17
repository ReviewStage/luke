import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_VIEW,
  type SettingsLink,
} from "@luke/settings/settings-views";

/**
 * link-route.ts -- where in the window a Luke link opens: Settings, the Plans tab, or nowhere while the experiment its place belongs to is off.
 *
 * A page of Settings opens in Settings, on the workspace the link's slug
 * names where the account is in it, so a teammate's link to their
 * workspace's members lands on the reader's own copy of that page, or on
 * the reader's own Workspace page where they are not in it; a page the
 * window does not know opens Settings on its first. Factory's,
 * Automations', and Issues' places stand nowhere while their experiments are off, as
 * every other door to them does (`renderer/CLAUDE.md`'s "Experiments"), so
 * a link to one says how to turn it on instead. Every other place opens on
 * the Plans tab, whose own door checks nothing: a place the reader may not
 * read is read all the same, and its read says it is not there.
 */

export const LINK_ROUTE = {
  SETTINGS: "settings",
  TASKS: "plans",
  EXPERIMENT_OFF: "experiment-off",
} as const;

/** Where a link opens, with the Settings place where it opens there. */
export type LinkRoute =
  | { readonly kind: typeof LINK_ROUTE.SETTINGS; readonly settings: SettingsLink }
  | { readonly kind: typeof LINK_ROUTE.TASKS }
  | { readonly kind: typeof LINK_ROUTE.EXPERIMENT_OFF };

/** What a link to a place of an experiment that is off says, since the place stands nowhere until it is on. */
export const EXPERIMENT_OFF_LINK =
  "Turn on this experiment in Settings › Experimental to open the link.";

/** Where the window opens a link, given the account's workspaces and the experiments it has on. */
export function linkRoute(
  { workspace, place }: ReadLink,
  window: {
    readonly workspaces: readonly Workspace[];
    readonly factoryOn: boolean;
    readonly automationsOn: boolean;
    readonly issuesOn: boolean;
  },
): LinkRoute {
  switch (place.kind) {
    case LINK_PLACE.SETTINGS: {
      const home = window.workspaces.find(
        (each) => each.slug === workspace || each.id === workspace,
      );
      const page = SETTINGS_PAGE_LIST.find((each) => each === place.page) ?? SETTINGS_VIEW.ACCOUNT;
      return {
        kind: LINK_ROUTE.SETTINGS,
        settings: home === undefined ? { page } : { page, workspaceId: home.id },
      };
    }
    case LINK_PLACE.FACTORY:
      return window.factoryOn ? { kind: LINK_ROUTE.TASKS } : { kind: LINK_ROUTE.EXPERIMENT_OFF };
    case LINK_PLACE.AUTOMATIONS:
    case LINK_PLACE.AUTOMATION:
    case LINK_PLACE.AUTOMATION_RUN:
      return window.automationsOn
        ? { kind: LINK_ROUTE.TASKS }
        : { kind: LINK_ROUTE.EXPERIMENT_OFF };
    case LINK_PLACE.ISSUE:
      return window.issuesOn ? { kind: LINK_ROUTE.TASKS } : { kind: LINK_ROUTE.EXPERIMENT_OFF };
    default:
      return { kind: LINK_ROUTE.TASKS };
  }
}
