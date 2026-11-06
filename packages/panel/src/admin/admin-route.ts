import { ADMIN_LINK_SECTION, type AdminLinkSection } from "@repo/features/link-grammar";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ROUTED_PLACE } from "../route-gates.js";
import { useRoutedLocation } from "../routed-location.js";
import type { AdminViewControl } from "../tasks/use-tasks-tab.js";
import {
  ADMIN_TAB,
  type AdminView,
  adminLinkFields,
  adminSection,
  adminViewOfLink,
} from "./routing.js";

const ADMIN_OVERVIEW: AdminView = { kind: ADMIN_TAB.DASHBOARD };

function sectionOf(segment: string | undefined): AdminLinkSection | undefined {
  return Object.values(ADMIN_LINK_SECTION).find((section) => section === segment);
}

export function useAdminRoute(input: {
  listedSlug: () => string | undefined;
  onClose: () => void;
}): AdminViewControl {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const open = here.place === ROUTED_PLACE.ADMIN;
  const { params } = here;
  const view = open
    ? (adminViewOfLink({
        section: sectionOf(params.section),
        userId: params.userId,
        workspaceId: params.workspaceId,
        day: params.day,
      }) ?? ADMIN_OVERVIEW)
    : ADMIN_OVERVIEW;
  const onOpen = (to: AdminView = ADMIN_OVERVIEW) => {
    const workspace = (open ? params.workspace : undefined) ?? input.listedSlug();
    if (workspace === undefined) return;
    const replace = open && adminSection(view) && adminSection(to);
    const fields = adminLinkFields(to);
    if (fields.userId !== undefined) {
      void navigate({
        to: "/$workspace/admin/user/$userId",
        params: { workspace, userId: fields.userId },
        replace,
      });
    } else if (fields.workspaceId !== undefined) {
      void navigate({
        to: "/$workspace/admin/workspace/$workspaceId",
        params: { workspace, workspaceId: fields.workspaceId },
        replace,
      });
    } else if (fields.day !== undefined) {
      void navigate({
        to: "/$workspace/admin/day/$day",
        params: { workspace, day: fields.day },
        replace,
      });
    } else if (fields.section !== undefined) {
      void navigate({
        to: "/$workspace/admin/$section",
        params: { workspace, section: fields.section },
        replace,
      });
    } else {
      void navigate({ to: "/$workspace/admin", params: { workspace }, replace });
    }
  };
  const onPreload = () => {
    const workspace = input.listedSlug();
    if (workspace !== undefined)
      void router.preloadRoute({ to: "/$workspace/admin", params: { workspace } });
  };
  return { open, view, onOpen, onClose: input.onClose, onPreload };
}
