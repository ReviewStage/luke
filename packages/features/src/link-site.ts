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

const LINK_SITE_NAME = {
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

const MAX_NAME_CHARS = 60;

const FOLD = "…";

const GOOGLE_HOST = /^(?:(www|maps)\.)?google\.(?:com?\.)?[a-z]{2,3}$/u;

const MAPS_SHORT_HOSTS: ReadonlySet<string> = new Set(["maps.app.goo.gl", "goo.gl"]);

const MAPS_STEP = "maps";

const MAPS_PAGE = {
  PLACE: "place",
  SEARCH: "search",
  DIRECTIONS: "dir",
} as const;

const MAPS_VIEW_STEP = /^(?:@|data=)/u;

const DOCS_HOST = "docs.google.com";
const DOCS_STEP = {
  DOCUMENT: "document",
  SPREADSHEETS: "spreadsheets",
  PRESENTATION: "presentation",
  FORMS: "forms",
} as const;

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/u;

const YOUTUBE_HOSTS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
];

const YOUTUBE_HANDLE = /^@[\p{L}\p{M}\p{N}_.\-·]{1,100}$/u;

const X_HOSTS: readonly string[] = [
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
];

const X_ACCOUNT = /^\w{1,15}$/u;

const X_POST_STEP = "status";

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

const ROUTE_WAYPOINT_SEPARATOR = "|";

const ROUTE_JOIN = " → ";

function spoken(words: string): string {
  return words.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

function named(words: string): string | undefined {
  const name = spoken(words);
  if (name === "") return undefined;
  return name.length <= MAX_NAME_CHARS ? name : `${name.slice(0, MAX_NAME_CHARS - 1)}${FOLD}`;
}

function decodedStep(step: string): string {
  try {
    return decodeURIComponent(step);
  } catch {
    return step;
  }
}

function stepWords(step: string): string {
  return decodedStep(step.replaceAll("+", " "));
}

function routeName(stops: readonly (string | null)[]): string | undefined {
  const said = stops.map((stop) => spoken(stop ?? "")).filter((stop) => stop !== "");
  return said.length === 0 ? undefined : named(said.join(ROUTE_JOIN));
}

function queriedRoute(query: URLSearchParams): readonly (string | null)[] {
  const waypoints = query.get("waypoints")?.split(ROUTE_WAYPOINT_SEPARATOR) ?? [];
  return [query.get("origin"), ...waypoints, query.get("destination")];
}

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

function pathSteps(url: URL): readonly string[] {
  return url.pathname.split("/").filter((step) => step !== "");
}

function onHost(url: URL, hosts: readonly string[]): boolean {
  return hosts.includes(url.hostname.toLowerCase());
}

function onDocs(url: URL, step: string): boolean {
  return url.hostname.toLowerCase() === DOCS_HOST && pathSteps(url)[0] === step;
}

function unnamed(): undefined {
  return undefined;
}

function googleMeetName(url: URL): string | undefined {
  const code = pathSteps(url)[0]?.toLowerCase();
  return code !== undefined && MEET_CODE.test(code) ? code : undefined;
}

function youtubeName(url: URL): string | undefined {
  const [first, ...rest] = pathSteps(url);
  if (first === undefined || rest.length > 1) return undefined;
  const handle = decodedStep(first);
  return YOUTUBE_HANDLE.test(handle) ? named(handle) : undefined;
}

function xName(url: URL): string | undefined {
  const [account, step] = pathSteps(url);
  if (account === undefined || !X_ACCOUNT.test(account)) return undefined;
  if (X_PAGES.has(account.toLowerCase())) return undefined;
  if (step === X_POST_STEP) return `Post by @${account}`;
  return step === undefined ? `@${account}` : undefined;
}

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

export function linkSiteOf(url: URL): LinkSite | undefined {
  return LINK_SITE_LIST.find((site) => SITE_READ[site].isOf(url));
}

export function linkSiteName(site: LinkSite, href: string): string {
  const url = URL.canParse(href) ? new URL(href) : undefined;
  const spelled = url === undefined ? undefined : SITE_READ[site].nameOf(url);
  return spelled ?? LINK_SITE_NAME[site];
}
