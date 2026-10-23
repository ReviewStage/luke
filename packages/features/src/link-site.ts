/**
 * link-site.ts -- the well-known sites a link is drawn as a chip of, though no integration of Luke's stands behind them, and what each one's address says of the page it opens.
 *
 * A link to a page of one of the integrations is a mention of it
 * (`mention-link.ts`), drawn with its provider's mark. A few sites are
 * linked as often and their addresses say as much, a place on Google Maps
 * by its name, a route by its stops, so a link to one is drawn the same
 * way: its site's own mark, and the name its address spells rather than
 * the address. Nothing here reads the page, so a site's short link, which
 * spells nothing, is called by its site's name. A site joins the set only
 * with its brand's own mark beside it (`@luke/ui`'s `provider-mark.tsx`).
 */

/** The well-known sites a link may be a page of. */
export const LINK_SITE = {
  GOOGLE_MAPS: "google-maps",
} as const;

export type LinkSite = (typeof LINK_SITE)[keyof typeof LINK_SITE];

export const LINK_SITE_LIST: readonly LinkSite[] = Object.values(LINK_SITE);

/** Each site's own name, as its brand spells it: what a page of it is called where its address spells nothing better. */
export const LINK_SITE_NAME = {
  [LINK_SITE.GOOGLE_MAPS]: "Google Maps",
} as const satisfies Record<LinkSite, string>;

/** The most characters a page's name keeps before it is cut. */
const MAX_NAME_CHARS = 60;

const FOLD = "…";

/** Google's own hosts in every country, `google.com`, `www.google.co.uk`, `maps.google.de`: the sub-host and the country's domain. */
const GOOGLE_HOST = /^(?:(www|maps)\.)?google\.(?:com?\.)?[a-z]{2,3}$/u;

/** Google Maps's short links, which name no place in their address. */
const MAPS_SHORT_HOSTS: ReadonlySet<string> = new Set(["maps.app.goo.gl", "goo.gl"]);

/** The first step of a Google Maps page's path on Google's own host. */
const MAPS_STEP = "maps";

/** The steps of a Google Maps path that say what the steps after them name. */
const MAPS_PAGE = {
  PLACE: "place",
  SEARCH: "search",
  DIRECTIONS: "dir",
} as const;

/** A step after a Maps page's names that is the view's and no name: its centre and zoom, `@37.8,-122.4,17z`, or its state, `data=…`. */
const MAPS_VIEW_STEP = /^(?:@|data=)/u;

/** What a route's stops are joined with. */
const ROUTE_JOIN = " → ";

/** Words as a name says them: controls and runs of space one space, trimmed. */
function spoken(words: string): string {
  return words.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

/** A name cut to its bound, the cut marked; nothing for one with no words. */
function named(words: string): string | undefined {
  const name = spoken(words);
  if (name === "") return undefined;
  return name.length <= MAX_NAME_CHARS ? name : `${name.slice(0, MAX_NAME_CHARS - 1)}${FOLD}`;
}

/** A Maps path step as words: its `+` a space, as Maps spells one, then decoded where it decodes. */
function stepWords(step: string): string {
  const spaced = step.replaceAll("+", " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** A route's stops as its name: each stop that says something, joined. */
function routeName(stops: readonly (string | null)[]): string | undefined {
  const said = stops.map((stop) => spoken(stop ?? "")).filter((stop) => stop !== "");
  return said.length === 0 ? undefined : named(said.join(ROUTE_JOIN));
}

/** Whether a page is Google Maps's: under `/maps` on Google's own host, anywhere on its `maps.` host, or one of its short links. */
function isGoogleMaps(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (MAPS_SHORT_HOSTS.has(host)) {
    return host !== "goo.gl" || url.pathname.startsWith(`/${MAPS_STEP}/`);
  }
  const google = GOOGLE_HOST.exec(host);
  if (google === null) return false;
  if (google[1] === "maps") return true;
  const first = url.pathname.split("/")[1];
  return first === MAPS_STEP;
}

/**
 * What a Google Maps address says of its page: the place's name, the
 * search's words, or the route's stops, from the path's steps, Maps's own
 * `?api=1` query, or the older `?q=` and `?saddr=&daddr=`; nothing for a
 * bare view or a short link.
 */
function googleMapsName(url: URL): string | undefined {
  const query = url.searchParams;
  const steps = url.pathname.split("/").filter((step) => step !== "");
  const at = steps.indexOf(MAPS_STEP);
  const [page, ...rest] = at === -1 ? steps : steps.slice(at + 1);
  const end = rest.findIndex((step) => MAPS_VIEW_STEP.test(step));
  const stops = (end === -1 ? rest : rest.slice(0, end)).map(stepWords);
  switch (page) {
    case MAPS_PAGE.PLACE:
      return named(stops[0] ?? "");
    case MAPS_PAGE.SEARCH:
      return named(query.get("query") ?? stops[0] ?? "");
    case MAPS_PAGE.DIRECTIONS:
      return routeName(
        query.has("destination") ? [query.get("origin"), query.get("destination")] : stops,
      );
  }
  if (query.has("daddr")) return routeName([query.get("saddr"), query.get("daddr")]);
  return named(query.get("q") ?? "");
}

/** How each site is told by its page's address, and what that address says of the page. */
const SITE_READ = {
  [LINK_SITE.GOOGLE_MAPS]: { isOf: isGoogleMaps, nameOf: googleMapsName },
} as const satisfies Record<
  LinkSite,
  { readonly isOf: (url: URL) => boolean; readonly nameOf: (url: URL) => string | undefined }
>;

/** The well-known site a web page is of; nothing for a page of none. */
export function linkSiteOf(url: URL): LinkSite | undefined {
  return LINK_SITE_LIST.find((site) => SITE_READ[site].isOf(url));
}

/** What a page of `site` at `href` is called: the name its address spells, else its site's own. */
export function linkSiteName(site: LinkSite, href: string): string {
  const url = URL.canParse(href) ? new URL(href) : undefined;
  const spelled = url === undefined ? undefined : SITE_READ[site].nameOf(url);
  return spelled ?? LINK_SITE_NAME[site];
}
