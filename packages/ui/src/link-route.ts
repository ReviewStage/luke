import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
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
 * window does not know opens Settings on its first. Chat's place stands
 * nowhere while its experiment is off, as every other door to it does
 * (`renderer/CLAUDE.md`'s "Experiments"), so a link to it says how to turn
 * it on instead, and names the page it is turned on in, which the window
 * offers by the page's own name rather than a path spelled into the words.
 * The Admin place is an admin's alone, so its link opens nowhere, and says
 * nothing, for a reader who is no admin;
 * the window counts a reader whose access it is still reading as one, the
 * place waiting on that read, since a reload on an Admin address would
 * otherwise be refused for a reader who is an admin. Every other place opens on
 * the Plans tab, whose own door checks nothing: a place the reader may not
 * read is read all the same, and its read says it is not there.
 */

export const LINK_ROUTE = {
  SETTINGS: "settings",
  TASKS: "plans",
  EXPERIMENT_OFF: "experiment-off",
  /** An Admin link opened by a reader who is no admin, which opens nowhere. */
  NOT_PERMITTED: "not-permitted",
} as const;

/** Where a link opens, with the Settings place where it opens there. */
export type LinkRoute =
  | { readonly kind: typeof LINK_ROUTE.SETTINGS; readonly settings: SettingsLink }
  | { readonly kind: typeof LINK_ROUTE.TASKS }
  | { readonly kind: typeof LINK_ROUTE.EXPERIMENT_OFF; readonly settings: SettingsLink }
  | { readonly kind: typeof LINK_ROUTE.NOT_PERMITTED };

/** What a link to a place of an experiment that is off says, since the place stands nowhere until it is on; the route names the page it is turned on in. */
export const EXPERIMENT_OFF_LINK = "Turn on this experiment in settings to open the link.";

/** Where an experiment that is off is turned on. */
const EXPERIMENTS: SettingsLink = { page: SETTINGS_VIEW.EXPERIMENTAL };

/** Where the window opens a link, given the account's workspaces and the experiments it has on. */
export function linkRoute(
  { workspace, place }: ReadLink,
  window: {
    readonly workspaces: readonly Workspace[];
    readonly chatOn: boolean;
    /** Whether the reader is an admin, or may be one while their access is read. */
    readonly adminOn: boolean;
  },
): LinkRoute {
  switch (place.kind) {
    case LINK_PLACE.SETTINGS: {
      const home = window.workspaces.find(
        (each) => each.slug === workspace || each.id === workspace,
      );
      const known = SETTINGS_PAGE_LIST.find((each) => each === place.page);
      // Note that a link naming no page this window knows names the page list, which stands on its first page.
      const page =
        known === undefined
          ? { page: SETTINGS_VIEW.ACCOUNT, listed: true as const }
          : { page: known };
      return {
        kind: LINK_ROUTE.SETTINGS,
        settings: home === undefined ? page : { ...page, workspaceId: home.id },
      };
    }
    case LINK_PLACE.CHAT:
      return window.chatOn
        ? { kind: LINK_ROUTE.TASKS }
        : { kind: LINK_ROUTE.EXPERIMENT_OFF, settings: EXPERIMENTS };
    case LINK_PLACE.ADMIN:
      return window.adminOn ? { kind: LINK_ROUTE.TASKS } : { kind: LINK_ROUTE.NOT_PERMITTED };
    default:
      return { kind: LINK_ROUTE.TASKS };
  }
}
