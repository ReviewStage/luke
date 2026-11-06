import {
  ActivityIcon,
  Building2Icon,
  CircleDollarSignIcon,
  LayoutDashboardIcon,
  UsersIcon,
} from "@repo/ui/icons";
import { ADMIN_TAB, type AdminTab } from "../routing.js";

export interface AdminPlace {
  tab: AdminTab;
  label: string;
  icon: React.ReactNode;
}

const PLACE_BY_TAB = {
  [ADMIN_TAB.DASHBOARD]: { label: "Overview", icon: <LayoutDashboardIcon /> },
  [ADMIN_TAB.COST]: { label: "Cost", icon: <CircleDollarSignIcon /> },
  [ADMIN_TAB.RELIABILITY]: { label: "Reliability", icon: <ActivityIcon /> },
  [ADMIN_TAB.WORKSPACES]: { label: "Workspaces", icon: <Building2Icon /> },
  [ADMIN_TAB.USERS]: { label: "Users", icon: <UsersIcon /> },
} satisfies { readonly [Tab in AdminTab]: Omit<AdminPlace, "tab"> };

export const ADMIN_PLACES: readonly AdminPlace[] = Object.values(ADMIN_TAB).map((tab) => ({
  tab,
  ...PLACE_BY_TAB[tab],
}));

export function adminPlace(tab: AdminTab): AdminPlace {
  return { tab, ...PLACE_BY_TAB[tab] };
}
