/**
 * link-places.ts -- a task's link places, each declared once with the routes its params are read from: a comment thread, a section, and a page.
 *
 * A link place is a place a link names within a task's own place, or an
 * agent's page, which its step does not stand at: a section and a comment
 * thread open the task's Overview, and a page opens the side panel on it.
 * Its route is where its params are read (`panel-router.tsx`), so a link is
 * opened by matching it on the route tree, whichever door hands it: a press
 * in the window, the desktop's `SHOW_LINK`, or a page loaded at its address.
 *
 * - Opened in the window, its link, canonical as `linkOf` writes it, is
 *   matched here and opened through the Tasks tab's doors, which navigate
 *   once, straight to the step's address, with what it opens in typed
 *   history state (`navigation-history.ts`'s `onVisitTask`), so it never
 *   passes through its own route.
 * - Loaded at its own address, or landed on by the browser on an entry
 *   holding no step, the route standing reads it (`useLinkPlaceLandings`),
 *   and the step then takes the address in place, as every load settles.
 */

import {
  decodedStep,
  LINK_PLACE,
  type LinkPlace,
  type LinkPlaceKind,
  linkOf,
  type ReadLink,
} from "@repo/features/link-grammar";
import {
  type HistoryLocation,
  type RegisteredRouter,
  type RouteIds,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { savesStep } from "../navigation-history.js";
import { type PlaceParams, placeParamsOf } from "./routed-places.js";

/** A route of the panel's tree, by its id. */
type PanelRouteId = RouteIds<RegisteredRouter["routeTree"]>;

/** What a link place reads of an address its route matched: its params, its query as its route's schema read it, and its fragment, without its `#`. */
interface LinkAddress {
  readonly params: PlaceParams;
  readonly search: Readonly<Record<string, unknown>>;
  readonly hash: string;
}

/** A link place's declaration: the kind of place it is, the routes it stands at, and the place it reads there; none where the address is another place of the same route's. */
interface LinkPlaceDeclaration {
  readonly kind: LinkPlaceKind;
  readonly routes: readonly PanelRouteId[];
  readonly read: (at: LinkAddress) => LinkPlace | undefined;
}

/** The thread a task's address names in its query (`?comment=`), as its route's schema reads it. */
function commentOf(search: LinkAddress["search"]): string | undefined {
  const { comment } = search;
  return typeof comment === "string" ? comment : undefined;
}

/**
 * Every link place's declaration. A link place moved onto the router is an
 * entry here beside its route; whatever reads it reads this, so `satisfies`
 * refuses an entry missing an answer.
 */
export const LINK_ROUTED_PLACE = {
  COMMENT: {
    kind: LINK_PLACE.COMMENT,
    routes: ["/places/$workspace/task/$taskId/"],
    read: ({ params, search }) => {
      const threadId = commentOf(search);
      return params.taskId === undefined || threadId === undefined
        ? undefined
        : { kind: LINK_PLACE.COMMENT, planId: params.taskId, threadId };
    },
  },
  SECTION: {
    kind: LINK_PLACE.SECTION,
    routes: ["/places/$workspace/task/$taskId/"],
    // Note that a comment thread named beside a fragment is the comment's link, as `readLink` reads it.
    read: ({ params, search, hash }) => {
      const anchor = decodedStep(hash)?.toLowerCase();
      if (params.taskId === undefined || commentOf(search) !== undefined) return undefined;
      return anchor === undefined || anchor === ""
        ? undefined
        : { kind: LINK_PLACE.SECTION, planId: params.taskId, anchor };
    },
  },
  PAGE: {
    kind: LINK_PLACE.PAGE,
    routes: [
      "/places/$workspace/task/$taskId/page/$pageId",
      "/places/$workspace/agent/$agentId/page/$pageId",
    ],
    // A page of an agent on no task is its page's, under the agent its address names.
    read: ({ params }) => {
      const { taskId, agentId, pageId } = params;
      if (pageId === undefined) return undefined;
      if (taskId !== undefined) return { kind: LINK_PLACE.PAGE, planId: taskId, pageId };
      return agentId === undefined ? undefined : { kind: LINK_PLACE.PAGE, agentId, pageId };
    },
  },
} as const satisfies { readonly [Name in string]: LinkPlaceDeclaration };

const DECLARATIONS: readonly LinkPlaceDeclaration[] = Object.values(LINK_ROUTED_PLACE);

/** The kinds of place a link place's route opens, which a page loaded at its address leaves to it. */
const ROUTED_KINDS: ReadonlySet<LinkPlaceKind> = new Set(DECLARATIONS.map((each) => each.kind));

/** A link a link place's route reads, by the declaration that read it. */
export interface RoutedLink {
  readonly declared: (typeof LINK_ROUTED_PLACE)[keyof typeof LINK_ROUTED_PLACE];
  readonly link: ReadLink;
}

/** What the matching reads of the router: its routes, matched with each one's schema reading the query, and its own reading of a query. */
type LinkRouter = Pick<RegisteredRouter, "matchRoutes" | "options">;

/** The link place at an address, matched on the route tree, by its path, its query, and its fragment, with or without its `#`; none where it stands at no link place's route. */
function routedAt(
  router: LinkRouter,
  pathname: string,
  search: string,
  hash: string,
): RoutedLink | undefined {
  const matches = router.matchRoutes(pathname, router.options.parseSearch(search));
  const leaf = matches.at(-1);
  if (leaf === undefined) return undefined;
  const params = placeParamsOf(matches);
  const at: LinkAddress = { params, search: leaf.search, hash: hash.replace(/^#/u, "") };
  for (const declared of Object.values(LINK_ROUTED_PLACE)) {
    if (!declared.routes.some((id) => id === leaf.routeId)) continue;
    const place = declared.read(at);
    if (place !== undefined && params.workspace !== undefined) {
      return { declared, link: { workspace: params.workspace, place } };
    }
  }
  return undefined;
}

/**
 * The link place a link names, matched on the route tree at its canonical
 * address (`linkOf`), every older spelling read already; none where it is
 * no link place. A link naming no workspace, as a mention's, is matched
 * under `standingIn`, the workspace the window stands under, and still names
 * none, as its doors read it.
 */
export function routedLinkOf(
  router: LinkRouter,
  link: ReadLink,
  standingIn: string | undefined,
): RoutedLink | undefined {
  const under = link.workspace === "" ? standingIn : link.workspace;
  if (under === undefined || under === "") return undefined;
  const url = new URL(linkOf(link.place, under));
  const routed = routedAt(router, url.pathname, url.search, url.hash);
  return routed === undefined
    ? undefined
    : { ...routed, link: { ...routed.link, workspace: link.workspace } };
}

/** Whether a link's place is one a link place's route opens, so a page loaded at its address lands there and leaves the open to it. */
export function opensAtItsRoute(link: ReadLink): boolean {
  return ROUTED_KINDS.has(link.place.kind);
}

/**
 * Opens the link place the router's history lands on, through `open`, as a
 * link to it opens: a page loaded at its address, or the browser landing on
 * an entry holding no step the window saved, once each. An entry holding a
 * step opens nothing, since going to it stands what it saved.
 */
export function useLinkPlaceLandings(open: (link: ReadLink) => void): void {
  const router = useRouter();
  const { history } = router;
  const location = useSyncExternalStore(history.subscribe, () => history.location);
  const landed = useRef<HistoryLocation | undefined>(undefined);
  useEffect(() => {
    if (landed.current === location || savesStep(location)) return;
    landed.current = location;
    const routed = routedAt(router, location.pathname, location.search, location.hash);
    if (routed !== undefined) open(routed.link);
  }, [router, location, open]);
}
