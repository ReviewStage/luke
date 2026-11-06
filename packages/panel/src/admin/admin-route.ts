/**
 * admin-route.ts -- Admin as the router stands it: whether it stands, the view its address names, and the navigation that opens a view.
 *
 * Admin is a routed place (`panel-router.tsx`) under the workspace the
 * sidebar lists, its view read from its address alone: the Overview at
 * `/<workspace>/admin`, a section at `/admin/<section>`, and an account's, a
 * workspace's, or a day's page beneath. Its sections are one step, each
 * turned in the step's place as Settings' pages are, so Back leaves the
 * place; an account's, a workspace's, or a day's page is a step of its own.
 */

import { ADMIN_LINK_SECTION, type AdminLinkSection } from "@repo/features/link-grammar";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ROUTED_PLACE, useWindowPlace } from "../places/routed-places.js";
import type { AdminViewControl } from "../tasks/use-tasks-tab.js";
import {
  ADMIN_TAB,
  type AdminView,
  adminLinkFields,
  adminSection,
  adminViewOfLink,
} from "./routing.js";

/** The Overview, where Admin opens with no view named. */
const ADMIN_OVERVIEW: AdminView = { kind: ADMIN_TAB.DASHBOARD };

/** The section a segment names; none for one naming no section. */
function sectionOf(segment: string | undefined): AdminLinkSection | undefined {
  return Object.values(ADMIN_LINK_SECTION).find((section) => section === segment);
}

/** Admin as the router stands it, opened under the workspace `listedSlug` names as it is pressed, and left by `onClose`. */
export function useAdminRoute(input: {
  listedSlug: () => string | undefined;
  onClose: () => void;
}): AdminViewControl {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
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
    // A section turned from another stands in its step's place; any other view is a step of its own.
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
