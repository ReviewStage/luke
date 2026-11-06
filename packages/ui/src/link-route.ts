import { LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import {
  SETTINGS_PAGE_LIST,
  SETTINGS_VIEW,
  type SettingsLink,
} from "@repo/settings/settings-views";

export const LINK_ROUTE = {
  SETTINGS: "settings",
  TASKS: "plans",
  NOT_PERMITTED: "not-permitted",
} as const;

export type LinkRoute =
  | { readonly kind: typeof LINK_ROUTE.SETTINGS; readonly settings: SettingsLink }
  | { readonly kind: typeof LINK_ROUTE.TASKS }
  | { readonly kind: typeof LINK_ROUTE.NOT_PERMITTED };

export function linkRoute(
  { workspace, place }: ReadLink,
  window: {
    readonly workspaces: readonly Workspace[];
    readonly adminOn: boolean;
  },
): LinkRoute {
  switch (place.kind) {
    case LINK_PLACE.SETTINGS: {
      const home = workspaceOfSlug(window.workspaces, workspace);
      const known = SETTINGS_PAGE_LIST.find((each) => each === place.page);
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
