import type { Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_VIEW, type SettingsLink, type SettingsView } from "@repo/settings/settings-views";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { ROUTED_PLACE, settingsViewOfPage } from "./route-gates.js";
import { useRoutedLocation } from "./routed-location.js";
import { landOnSettingsRow } from "./settings-search.js";

export interface SettingsRoute {
  readonly standing: boolean;
  readonly view: SettingsView;
  readonly listed: boolean;
  readonly workspaceId: string | undefined;
  readonly listAddress: string | undefined;
  readonly open: (link: SettingsLink) => () => void;
  readonly list: () => void;
}

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
    const to = link.listed === true ? undefined : link.page;
    const replace = standing && !(narrow && listed && to !== undefined);
    go(to, slugFor(link.workspaceId ?? workspaceId ?? listedId), replace);
    return link.section === undefined ? () => undefined : landOnSettingsRow(link.section);
  };
  const list = () => {
    if (standing) go(undefined, slug, true);
  };
  return { standing, view, listed, workspaceId, listAddress, open, list };
}
