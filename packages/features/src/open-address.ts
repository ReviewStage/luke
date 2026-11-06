import {
  type AccountPlaceKind,
  appLinkOf,
  type LinkPlaceKind,
  readShownLink,
} from "./link-grammar.js";
import { LINK_ORIGIN } from "./link-home.js";

export interface OpenTarget {
  readonly appLink: string;
  readonly kind: LinkPlaceKind | AccountPlaceKind;
}

export function openTargetOf(pathname: string, hash: string, search = ""): OpenTarget | undefined {
  const address = `${LINK_ORIGIN}${pathname.replace(/\/$/u, "")}${search}${hash}`;
  const read = readShownLink(address);
  const appLink = appLinkOf(address);
  return read === undefined || appLink === undefined
    ? undefined
    : { appLink, kind: read.place.kind };
}
