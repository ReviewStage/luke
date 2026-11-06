import { LEGACY_APP_WORD } from "@repo/wire";
import { Schema as EffectSchema, Option } from "effect";
import { dateLabel, isDateMoment, isDateRange } from "./date-mention.js";
import {
  INTEGRATION_NAME,
  integrationConnectionNameSchema,
  integrationConnectionOf,
  integrationOfHost,
  integrationProviderSchema,
} from "./integration-wire.js";
import {
  decodedStep,
  encodedPath,
  encodedStep,
  GITHUB_DEFAULT_BRANCH,
  GITHUB_ORIGIN,
  GITHUB_PAGE,
  gitHubFilePageRepositoryOf,
  gitHubPageLink,
  LINK_PLACE,
  type LinkPlace,
  linkOf,
  linkTarget,
  MENTION_SIGIL,
  mentionMarkdownLink,
  readGitHubPage,
  readLabel,
  readLink,
  readSchemeLink,
  SCHEME_LINK_HOST,
  type SchemeLink,
  schemeLinkOf,
  taskNumberOf,
  withTaskId,
} from "./link-grammar.js";
import { isLinkHome } from "./link-home.js";
import { LINK_SITE_LIST, linkSiteName, linkSiteOf } from "./link-site.js";
import { parsedUrl } from "./parsed-url.js";
import { PRODUCT_NAME } from "./product-name.js";
import { DESCRIPTION_SECTION_BOUNDS } from "./task-wire.js";

export const MENTION_KIND = {
  TASK: "plan",
  SECTION: "section",
  FILE: "file",
  FOLDER: "folder",
  SERVER: "server",
  TOOL: "tool",
  LINK: "link",
  PAGE: "page",
  AGENT: "agent",
  PERSON: "person",
  APP: "app",
  DATE: "date",
} as const;

const MENTION_BOUNDS = {
  MAX_TARGET_CHARS: 24_000,
  MAX_ANCHOR_CHARS: DESCRIPTION_SECTION_BOUNDS.MAX_HEADING_CHARS * 2 + 16,
  MAX_TASK_ID_CHARS: 200,
  MAX_PATH_CHARS: 1_000,
  MAX_URL_CHARS: 2_000,
  MAX_LINK_NAME_CHARS: 60,
  MAX_MENTIONS: 20,
} as const;

const APP_STEP = "app";

const APP_STEPS = [APP_STEP, LEGACY_APP_WORD] as const;

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/u;

const DOT_STEPS: ReadonlySet<string> = new Set([".", ".."]);

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["https:", "http:"]);

const SECRET_PARAM = /token|secret|key|sig|auth|pass|code|session|credential/iu;

const KIND_STEP = /^[a-z]{1,8}$/u;

const ANCHOR = /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u;

const ANCHOR_DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;

const COMMIT = /^[0-9a-f]{7,40}$/u;

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/u;

const CLOSING_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/u;

const TICKS = /`+/gu;

const SPACE_CODE = 0x20;
const DELETE_CODE = 0x7f;

const ENCODED_STEP = /%(?:2[Ff]|5[Cc]|2[Ee])/u;

const BLOCK_START_LINE = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$))/u;

const QUOTE_MARKERS = /^(?: {0,3}> ?)+/u;

const INDENTED_LINE = /^(?: {4}|\t)/u;

const LIST_ITEM_LINE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/u;

const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/gu;

const BARE_ADDRESS = /(?<![^\s*_~(])https?:\/\/[^\s<]+/gu;

const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(["?", "!", ".", ",", ":", "*", "_", "~"]);

const taskIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_TASK_ID_CHARS),
);

const thingIdSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_TASK_ID_CHARS),
  EffectSchema.isPattern(/^[A-Za-z0-9_-]+$/u),
);

const pathSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_PATH_CHARS),
  EffectSchema.makeFilter(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      ![...path].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < SPACE_CODE || code === DELETE_CODE;
      }) &&
      !ENCODED_STEP.test(path) &&
      path.split("/").every((step) => step !== ".." && step !== "." && step !== ""),
  ),
);

const lineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

const linesSchema = EffectSchema.Struct({
  commit: EffectSchema.String.check(EffectSchema.isPattern(COMMIT)),
  startLine: lineSchema,
  endLine: lineSchema,
}).check(EffectSchema.makeFilter(({ startLine, endLine }) => startLine <= endLine));

const dateMomentSchema = EffectSchema.String.check(EffectSchema.makeFilter(isDateMoment));

const linkUrlSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_URL_CHARS),
);

const mentionSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.TASK),
    taskId: taskIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SECTION),
    taskId: taskIdSchema,
    anchor: EffectSchema.String.check(
      EffectSchema.isMaxLength(MENTION_BOUNDS.MAX_ANCHOR_CHARS),
      EffectSchema.isPattern(ANCHOR),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.FILE),
    path: pathSchema,
    lines: EffectSchema.optionalKey(linesSchema),
  }),
  EffectSchema.Struct({ kind: EffectSchema.Literal(MENTION_KIND.FOLDER), path: pathSchema }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.SERVER),
    provider: integrationProviderSchema,
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.TOOL),
    provider: integrationProviderSchema,
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
    tool: EffectSchema.String.check(
      EffectSchema.isPattern(TOOL_NAME),
      EffectSchema.makeFilter((name) => !DOT_STEPS.has(name)),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.LINK),
    provider: integrationProviderSchema,
    url: linkUrlSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.LINK),
    site: EffectSchema.Literals(LINK_SITE_LIST),
    url: linkUrlSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PAGE),
    taskId: taskIdSchema,
    pageId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PAGE),
    agentId: thingIdSchema,
    pageId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.AGENT),
    agentId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.PERSON),
    userId: thingIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.APP),
    taskId: taskIdSchema,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MENTION_KIND.DATE),
    start: dateMomentSchema,
    end: EffectSchema.optionalKey(dateMomentSchema),
  }).check(
    EffectSchema.makeFilter(({ start, end }) => end === undefined || isDateRange(start, end)),
  ),
]);

export type Mention = typeof mentionSchema.Type;

export type DescriptionMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.TASK | typeof MENTION_KIND.SECTION }
>;

export type TaskMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PAGE | typeof MENTION_KIND.AGENT }
>;

export type PersonMention = Extract<Mention, { readonly kind: typeof MENTION_KIND.PERSON }>;

export type ServerMention = Extract<Mention, { readonly provider: string }>;

export function isMentionableTool(name: string): boolean {
  return TOOL_NAME.test(name) && !DOT_STEPS.has(name);
}

export type MentionLines = typeof linesSchema.Type;

export interface MentionPlace {
  readonly workspace: string;
  readonly repository: string | null;
}

export interface MentionLink {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly target: string;
}

export interface MentionInWords extends MentionLink {
  readonly mention: Mention;
}

const readMention = EffectSchema.decodeUnknownOption(mentionSchema);

function decodedSteps(steps: readonly string[]): string | undefined {
  const read = steps.map(decodedStep);
  return read.every((step) => step !== undefined) ? read.join("/") : undefined;
}

function decodedPath(steps: readonly string[]): string | undefined {
  return decodedSteps(steps.at(-1) === "" ? steps.slice(0, -1) : steps);
}

function headingAnchor(heading: string): string {
  return heading.toLowerCase().replace(ANCHOR_DROPPED, "").replace(/ /gu, "-");
}

function serverOfSegment(segment: string) {
  const account = integrationConnectionOf(segment);
  if (account === undefined) return { provider: segment };
  return account.place === 1
    ? { provider: account.provider }
    : { provider: account.provider, connection: segment };
}

function schemeFields({ host, steps, hash, search }: SchemeLink) {
  switch (host) {
    case SCHEME_LINK_HOST.FILE:
      return { kind: MENTION_KIND.FILE, path: decodedPath(steps) };
    case SCHEME_LINK_HOST.FOLDER:
      return { kind: MENTION_KIND.FOLDER, path: decodedPath(steps) };
    case SCHEME_LINK_HOST.MCP: {
      const [segment, tool, ...rest] = steps;
      if (rest.length > 0 || hash !== "" || search !== "") return undefined;
      const server = serverOfSegment(segment ?? "");
      if (tool === undefined) return { kind: MENTION_KIND.SERVER, ...server };
      return { kind: MENTION_KIND.TOOL, ...server, tool: decodedStep(tool) };
    }
    case SCHEME_LINK_HOST.DATE: {
      const [start, end, ...rest] = steps;
      if (rest.length > 0 || hash !== "" || search !== "") return undefined;
      const moments = { kind: MENTION_KIND.DATE, start: decodedStep(start ?? "") };
      return end === undefined ? moments : { ...moments, end: decodedStep(end) };
    }
    case SCHEME_LINK_HOST.PLAN: {
      const taskId = decodedStep(steps.join("/"));
      if (hash === "") return { kind: MENTION_KIND.TASK, taskId };
      const heading = decodedStep(hash.slice(1));
      if (heading === undefined || heading === "") return undefined;
      return { kind: MENTION_KIND.SECTION, taskId, anchor: headingAnchor(heading) };
    }
    default:
      return undefined;
  }
}

function placeFields(place: LinkPlace, hash: string) {
  if (taskNumberOf(place) !== undefined) return undefined;
  if (hash !== "" && place.kind !== LINK_PLACE.TASK && place.kind !== LINK_PLACE.SECTION) {
    return undefined;
  }
  switch (place.kind) {
    case LINK_PLACE.TASK:
    case LINK_PLACE.COMMENT:
      return { kind: MENTION_KIND.TASK, taskId: place.planId };
    case LINK_PLACE.SECTION:
      return { kind: MENTION_KIND.SECTION, taskId: place.planId, anchor: place.anchor };
    case LINK_PLACE.PAGE:
      return "planId" in place
        ? { kind: MENTION_KIND.PAGE, taskId: place.planId, pageId: place.pageId }
        : { kind: MENTION_KIND.PAGE, agentId: place.agentId, pageId: place.pageId };
    case LINK_PLACE.AGENT:
      return { kind: MENTION_KIND.AGENT, agentId: place.agentId };
    case LINK_PLACE.PERSON:
      return { kind: MENTION_KIND.PERSON, userId: place.userId };
    default:
      return undefined;
  }
}

function appFields(url: URL) {
  const step = APP_STEPS.map((each) => `/${each}`).find((each) => url.pathname.endsWith(each));
  if (step !== undefined && url.hash === "") {
    const task = new URL(url.href);
    task.pathname = url.pathname.slice(0, -step.length);
    task.search = "";
    const place = readLink(task.href)?.place;
    return place?.kind === LINK_PLACE.TASK && taskNumberOf(place) === undefined
      ? { kind: MENTION_KIND.APP, taskId: place.planId }
      : undefined;
  }
  const place = readLink(url.href)?.place;
  return place === undefined ? undefined : placeFields(place, url.hash);
}

function repositoryFields(target: string, repository: string | null) {
  const own = (named: string) => named.toLowerCase() === repository?.toLowerCase();
  const page = readGitHubPage(target);
  if (page?.kind === GITHUB_PAGE.FOLDER && own(page.repository)) {
    return { kind: MENTION_KIND.FOLDER, path: page.path };
  }
  if (page?.kind === GITHUB_PAGE.FILE && own(page.repository)) {
    const file = { kind: MENTION_KIND.FILE, path: page.path };
    return page.lines === undefined
      ? file
      : { ...file, lines: { commit: page.ref, ...page.lines } };
  }
  const claimed = gitHubFilePageRepositoryOf(target);
  return claimed !== undefined && own(claimed) ? { kind: MENTION_KIND.FILE } : undefined;
}

function withoutCredentials(url: URL): string {
  const kept = new URL(url.href);
  kept.username = "";
  kept.password = "";
  for (const name of [...kept.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) kept.searchParams.delete(name);
  }
  return kept.href;
}

function linkFields(url: URL) {
  if (!WEB_PROTOCOLS.has(url.protocol)) return undefined;
  const address = linkTarget(withoutCredentials(url));
  const provider = integrationOfHost(url.hostname);
  if (provider !== undefined) return { kind: MENTION_KIND.LINK, provider, url: address };
  const site = linkSiteOf(url);
  return site === undefined ? undefined : { kind: MENTION_KIND.LINK, site, url: address };
}

function fieldsOf(target: string, repository: string | null) {
  const scheme = readSchemeLink(target);
  if (scheme !== undefined) return schemeFields(scheme);
  const url = parsedUrl(target);
  if (url === undefined) return undefined;
  if (isLinkHome(url)) return appFields(url);
  return repositoryFields(target, repository) ?? linkFields(url);
}
function insideFence(text: string, at: number): boolean {
  let open: string | undefined;
  let start = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const fence = FENCE_LINE.exec(line)?.[1];
    if (at >= start && at <= end) return open !== undefined || fence !== undefined;
    const closing = CLOSING_FENCE_LINE.exec(line)?.[1];
    if (open === undefined) open = fence;
    else if (closing !== undefined && closing[0] === open[0] && closing.length >= open.length) {
      open = undefined;
    }
    start = end + 1;
  }
  return false;
}

interface TextStretch {
  readonly start: number;
  readonly end: number;
}

function paragraphAt(text: string, at: number): TextStretch {
  let start = 0;
  let end = text.length;
  let lineStart = 0;
  let depth = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const markers = QUOTE_MARKERS.exec(line)?.[0] ?? "";
    const inner = line.slice(markers.length);
    const lineDepth = [...markers].filter((character) => character === ">").length;
    const blank = inner.trim() === "";
    const opens = BLOCK_START_LINE.test(inner) || lineDepth !== depth;
    depth = lineDepth;
    if (lineStart <= at) {
      if (blank) start = lineEnd + 1;
      else if (opens) start = lineStart;
    } else if (blank || opens) {
      end = lineStart - 1;
      break;
    }
    lineStart = lineEnd + 1;
  }
  return { start, end: Math.max(start, end) };
}

function insideSpan(text: string, at: number): boolean {
  const paragraph = paragraphAt(text, at);
  const words = text.slice(paragraph.start, paragraph.end);
  const runs = [...words.matchAll(TICKS)].map((run) => ({
    start: run.index,
    end: run.index + run[0].length,
  }));
  const offset = at - paragraph.start;
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index];
    if (opening === undefined) continue;
    const length = opening.end - opening.start;
    const closing = runs.findIndex((run, later) => later > index && run.end - run.start === length);
    if (closing === -1) continue;
    if (offset >= opening.end && offset < (runs[closing]?.start ?? 0)) return true;
    index = closing;
  }
  return false;
}

function insideIndented(text: string, at: number): boolean {
  const lines = text.split("\n");
  let start = 0;
  let open = true;
  let inList = false;
  for (const line of lines) {
    const end = start + line.length;
    const blank = line.trim() === "";
    const indented = !blank && INDENTED_LINE.test(line);
    if (!blank && !indented) inList = LIST_ITEM_LINE.test(line);
    const code: boolean = indented && !inList && open;
    if (at >= start && at <= end) return code;
    open = blank || code;
    start = end + 1;
  }
  return false;
}

export function insideCode(text: string, at: number): boolean {
  return insideFence(text, at) || insideIndented(text, at) || insideSpan(text, at);
}

function labelEnd(text: string, open: number): number | undefined {
  for (let at = open + 1; at < text.length; at += 1) {
    const character = text[at];
    if (character === "\\") at += 1;
    else if (character === "]") return at;
    else if (character === "\n") return undefined;
  }
  return undefined;
}

export function sectionAnchors(headings: readonly string[]): readonly string[] {
  const taken = new Map<string, number>();
  return headings.map((heading) => {
    const spelled = headingAnchor(heading);
    if (spelled === "") return "";
    let anchor = spelled;
    while (taken.has(anchor)) {
      const count = (taken.get(spelled) ?? 0) + 1;
      taken.set(spelled, count);
      anchor = `${spelled}-${count}`;
    }
    taken.set(anchor, 0);
    return anchor;
  });
}

function repositoryTarget(
  kind: typeof MENTION_KIND.FILE | typeof MENTION_KIND.FOLDER,
  path: string,
  place: MentionPlace,
  lines: MentionLines | undefined,
): string {
  if (place.repository === null) {
    const host = kind === MENTION_KIND.FOLDER ? SCHEME_LINK_HOST.FOLDER : SCHEME_LINK_HOST.FILE;
    return schemeLinkOf(host, `${encodedPath(path)}${kind === MENTION_KIND.FOLDER ? "/" : ""}`);
  }
  const repository = place.repository;
  if (kind === MENTION_KIND.FOLDER) {
    return gitHubPageLink({
      kind: GITHUB_PAGE.FOLDER,
      repository,
      ref: GITHUB_DEFAULT_BRANCH,
      path,
    });
  }
  if (lines === undefined) {
    return gitHubPageLink({ kind: GITHUB_PAGE.FILE, repository, ref: GITHUB_DEFAULT_BRANCH, path });
  }
  const { commit, startLine, endLine } = lines;
  return gitHubPageLink({
    kind: GITHUB_PAGE.FILE,
    repository,
    ref: commit,
    path,
    lines: { startLine, endLine },
  });
}

export function encodeMention(mention: Mention, place: MentionPlace): string {
  const workspace = place.workspace;
  switch (mention.kind) {
    case MENTION_KIND.FILE:
      return repositoryTarget(mention.kind, mention.path, place, mention.lines);
    case MENTION_KIND.FOLDER:
      return repositoryTarget(mention.kind, mention.path, place, undefined);
    case MENTION_KIND.TASK:
      return linkOf({ kind: LINK_PLACE.TASK, planId: mention.taskId }, workspace);
    case MENTION_KIND.SECTION:
      return linkOf(
        { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor },
        workspace,
      );
    case MENTION_KIND.SERVER:
      return schemeLinkOf(SCHEME_LINK_HOST.MCP, mention.connection ?? mention.provider);
    case MENTION_KIND.TOOL:
      return schemeLinkOf(
        SCHEME_LINK_HOST.MCP,
        `${mention.connection ?? mention.provider}/${encodedStep(mention.tool)}`,
      );
    case MENTION_KIND.LINK:
      return linkTarget(mention.url);
    case MENTION_KIND.PAGE:
      return "agentId" in mention
        ? linkOf(
            { kind: LINK_PLACE.PAGE, agentId: mention.agentId, pageId: mention.pageId },
            workspace,
          )
        : linkOf(
            { kind: LINK_PLACE.PAGE, planId: mention.taskId, pageId: mention.pageId },
            workspace,
          );
    case MENTION_KIND.AGENT:
      return linkOf({ kind: LINK_PLACE.AGENT, agentId: mention.agentId }, workspace);
    case MENTION_KIND.PERSON:
      return linkOf({ kind: LINK_PLACE.PERSON, userId: mention.userId }, workspace);
    case MENTION_KIND.APP:
      return `${linkOf({ kind: LINK_PLACE.TASK, planId: mention.taskId }, workspace)}/${APP_STEP}`;
    case MENTION_KIND.DATE:
      return schemeLinkOf(
        SCHEME_LINK_HOST.DATE,
        mention.end === undefined ? mention.start : `${mention.start}/${mention.end}`,
      );
  }
}

export function decodeMention(target: string, repository: string | null): Mention | undefined {
  if (target.length > MENTION_BOUNDS.MAX_TARGET_CHARS) return undefined;
  return Option.getOrUndefined(readMention(fieldsOf(target, repository)));
}

export function pageRepositoryOf(target: string): string | undefined {
  const page = readGitHubPage(target);
  if (page?.kind !== GITHUB_PAGE.FILE && page?.kind !== GITHUB_PAGE.FOLDER) return undefined;
  return page.repository;
}

function withoutControls(words: string): string {
  return [...words]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < SPACE_CODE || code === DELETE_CODE ? " " : character;
    })
    .join("");
}

function readableLink(href: string): string {
  const url = new URL(href);
  const steps = url.pathname
    .split("/")
    .filter((step) => step !== "")
    .map((step) => withoutControls(decodedStep(step) ?? step));
  const kind = steps.length >= 3 && KIND_STEP.test(steps.at(-2) ?? "");
  const kept = steps.slice(kind ? -3 : -2);
  const name = kept.length === 0 ? url.hostname : kept.join("/");
  const bound = MENTION_BOUNDS.MAX_LINK_NAME_CHARS;
  return name.length <= bound ? name : `…${name.slice(-(bound - 1))}`;
}

export function isMentionLabel(label: string): boolean {
  return label.startsWith(MENTION_SIGIL) && label.length > MENTION_SIGIL.length;
}

export function mentionName(label: string): string {
  return isMentionLabel(label) ? label.slice(MENTION_SIGIL.length) : label;
}

const OWN_KINDS: ReadonlySet<Mention["kind"]> = new Set([
  MENTION_KIND.TASK,
  MENTION_KIND.SECTION,
  MENTION_KIND.PAGE,
  MENTION_KIND.AGENT,
  MENTION_KIND.PERSON,
]);

const BARE_NAME = {
  TASK: "Description",
  PAGE: "Page",
  AGENT: "Agent",
  PERSON: "Person",
  APP: PRODUCT_NAME,
} as const;

function linesName(path: string, lines: MentionLines | undefined): string {
  const name = path.split("/").at(-1) ?? path;
  if (lines === undefined) return name;
  const span =
    lines.startLine === lines.endLine
      ? String(lines.startLine)
      : `${lines.startLine}–${lines.endLine}`;
  return `${name}:${span}`;
}

function bareName(mention: Mention): string {
  switch (mention.kind) {
    case MENTION_KIND.TASK:
      return BARE_NAME.TASK;
    case MENTION_KIND.SECTION:
      return mention.anchor;
    case MENTION_KIND.FILE:
      return linesName(mention.path, mention.lines);
    case MENTION_KIND.FOLDER:
      return mention.path.split("/").at(-1) ?? mention.path;
    case MENTION_KIND.SERVER:
      return INTEGRATION_NAME[mention.provider];
    case MENTION_KIND.TOOL:
      return mention.tool;
    case MENTION_KIND.LINK:
      return "site" in mention
        ? linkSiteName(mention.site, mention.url)
        : readableLink(mention.url);
    case MENTION_KIND.PAGE:
      return BARE_NAME.PAGE;
    case MENTION_KIND.AGENT:
      return BARE_NAME.AGENT;
    case MENTION_KIND.PERSON:
      return BARE_NAME.PERSON;
    case MENTION_KIND.APP:
      return BARE_NAME.APP;
    case MENTION_KIND.DATE:
      return dateLabel(mention);
  }
}

export function pastedLinkMention(
  words: string,
  repository: string | null,
): { readonly mention: Mention; readonly name: string } | undefined {
  const address = words.trim();
  if (address === "" || /\s/u.test(address)) return undefined;
  const mention = decodeMention(address, repository);
  if (mention === undefined) return undefined;
  if (mention.kind !== MENTION_KIND.LINK && !OWN_KINDS.has(mention.kind)) return undefined;
  return { mention, name: bareName(mention) };
}

function isBareLabel(label: string, target: string): boolean {
  if (label === "" || label === target) return true;
  const spelled = parsedUrl(label);
  return spelled !== undefined && spelled.href === parsedUrl(target)?.href;
}

export function isBareLink(label: string, target: string): boolean {
  return isBareLabel(label.trim(), target);
}

export function mayNameMention(target: string): boolean {
  if (decodeMention(target, null) !== undefined) return true;
  return parsedUrl(target)?.origin === GITHUB_ORIGIN;
}

export function linkMention(
  label: string,
  target: string,
  repository: string | null,
): { readonly mention: Mention; readonly name: string } | undefined {
  const mention = decodeMention(target, repository);
  if (mention === undefined) return undefined;
  const words = label.trim();
  if (isBareLabel(words, target)) return { mention, name: bareName(mention) };
  return { mention, name: mentionName(words) };
}

export function mentionMarkdown(mention: Mention, name: string, place: MentionPlace): string {
  return mentionMarkdownLink(name, encodeMention(mention, place));
}

function escapedAt(text: string, at: number): boolean {
  let backslashes = 0;
  while (text[at - 1 - backslashes] === "\\") backslashes += 1;
  return backslashes % 2 === 1;
}

function opensPicture(text: string, at: number): boolean {
  if (text[at - 1] !== "!") return false;
  let backslashes = 0;
  while (text[at - 2 - backslashes] === "\\") backslashes += 1;
  return backslashes % 2 === 0;
}

export function mentionLinksIn(text: string): readonly MentionLink[] {
  const found: MentionLink[] = [];
  const opener = `[${MENTION_SIGIL}`;
  for (let at = text.indexOf(opener); at !== -1; at = text.indexOf(opener, at + 1)) {
    if (opensPicture(text, at)) continue;
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(" || insideCode(text, at)) continue;
    const targetEnd = text.indexOf(")", close + 2);
    if (targetEnd === -1) continue;
    const written = text.slice(close + 2, targetEnd);
    if (/\s/u.test(written)) continue;
    const angled = written.length > 2 && written.startsWith("<") && written.endsWith(">");
    const target = angled ? written.slice(1, -1) : written;
    const label = readLabel(text.slice(at + 1, close));
    found.push({ start: at, end: targetEnd + 1, label, target });
    at = targetEnd;
  }
  return found;
}

export function mentionsIn(
  text: string,
  repository: string | null,
  limit: number = MENTION_BOUNDS.MAX_MENTIONS,
): readonly MentionInWords[] {
  const found: MentionInWords[] = [];
  for (const link of mentionLinksIn(text)) {
    if (found.length === limit) break;
    const mention = decodeMention(link.target, repository);
    if (mention !== undefined) found.push({ ...link, mention });
  }
  return found;
}

export function askedInWords(words: string): readonly string[] {
  const agentIds: string[] = [];
  for (const { mention } of mentionsIn(words, null, Number.POSITIVE_INFINITY)) {
    if (
      mention.kind === MENTION_KIND.AGENT &&
      !agentIds.some((id) => id.toLowerCase() === mention.agentId.toLowerCase())
    ) {
      agentIds.push(mention.agentId);
    }
  }
  return agentIds;
}

const TITLE_QUOTES: ReadonlySet<string> = new Set(['"', "'"]);

type DestinationRead = { readonly target: string; readonly at: number } | { readonly stop: number };

const LINE_ENDS: ReadonlySet<string> = new Set(["\n", "\r"]);

function angledDestination(words: string, open: number): DestinationRead {
  for (let at = open + 1; at < words.length; at += 1) {
    const character = words[at] ?? "";
    if (character === ">") return { target: words.slice(open + 1, at), at: at + 1 };
    if (character === "<" || LINE_ENDS.has(character)) break;
    if (character === "\\") {
      if (LINE_ENDS.has(words[at + 1] ?? "")) break;
      at += 1;
    }
  }
  return { stop: open + 1 };
}

function bareDestination(words: string, open: number): DestinationRead {
  let depth = 0;
  let at = open;
  for (; at < words.length; at += 1) {
    const character = words[at] ?? "";
    if (character === "\\") at += 1;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
    else if (character === ")" || /\s/u.test(character)) break;
  }
  return depth > 0 ? { stop: at } : { target: words.slice(open, at), at };
}

function destinationEnd(
  words: string,
  open: number,
): { readonly target: string; readonly end: number } | { readonly stop: number } {
  const read = words[open] === "<" ? angledDestination(words, open) : bareDestination(words, open);
  if ("stop" in read) return read;
  const { target, at } = read;
  if (words[at] === ")") return { target, end: at };
  let titleAt = at;
  while (words[titleAt] === " " || words[titleAt] === "\t") titleAt += 1;
  const quote = words[titleAt] ?? "";
  if (titleAt === at || !TITLE_QUOTES.has(quote) || words.lastIndexOf(quote) <= titleAt) {
    return { stop: at };
  }
  const closing = words.indexOf(quote, titleAt + 1);
  if (words[closing + 1] !== ")") return { stop: at };
  return { target, end: closing + 1 };
}

function bareAddressOf(spelled: string): string {
  let opens = 0;
  let closes = 0;
  for (const character of spelled) {
    if (character === "(") opens += 1;
    else if (character === ")") closes += 1;
  }
  let end = spelled.length;
  while (end > 0) {
    const last = spelled[end - 1] ?? "";
    if (last === ")" && closes > opens) closes -= 1;
    else if (!TRAILING_PUNCTUATION.has(last)) break;
    end -= 1;
  }
  return spelled.slice(0, end);
}

function bareLinksIn(text: string): readonly MentionLink[] {
  return writtenLinksIn(text, false);
}

export function linksIn(text: string): readonly MentionLink[] {
  return [...writtenLinksIn(text, true)].sort((first, second) => first.start - second.start);
}

function writtenLinksIn(text: string, labeled: boolean): readonly MentionLink[] {
  const found: MentionLink[] = [];
  const taken: TextStretch[] = [];
  for (let at = text.indexOf("["); at !== -1; at = text.indexOf("[", at + 1)) {
    if (escapedAt(text, at)) continue;
    const close = labelEnd(text, at);
    if (close === undefined || text[close + 1] !== "(") continue;
    const link = destinationEnd(text, close + 2);
    if (!("end" in link)) continue;
    const picture = opensPicture(text, at);
    taken.push({ start: picture ? at - 1 : at, end: link.end + 1 });
    const label = readLabel(text.slice(at + 1, close));
    if (picture) continue;
    if (labeled) {
      found.push({ start: at, end: link.end + 1, label, target: link.target });
      continue;
    }
    if (isMentionLabel(label) || !isBareLink(label, link.target)) continue;
    found.push({ start: at, end: link.end + 1, label: link.target, target: link.target });
  }
  const isTaken = (start: number) =>
    taken.some((stretch) => start >= stretch.start && start < stretch.end);
  for (const autolink of text.matchAll(AUTOLINK)) {
    if (isTaken(autolink.index)) continue;
    const target = autolink[1] ?? "";
    const end = autolink.index + autolink[0].length;
    taken.push({ start: autolink.index, end });
    found.push({ start: autolink.index, end, label: target, target });
  }
  for (const spelled of text.matchAll(BARE_ADDRESS)) {
    const start = spelled.index;
    if (isTaken(start)) continue;
    const target = bareAddressOf(spelled[0]);
    found.push({ start, end: start + target.length, label: target, target });
  }
  return found.filter((link) => !insideCode(text, link.start));
}

interface NumberedTask {
  readonly workspace: string;
  readonly number: number;
}

export type NumberedTaskIdOf = (task: NumberedTask) => string | undefined;

interface HandedMentionsOptions {
  readonly limit?: number | undefined;
  readonly taskIdOf?: NumberedTaskIdOf | undefined;
}

function numberedTaskOf(target: string): NumberedTask | undefined {
  const read = readLink(target);
  const number = read === undefined ? undefined : taskNumberOf(read.place);
  return read === undefined || number === undefined
    ? undefined
    : { workspace: read.workspace, number };
}

function numberedMention(
  target: string,
  repository: string | null,
  taskIdOf: NumberedTaskIdOf,
): Mention | undefined {
  const read = readLink(target);
  const number = read === undefined ? undefined : taskNumberOf(read.place);
  if (read === undefined || number === undefined) return undefined;
  const taskId = taskIdOf({ workspace: read.workspace, number });
  if (taskId === undefined) return undefined;
  return decodeMention(linkOf(withTaskId(read.place, taskId), read.workspace), repository);
}

export function numberedTasksIn(text: string): readonly NumberedTask[] {
  const found: NumberedTask[] = [];
  for (const link of [...mentionLinksIn(text), ...bareLinksIn(text)]) {
    if (found.length === MENTION_BOUNDS.MAX_MENTIONS) break;
    const task = numberedTaskOf(link.target);
    if (task === undefined) continue;
    const seen = found.some(
      (each) => each.workspace === task.workspace && each.number === task.number,
    );
    if (!seen) found.push(task);
  }
  return found;
}

export function handedMentionsIn(
  text: string,
  repository: string | null,
  { limit = MENTION_BOUNDS.MAX_MENTIONS, taskIdOf }: HandedMentionsOptions = {},
): readonly MentionInWords[] {
  const written = [...mentionLinksIn(text), ...bareLinksIn(text)].sort(
    (first, second) => first.start - second.start,
  );
  const found: MentionInWords[] = [];
  for (const link of written) {
    if (found.length === limit) break;
    const mention =
      decodeMention(link.target, repository) ??
      (taskIdOf === undefined ? undefined : numberedMention(link.target, repository, taskIdOf));
    if (mention === undefined) continue;
    if (isMentionLabel(link.label) || OWN_KINDS.has(mention.kind)) found.push({ ...link, mention });
  }
  return found;
}

export type MemberMention = Extract<
  Mention,
  { readonly kind: typeof MENTION_KIND.PERSON | typeof MENTION_KIND.AGENT }
>;

function namesMember(mention: Mention): mention is MemberMention {
  return mention.kind === MENTION_KIND.PERSON || mention.kind === MENTION_KIND.AGENT;
}

export function memberMentionOf(words: string): MemberMention | undefined {
  const [link] = mentionLinksIn(words);
  const whole = link !== undefined && link.start === 0 && link.end === words.length;
  const mention = decodeMention(whole ? link.target : words, null);
  return mention !== undefined && namesMember(mention) ? mention : undefined;
}

export function withoutMemberLinks(text: string): string {
  let out = "";
  let at = 0;
  for (const found of handedMentionsIn(text, null, { limit: text.length })) {
    if (!namesMember(found.mention)) continue;
    const name = linkMention(found.label, found.target, null)?.name ?? found.label;
    out += `${text.slice(at, found.start)}@${name}`;
    at = found.end;
  }
  return out + text.slice(at);
}

export function linkLabels(words: string): string {
  let said = "";
  let from = 0;
  let open: number | undefined;
  for (let at = 0; at < words.length; at += 1) {
    const character = words[at];
    if (character === "\\") at += 1;
    else if (character === "\n") open = undefined;
    else if (character === "[") open = at;
    else if (character === "]" && open !== undefined) {
      const link = words[at + 1] === "(" ? destinationEnd(words, at + 2) : undefined;
      if (link !== undefined && "end" in link) {
        const label = readLabel(words.slice(open + 1, at));
        said += words.slice(from, open) + (linkMention(label, link.target, null)?.name ?? label);
        from = link.end + 1;
        at = link.end;
      } else if (link !== undefined) {
        at = link.stop - 1;
      }
      open = undefined;
    }
  }
  return said + words.slice(from);
}
