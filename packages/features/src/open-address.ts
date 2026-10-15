import { appLinkOf } from "@luke/features/mention-link";

/**
 * open-address.ts -- what the "Open in Luke" page reads off its address: the plan it is a link to, spelled in the desktop's own scheme.
 *
 * The page is served at every plan's address, `/<workspace>/plan/<id>`, on
 * tryluke.dev and on a preview alike, so its path and fragment are read as
 * the path and fragment of a plan's address on tryluke.dev, whatever host
 * served it, a slash after it let go as the route lets it, and written
 * again in the desktop's scheme by the one module that knows a link's form
 * (`@luke/features/mention-link`). A path that is no plan's opens nothing.
 */

/** The link that opens the plan the page's address names in the desktop app; nothing where the address names no plan. */
export function appLinkFromAddress(pathname: string, hash: string): string | undefined {
  return appLinkOf(`https://tryluke.dev${pathname.replace(/\/$/u, "")}${hash}`);
}
