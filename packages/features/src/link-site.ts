/**
 * link-site.ts -- the well-known sites a link is drawn as a chip of, though no integration of Luke's stands behind them, and what each one's address says of the page it opens.
 *
 * A link to a page of one of the integrations is a mention of it
 * (`mention-link.ts`), drawn with its provider's mark. A few sites are
 * linked as often, Google's own apps, YouTube, and X, so a link to one is
 * drawn the same way: its site's own mark, and the name its address
 * spells, a place on Google Maps by its name, a route by its stops, a
 * Meet by its code, a post by its author, rather than the address.
 * Nothing here reads the page, so a page whose address spells nothing of
 * it, a Google Doc's or a short link's, is called by its site's name. A site joins the set only
 * with its brand's own mark beside it (`@luke/ui`'s `provider-mark.tsx`).
 */

/** The well-known sites a link may be a page of. */
export const LINK_SITE = {
  GOOGLE_MAPS: "google-maps",
  GOOGLE_DOCS: "google-docs",
  GOOGLE_SHEETS: "google-sheets",
  GOOGLE_SLIDES: "google-slides",
  GOOGLE_FORMS: "google-forms",
  GOOGLE_DRIVE: "google-drive",
  GOOGLE_CALENDAR: "google-calendar",
  GOOGLE_MEET: "google-meet",
  GMAIL: "gmail",
  YOUTUBE: "youtube",
  X: "x",
} as const;

export type LinkSite = (typeof LINK_SITE)[keyof typeof LINK_SITE];

export const LINK_SITE_LIST: readonly LinkSite[] = Object.values(LINK_SITE);

/** Each site's own name, as its brand spells it: what a page of it is called where its address spells nothing better. */
export const LINK_SITE_NAME = {
  [LINK_SITE.GOOGLE_MAPS]: "Google Maps",
  [LINK_SITE.GOOGLE_DOCS]: "Google Docs",
  [LINK_SITE.GOOGLE_SHEETS]: "Google Sheets",
  [LINK_SITE.GOOGLE_SLIDES]: "Google Slides",
  [LINK_SITE.GOOGLE_FORMS]: "Google Forms",
  [LINK_SITE.GOOGLE_DRIVE]: "Google Drive",
  [LINK_SITE.GOOGLE_CALENDAR]: "Google Calendar",
  [LINK_SITE.GOOGLE_MEET]: "Google Meet",
  [LINK_SITE.GMAIL]: "Gmail",
  [LINK_SITE.YOUTUBE]: "YouTube",
  [LINK_SITE.X]: "X",
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

/** The editors on Google's Docs host, each by the first step of its pages' paths. */
const DOCS_HOST = "docs.google.com";
const DOCS_STEP = {
  DOCUMENT: "document",
  SPREADSHEETS: "spreadsheets",
  PRESENTATION: "presentation",
  FORMS: "forms",
} as const;

/** A Meet's code, as its address spells it: `abc-defg-hij`. */
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/u;

/** YouTube's hosts, its short links' among them. */
const YOUTUBE_HOSTS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
];

/** A YouTube channel's handle, decoded: `@name`, in any script YouTube takes one in. */
const YOUTUBE_HANDLE = /^@[\p{L}\p{M}\p{N}_.\-·]{1,100}$/u;

/** X's hosts, under its old name too. */
const X_HOSTS: readonly string[] = [
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
];

/** An X account's name as its address spells it. */
const X_ACCOUNT = /^\w{1,15}$/u;

/** The step after an account's name that says the next one is a post. */
const X_POST_STEP = "status";

/** X's own pages, whose first step is spelled as an account's could be but names none. */
const X_PAGES: ReadonlySet<string> = new Set([
  "communities",
  "compose",
  "explore",
  "grok",
  "hashtag",
  "home",
  "i",
  "intent",
  "jobs",
  "login",
  "messages",
  "notifications",
  "premium",
  "privacy",
  "search",
  "settings",
  "share",
  "signup",
  "tos",
]);

/** What a route's waypoints are parted by in Maps's `?api=1` query. */
const ROUTE_WAYPOINT_SEPARATOR = "|";

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

/** A path step decoded where it decodes, as it is where it does not. */
function decodedStep(step: string): string {
  try {
    return decodeURIComponent(step);
  } catch {
    return step;
  }
}

/** A Maps path step as words: its `+` a space, as Maps spells one, then decoded. */
function stepWords(step: string): string {
  return decodedStep(step.replaceAll("+", " "));
}

/** A route's stops as its name: each stop that says something, joined. */
function routeName(stops: readonly (string | null)[]): string | undefined {
  const said = stops.map((stop) => spoken(stop ?? "")).filter((stop) => stop !== "");
  return said.length === 0 ? undefined : named(said.join(ROUTE_JOIN));
}

/** A route Maps's `?api=1` query spells: its origin, the waypoints between, `|` apart, and its destination. */
function queriedRoute(query: URLSearchParams): readonly (string | null)[] {
  const waypoints = query.get("waypoints")?.split(ROUTE_WAYPOINT_SEPARATOR) ?? [];
  return [query.get("origin"), ...waypoints, query.get("destination")];
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
 * `?api=1` query, waypoints and all, or the older `?q=` and `?saddr=&daddr=`; nothing for a
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
      return named(query.get("query") ?? query.get("q") ?? stops[0] ?? "");
    case MAPS_PAGE.DIRECTIONS:
      return routeName(query.has("destination") ? queriedRoute(query) : stops);
  }
  if (query.has("daddr")) return routeName([query.get("saddr"), query.get("daddr")]);
  return named(query.get("q") ?? "");
}

/** A page's path's steps, without the empty ones. */
function pathSteps(url: URL): readonly string[] {
  return url.pathname.split("/").filter((step) => step !== "");
}

/** Whether a page is on one of `hosts`. */
function onHost(url: URL, hosts: readonly string[]): boolean {
  return hosts.includes(url.hostname.toLowerCase());
}

/** Whether a page is one of the Docs host's editors' `step`, as `/document/d/…` is a Doc. */
function onDocs(url: URL, step: string): boolean {
  return url.hostname.toLowerCase() === DOCS_HOST && pathSteps(url)[0] === step;
}

/** What an address spells nothing of its page by: nothing, so its site's own name is said. */
function unnamed(): undefined {
  return undefined;
}

/** A Meet called by its code, the one thing its address spells. */
function googleMeetName(url: URL): string | undefined {
  const code = pathSteps(url)[0]?.toLowerCase();
  return code !== undefined && MEET_CODE.test(code) ? code : undefined;
}

/** A YouTube channel called by its handle; any other page of YouTube's spells nothing of itself. */
function youtubeName(url: URL): string | undefined {
  const [first, ...rest] = pathSteps(url);
  if (first === undefined || rest.length > 1) return undefined;
  const handle = decodedStep(first);
  return YOUTUBE_HANDLE.test(handle) ? named(handle) : undefined;
}

/** An X account called by its handle, and one of its posts as its author's; X's own pages spell no one. */
function xName(url: URL): string | undefined {
  const [account, step] = pathSteps(url);
  if (account === undefined || !X_ACCOUNT.test(account)) return undefined;
  if (X_PAGES.has(account.toLowerCase())) return undefined;
  if (step === X_POST_STEP) return `Post by @${account}`;
  return step === undefined ? `@${account}` : undefined;
}

/** How each site is told by its page's address, and what that address says of the page. */
const SITE_READ = {
  [LINK_SITE.GOOGLE_MAPS]: { isOf: isGoogleMaps, nameOf: googleMapsName },
  [LINK_SITE.GOOGLE_DOCS]: { isOf: (url) => onDocs(url, DOCS_STEP.DOCUMENT), nameOf: unnamed },
  [LINK_SITE.GOOGLE_SHEETS]: {
    isOf: (url) => onDocs(url, DOCS_STEP.SPREADSHEETS),
    nameOf: unnamed,
  },
  [LINK_SITE.GOOGLE_SLIDES]: {
    isOf: (url) => onDocs(url, DOCS_STEP.PRESENTATION),
    nameOf: unnamed,
  },
  [LINK_SITE.GOOGLE_FORMS]: {
    isOf: (url) => onDocs(url, DOCS_STEP.FORMS) || onHost(url, ["forms.gle"]),
    nameOf: unnamed,
  },
  [LINK_SITE.GOOGLE_DRIVE]: { isOf: (url) => onHost(url, ["drive.google.com"]), nameOf: unnamed },
  [LINK_SITE.GOOGLE_CALENDAR]: {
    isOf: (url) => onHost(url, ["calendar.google.com", "calendar.app.google"]),
    nameOf: unnamed,
  },
  [LINK_SITE.GOOGLE_MEET]: {
    isOf: (url) => onHost(url, ["meet.google.com"]),
    nameOf: googleMeetName,
  },
  [LINK_SITE.GMAIL]: { isOf: (url) => onHost(url, ["mail.google.com"]), nameOf: unnamed },
  [LINK_SITE.YOUTUBE]: { isOf: (url) => onHost(url, YOUTUBE_HOSTS), nameOf: youtubeName },
  [LINK_SITE.X]: { isOf: (url) => onHost(url, X_HOSTS), nameOf: xName },
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
