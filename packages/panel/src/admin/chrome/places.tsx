/**
 * places.tsx -- the admin's sections, each by its name and glyph: what the
 * sidebar lists, and what a page under one leads back to from its toolbar.
 */

import {
  ActivityIcon,
  CircleDollarSignIcon,
  LayersIcon,
  LayoutDashboardIcon,
  SmileIcon,
  UsersIcon,
} from "lucide-react";
import { ADMIN_TAB, type AdminTab } from "../routing.js";

/** One section: the tab it opens, its name, and its glyph. */
export interface AdminPlace {
  tab: AdminTab;
  label: string;
  icon: React.ReactNode;
}

/** Each section's name and glyph, by the tab it opens. */
const PLACE_BY_TAB = {
  [ADMIN_TAB.DASHBOARD]: { label: "Overview", icon: <LayoutDashboardIcon /> },
  [ADMIN_TAB.COST]: { label: "Cost", icon: <CircleDollarSignIcon /> },
  [ADMIN_TAB.RELIABILITY]: { label: "Reliability", icon: <ActivityIcon /> },
  [ADMIN_TAB.WORKSPACES]: { label: "Workspaces", icon: <LayersIcon /> },
  [ADMIN_TAB.USERS]: { label: "Users", icon: <UsersIcon /> },
  [ADMIN_TAB.ANIMATIONS]: { label: "Animations", icon: <SmileIcon /> },
} satisfies { readonly [Tab in AdminTab]: Omit<AdminPlace, "tab"> };

/** The sidebar's places, in the order it lists them: the measures, then the face's reference last. */
export const ADMIN_PLACES: readonly AdminPlace[] = Object.values(ADMIN_TAB).map((tab) => ({
  tab,
  ...PLACE_BY_TAB[tab],
}));

/** The section `tab` opens. */
export function adminPlace(tab: AdminTab): AdminPlace {
  return { tab, ...PLACE_BY_TAB[tab] };
}
