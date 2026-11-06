import type { Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_VIEW, type SettingsLink, type SettingsView } from "@repo/settings/settings-views";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { ROUTED_PLACE, settingsViewOfPage } from "./route-gates.js";
import { useRoutedLocation } from "./routed-location.js";
import { landOnSettingsRow } from "./settings-search.js";

/**
 * settings-link.ts -- Settings as the router stands it: the page, whether its list stands, the workspace its address names, and the navigation a Settings link makes.
 *
 * Settings is a routed place (`panel-router.tsx`): its address is
 * `/<workspace>/settings`, its list, and `/<workspace>/settings/<page>`, a
 * page, or the same under `/app` while the window lists no workspace. What
 * it shows is read from that address: the page, on its list the page last
 * shown, or Profile where Settings was entered on its list, and the workspace the
 * Workspace page shows, the one its address names, else the one the sidebar
 * lists. The sidebar is left as it was, because the task open behind
 * Settings must still be the listed workspace's when Back returns to it.
 *
 * Every Open Settings press names where it leads as a `SettingsLink`, which
 * is one navigation: entering Settings is a step after the place it was
 * opened from, and turning its page replaces the step standing, so Settings
 * is one step however many of its pages are turned; but a narrow room's
 * page opened from its list is a step after the list, which Back returns
 * to. Its section is then looked for once the page is drawn, and given up
 * on quietly where it is not.
 */

/** Settings as the router stands it, and the doors that move it. */
export interface SettingsRoute {
  /** Whether Settings stands. */
  readonly standing: boolean;
  /** The page shown: the one its address names, else Profile, which it opens on. */
  readonly view: SettingsView;
  /** Whether its page list stands rather than a page, which only a narrow room draws apart. */
  readonly listed: boolean;
  /** The workspace its address names, else the one the sidebar lists. */
  readonly workspaceId: string | undefined;
  /** The address of its page list, while it stands. */
  readonly listAddress: string | undefined;
  /** Goes to the place in Settings `link` names; answers how to give up the look for its section. */
  readonly open: (link: SettingsLink) => () => void;
  /** Stands its page list in the page's place. */
  readonly list: () => void;
}

/** Settings as the router stands it, over the account's `workspaces`, the sidebar listing `listedId`, in a room `narrow` or not. */
export function useSettingsRoute(input: {
  workspaces: readonly Workspace[];
  listedId: string | undefined;
  narrow: boolean;
}): SettingsRoute {
  const { workspaces, listedId, narrow } = input;
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const standing = here.place === ROUTED_PLACE.SETTINGS;
  const { params } = here;
  const slug = standing ? params.workspace : undefined;
  const page = standing ? params.page : undefined;
  const named = workspaces.find((each) => each.slug === slug)?.id;
  const workspaceId = named ?? listedId;
  const listed = standing && page === undefined;
  // Note that its list stands on the page last shown, which a narrow room's way back to it marks; Settings entered anew stands on Profile.
  const lastPage = useRef<string | undefined>(undefined);
  if (!standing) lastPage.current = undefined;
  else if (page !== undefined) lastPage.current = page;
  const shownPage = page ?? lastPage.current;
  const view =
    (shownPage === undefined ? undefined : settingsViewOfPage(shownPage)) ?? SETTINGS_VIEW.ACCOUNT;
  const listAddress = !standing
    ? undefined
    : slug === undefined
      ? router.buildLocation({ to: "/app/settings" }).href
      : router.buildLocation({ to: "/$workspace/settings", params: { workspace: slug } }).href;
  // Settings goes under the workspace a link named, else the one it stands under, else the one the sidebar lists.
  const slugFor = (workspace: string | undefined): string | undefined =>
    workspaces.find((each) => each.id === workspace)?.slug ?? slug;
  const go = (to: string | undefined, under: string | undefined, replace: boolean) => {
    if (under === undefined) {
      if (to === undefined) void navigate({ to: "/app/settings", replace });
      else void navigate({ to: "/app/settings/$page", params: { page: to }, replace });
      return;
    }
    if (to === undefined) {
      void navigate({ to: "/$workspace/settings", params: { workspace: under }, replace });
    } else {
      void navigate({
        to: "/$workspace/settings/$page",
        params: { workspace: under, page: to },
        replace,
      });
    }
  };
  const open = (link: SettingsLink) => {
    // Note that entering Settings in a narrow room stands it on its page list, which a link to the list keeps.
    const to = link.listed === true ? undefined : link.page;
    // A page opened from a narrow room's list is a step after it; any other turn of Settings takes its step in place.
    const replace = standing && !(narrow && listed && to !== undefined);
    go(to, slugFor(link.workspaceId ?? workspaceId ?? listedId), replace);
    return link.section === undefined ? () => undefined : landOnSettingsRow(link.section);
  };
  const list = () => {
    if (standing) go(undefined, slug, true);
  };
  return { standing, view, listed, workspaceId, listAddress, open, list };
}
