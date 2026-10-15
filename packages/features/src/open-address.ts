import { LINK_ORIGIN } from "./link-home.js";
import { appLinkOf, type LinkPlaceKind, readLink } from "./luke-link.js";

/**
 * open-address.ts -- what the "Open in Luke" page reads off its address: the place it is a link to, spelled in the desktop's own scheme.
 *
 * The page is served at every place's address, `/<workspace>/<kind>/…`, on
 * Luke's home and on a preview alike, so its path and fragment are read as
 * the path and fragment of a link on the home, whatever host served it, a
 * slash after it let go as the route lets it, and written again in the
 * desktop's scheme by the one module that knows a link's form
 * (`@luke/features/luke-link`). A picture's address,
 * `/<workspace>/plan/<id>/files/<picture>`, opens the plan it is of, and the
 * page shows nothing of the picture. A path that names no place opens nothing.
 */

/** What the page hands the app: the link in the app's own scheme, and the kind of place it opens, which the page names. */
export interface OpenTarget {
  readonly appLink: string;
  readonly kind: LinkPlaceKind;
}

/** The place the page's address names, and the link that opens it in the desktop app; nothing where the address names no place. */
export function openTargetOf(pathname: string, hash: string): OpenTarget | undefined {
  const address = `${LINK_ORIGIN}${pathname.replace(/\/$/u, "")}${hash}`;
  const read = readLink(address);
  const appLink = appLinkOf(address);
  return read === undefined || appLink === undefined
    ? undefined
    : { appLink, kind: read.place.kind };
}
