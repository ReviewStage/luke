import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_VIEW,
  type SettingsLink,
} from "@luke/settings/settings-views";

/**
 * link-route.ts -- where in the window a Luke link opens: Settings, the Plans tab, or nowhere for a place the reader may not open.
 *
 * A page of Settings opens in Settings, on the workspace the link's slug
 * names where the account is in it, so a teammate's link to their
 * workspace's members lands on the reader's own copy of that page, or on
 * the reader's own Workspace page where they are not in it; a page the
 * window does not know opens Settings on its first. The Admin place is an admin's alone, so its link opens nowhere, and says
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
  /** An Admin link opened by a reader who is no admin, which opens nowhere. */
  NOT_PERMITTED: "not-permitted",
} as const;

/** Where a link opens, with the Settings place where it opens there. */
export type LinkRoute =
  | { readonly kind: typeof LINK_ROUTE.SETTINGS; readonly settings: SettingsLink }
  | { readonly kind: typeof LINK_ROUTE.TASKS }
  | { readonly kind: typeof LINK_ROUTE.NOT_PERMITTED };

/** Where the window opens a link, given the account's workspaces and whether the reader is an admin. */
export function linkRoute(
  { workspace, place }: ReadLink,
  window: {
    readonly workspaces: readonly Workspace[];
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
    case LINK_PLACE.ADMIN:
      return window.adminOn ? { kind: LINK_ROUTE.TASKS } : { kind: LINK_ROUTE.NOT_PERMITTED };
    default:
      return { kind: LINK_ROUTE.TASKS };
  }
}
