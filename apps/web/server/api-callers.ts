import { readdir, readFile } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Predicate, Schema } from "effect";
import ts from "typescript";
import { functionAliasPath, HAND_WRITTEN_FUNCTIONS } from "./build-output.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";
import { type Rewrite, readApiRewritesTable } from "./function-rewrites.js";

/**
 * The caller side of the `/api/` routes. The route table is generated and
 * checked (`function-rewrites.ts`), but the constants clients build URLs from
 * were not, so a path constant could outlive its route and nothing failed
 * until production answered 404 (LUKE-186). This reads every `/api/` path a
 * client in the repository spells — the string and template literals of the
 * TypeScript, the string literals of the Swift, the paths in the shell
 * scripts, and the exports of the hosted paths module, evaluated — and
 * resolves each against the committed rewrites table and the extensionless
 * aliases the Build Output emits. A literal that resolves nowhere, a template
 * whose interpolation is not a whole path segment, and a paths-module export
 * that is not a path are each refused by name rather than passed over: a
 * check that silently skipped what it could not read would read as coverage.
 */

/** Where the clients live, relative to the repository root; `packages` stands for every package's `src`. */
const CALLER_ROOTS = ["apps/desktop/src", "apps/ios", "packages", "scripts", "tools"] as const;
const PACKAGES_ROOT = "packages";
const PACKAGE_SOURCE_DIRECTORY = "src";
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", "dist", ".build"]);

/** The one module clients import their paths from; its exports are evaluated as well as read. */
export const PATHS_MODULE = posix.join("packages", "hosted", "src", "service-paths.ts");

const SOURCE_KIND = {
  TYPESCRIPT: "typescript",
  SWIFT: "swift",
  SHELL: "shell",
} as const;
type SourceKind = (typeof SOURCE_KIND)[keyof typeof SOURCE_KIND];

const SOURCE_KIND_BY_EXTENSION: ReadonlyMap<string, SourceKind> = new Map([
  [".ts", SOURCE_KIND.TYPESCRIPT],
  [".tsx", SOURCE_KIND.TYPESCRIPT],
  [".mts", SOURCE_KIND.TYPESCRIPT],
  [".cts", SOURCE_KIND.TYPESCRIPT],
  [".js", SOURCE_KIND.TYPESCRIPT],
  [".mjs", SOURCE_KIND.TYPESCRIPT],
  [".cjs", SOURCE_KIND.TYPESCRIPT],
  [".swift", SOURCE_KIND.SWIFT],
  [".sh", SOURCE_KIND.SHELL],
]);

const SCRIPT_KIND_BY_EXTENSION: ReadonlyMap<string, ts.ScriptKind> = new Map([
  [".tsx", ts.ScriptKind.TSX],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
]);

export const CALLER_KIND = {
  /** A path spelled whole. */
  STATIC: "static",
  /** A path with an id interpolated as a whole segment, or a paths-module function called with one. */
  BUILDER: "builder",
} as const;
type CallerKind = (typeof CALLER_KIND)[keyof typeof CALLER_KIND];

export const RESOLUTION = {
  /** An extensionless alias of a standalone or hand-written function. */
  ALIAS: "alias",
  /** A rewrite of the committed table, the first whose pattern matches. */
  REWRITE: "rewrite",
  /** A base other segments are appended to: one more segment lands on a rewrite. */
  PREFIX: "prefix",
} as const;
type Resolution = (typeof RESOLUTION)[keyof typeof RESOLUTION];

export const REFUSAL = {
  /** Neither the table nor an alias serves the path. */
  NO_ROUTE: "no-route",
  /** A template interpolates something that is not a whole path segment, so the path it builds cannot be read. */
  UNREADABLE_BUILDER: "unreadable-builder",
  /** A paths-module export that is not a path, a table of paths, or a function answering one. */
  NOT_A_PATH: "not-a-path",
} as const;
type Refusal = (typeof REFUSAL)[keyof typeof REFUSAL];

interface CallerSite {
  /** Repository-relative, POSIX separators. */
  readonly file: string;
  readonly line: number;
}

interface CallerPath {
  /** The path as a reader sees it, an interpolated segment shown as `{…}`. */
  readonly display: string;
  /** The path as it is matched, an interpolated segment stood in for by `PROBE_SEGMENT`. */
  readonly probe: string;
  readonly kind: CallerKind;
  readonly sites: readonly CallerSite[];
}

interface ResolvedCaller {
  readonly caller: CallerPath;
  readonly resolution: Resolution;
  /** The alias path, or the rewrite's `src`. */
  readonly route: string;
}

interface RefusedCaller {
  readonly display: string;
  readonly reason: Refusal;
  readonly sites: readonly CallerSite[];
}

export interface ResolvedCallers {
  readonly resolved: readonly ResolvedCaller[];
  readonly refused: readonly RefusedCaller[];
}

export interface CallerReport extends ResolvedCallers {
  readonly filesScanned: number;
  /** How many exported functions of the paths module were called. */
  readonly builderExports: number;
}

/** What stands in for an interpolated id when a built path is matched; `encodeURIComponent` leaves it as it is. */
const PROBE_SEGMENT = "probe";
/** Marks an interpolation inside a scanned literal; no source path carries a NUL. */
const HOLE = "\u0000";
const HOLE_DISPLAY = "{…}";
const PATH_START = "/api/";
const RELATIVE_PATH_START = "api/";
/** Where a path ends inside a literal: a query, a fragment, whitespace, a quote, or a bracket. */
const PATH_END = /[?#\s"'`<>()\\]/u;

/** A literal as scanned: its text with every interpolation replaced by one `HOLE`. */
interface Literal {
  readonly text: string;
  readonly line: number;
}

interface ScannedSite {
  readonly token: string;
  readonly site: CallerSite;
}

/** A relative `api/…` at the start of a literal, or right after an interpolated origin, is the same path. */
function rooted(text: string): string {
  const fromStart = text.startsWith(RELATIVE_PATH_START) ? `/${text}` : text;
  return fromStart.replaceAll(`${HOLE}${RELATIVE_PATH_START}`, `${HOLE}${PATH_START}`);
}

/** Every `/api/` path a literal spells, holes carried through. */
function pathTokens(text: string): readonly string[] {
  const rootedText = rooted(text);
  const tokens: string[] = [];
  let from = 0;
  while (from < rootedText.length) {
    const start = rootedText.indexOf(PATH_START, from);
    if (start === -1) break;
    const afterStart = start + PATH_START.length;
    const endOffset = rootedText.slice(afterStart).search(PATH_END);
    const end = endOffset === -1 ? rootedText.length : afterStart + endOffset;
    tokens.push(rootedText.slice(start, end));
    from = end;
  }
  return tokens;
}

/** Whether every hole in a token stands as a whole segment: between slashes, or after one at the end. */
function holesAreSegments(token: string): boolean {
  for (let index = token.indexOf(HOLE); index !== -1; index = token.indexOf(HOLE, index + 1)) {
    const before = token[index - 1];
    const after = token[index + 1];
    if (before !== "/" || (after !== undefined && after !== "/")) return false;
  }
  return true;
}

function templateText(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((span) => `${HOLE}${span.literal.text}`)].join(
    "",
  );
}

function typeScriptLiterals(source: string, file: string): readonly Literal[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KIND_BY_EXTENSION.get(extname(file)) ?? ts.ScriptKind.TS,
  );
  const literals: Literal[] = [];
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ text: node.text, line: lineOf(node) });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      literals.push({ text: templateText(node), line: lineOf(node) });
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

const LINE_COMMENT = "//";
const BLOCK_COMMENT_OPEN = "/*";
const BLOCK_COMMENT_CLOSE = "*/";
const MULTILINE_QUOTE = '"""';
const INTERPOLATION_OPEN = "\\(";

interface SwiftString {
  readonly text: string;
  /** The index just past the closing quote. */
  readonly end: number;
}

/**
 * The literal starting at `start`, which must be a `"`; escapes are honoured,
 * an interpolation becomes one `HOLE`, and a `"""` literal is read to its
 * own closing `"""`. Answers the text without its quotes.
 */
function readSwiftString(source: string, start: number): SwiftString {
  const quote = source.startsWith(MULTILINE_QUOTE, start) ? MULTILINE_QUOTE : '"';
  let index = start + quote.length;
  let text = "";
  while (index < source.length) {
    if (source.startsWith(INTERPOLATION_OPEN, index)) {
      index = skipSwiftInterpolation(source, index + INTERPOLATION_OPEN.length);
      text += HOLE;
      continue;
    }
    const character = source[index] ?? "";
    if (character === "\\") {
      text += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (source.startsWith(quote, index)) return { text, end: index + quote.length };
    text += character;
    index += 1;
  }
  return { text, end: index };
}

/** From just inside `\(`, the index just past the parenthesis that closes it; a nested string is skipped whole. */
function skipSwiftInterpolation(source: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (character === '"') {
      index = readSwiftString(source, index).end;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    index += 1;
  }
  return index;
}

function countLines(text: string): number {
  return text.split("\n").length - 1;
}

function swiftLiterals(source: string): readonly Literal[] {
  const literals: Literal[] = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const character = source[index];
    if (source.startsWith(LINE_COMMENT, index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith(BLOCK_COMMENT_OPEN, index)) {
      const close = source.indexOf(BLOCK_COMMENT_CLOSE, index + BLOCK_COMMENT_OPEN.length);
      const end = close === -1 ? source.length : close + BLOCK_COMMENT_CLOSE.length;
      line += countLines(source.slice(index, end));
      index = end;
      continue;
    }
    if (character === '"') {
      const read = readSwiftString(source, index);
      literals.push({ text: read.text, line });
      line += countLines(source.slice(index, read.end));
      index = read.end;
      continue;
    }
    if (character === "\n") line += 1;
    index += 1;
  }
  return literals;
}

const SHELL_COMMENT = /^\s*#/u;
const SHELL_PATH = /\/api\/[^\s"'`<>()]*/gu;
const SHELL_EXPANSION = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/gu;

/** A shell script's paths are read line by line, a `$variable` inside one standing as a hole. */
function shellLiterals(source: string): readonly Literal[] {
  return source.split("\n").flatMap((lineText, index) => {
    if (SHELL_COMMENT.test(lineText)) return [];
    return [...lineText.matchAll(SHELL_PATH)].map((match) => ({
      text: match[0].replace(SHELL_EXPANSION, HOLE),
      line: index + 1,
    }));
  });
}

function literalsOf(kind: SourceKind, source: string, file: string): readonly Literal[] {
  switch (kind) {
    case SOURCE_KIND.TYPESCRIPT:
      return typeScriptLiterals(source, file);
    case SOURCE_KIND.SWIFT:
      return swiftLiterals(source);
    case SOURCE_KIND.SHELL:
      return shellLiterals(source);
  }
}

/** The source files under a directory, a skipped directory pruned rather than walked. */
async function sourceFilesUnder(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await sourceFilesUnder(path)));
      continue;
    }
    if (entry.isFile() && SOURCE_KIND_BY_EXTENSION.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

/** The directories scanned under a repository root: every caller root, with `packages` as each package's `src`. */
export async function callerDirectories(repoRoot: string): Promise<readonly string[]> {
  const directories: string[] = [];
  for (const root of CALLER_ROOTS) {
    if (root !== PACKAGES_ROOT) {
      directories.push(root);
      continue;
    }
    const packages = await readdir(join(repoRoot, PACKAGES_ROOT), { withFileTypes: true });
    for (const entry of packages) {
      if (!entry.isDirectory()) continue;
      directories.push(posix.join(PACKAGES_ROOT, entry.name, PACKAGE_SOURCE_DIRECTORY));
    }
  }
  return directories;
}

export interface Scan {
  readonly filesScanned: number;
  readonly sites: readonly ScannedSite[];
}

function repositoryPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join(posix.sep);
}

/** Every `/api/` path spelled in the source files under the given repository-relative directories. */
export async function scanCallers(repoRoot: string, directories: readonly string[]): Promise<Scan> {
  const files = (
    await Promise.all(directories.map((directory) => sourceFilesUnder(join(repoRoot, directory))))
  ).flat();
  const sites: ScannedSite[] = [];
  for (const file of files) {
    const kind = SOURCE_KIND_BY_EXTENSION.get(extname(file));
    if (kind === undefined) continue;
    const relativeFile = repositoryPath(repoRoot, file);
    const source = await readFile(file, "utf8");
    for (const literal of literalsOf(kind, source, relativeFile)) {
      for (const token of pathTokens(literal.text)) {
        sites.push({ token, site: { file: relativeFile, line: literal.line } });
      }
    }
  }
  return { filesScanned: files.length, sites };
}

interface ModuleExport {
  readonly name: string;
  readonly line: number;
  /** Set for a function declaration: how many probe segments to call it with. */
  readonly parameterCount: number | undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The exported declarations of a module, read from its source: what a client can import. */
function moduleExports(source: string, file: string): readonly ModuleExport[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const exports: ModuleExport[] = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      exports.push({
        name: statement.name.text,
        line: lineOf(statement),
        parameterCount: statement.parameters.length,
      });
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        exports.push({
          name: declaration.name.text,
          line: lineOf(declaration),
          parameterCount: undefined,
        });
      }
    }
  }
  return exports;
}

/** An exported function is a builder; what it answers is read as a string at the call, since the module is untyped here. */
const PathBuilder = Schema.declare(Predicate.isFunction);
const PathTable = Schema.Record({ key: Schema.String, value: Schema.String });
const ExportedPaths = Schema.Union(Schema.String, PathTable, PathBuilder);
const isPathTable = Schema.is(PathTable);
const isPathBuilder = Schema.is(PathBuilder);
const decodeExportedPaths = Schema.decodeUnknownOption(ExportedPaths);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeModuleNamespace = Schema.decodeUnknownSync(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

export interface EvaluatedModule {
  /** The paths the module's exports spell or answer, each with the export's own site. */
  readonly sites: readonly ScannedSite[];
  /** Exports the check could not read as paths. */
  readonly refused: readonly RefusedCaller[];
  /** How many exported functions were called. */
  readonly builders: number;
}

/**
 * The paths module's exports, evaluated: each exported string and table of
 * strings is a path, and each exported function is called with one probe
 * segment per parameter and must answer one. Text alone cannot see a builder
 * that composes another (`${brainTurnPath(id)}/cancel` spells no `/api/`), so
 * the module is imported and asked.
 */
export async function evaluatePathsModule(
  repoRoot: string,
  moduleFile: string = PATHS_MODULE,
): Promise<EvaluatedModule> {
  const absolute = join(repoRoot, moduleFile);
  const source = await readFile(absolute, "utf8");
  const namespace = decodeModuleNamespace(await import(pathToFileURL(absolute).href));
  const sites: ScannedSite[] = [];
  const refused: RefusedCaller[] = [];
  let builders = 0;
  for (const exported of moduleExports(source, moduleFile)) {
    const site: CallerSite = { file: moduleFile, line: exported.line };
    const refuse = () =>
      refused.push({
        display: `${moduleFile} export ${exported.name}`,
        reason: REFUSAL.NOT_A_PATH,
        sites: [site],
      });
    const decoded = decodeExportedPaths(namespace[exported.name]);
    if (decoded._tag === "None") {
      refuse();
      continue;
    }
    const value = decoded.value;
    const texts: string[] = [];
    if (isPathBuilder(value)) {
      builders += 1;
      const segments = Array.from({ length: exported.parameterCount ?? 0 }, () => PROBE_SEGMENT);
      const answer = decodeString(value(...segments));
      if (answer._tag === "None") {
        refuse();
        continue;
      }
      texts.push(answer.value.replaceAll(PROBE_SEGMENT, HOLE));
    } else if (isPathTable(value)) {
      texts.push(...Object.values(value));
    } else {
      texts.push(value);
    }
    const tokens = texts.flatMap(pathTokens);
    if (tokens.length === 0) {
      refuse();
      continue;
    }
    for (const token of tokens) sites.push({ token, site });
  }
  return { sites, refused, builders };
}

interface RouteTable {
  readonly rewrites: readonly { readonly rewrite: Rewrite; readonly pattern: RegExp }[];
  readonly aliases: ReadonlySet<string>;
}

/** A rewrite's `src` matches the whole pathname, as Vercel anchors it. */
function routeTable(rewrites: readonly Rewrite[], aliases: readonly string[]): RouteTable {
  return {
    rewrites: rewrites.map((rewrite) => ({
      rewrite,
      pattern: new RegExp(`^${rewrite.src}$`, "u"),
    })),
    aliases: new Set(aliases),
  };
}

function resolveProbe(
  probe: string,
  table: RouteTable,
): { readonly resolution: Resolution; readonly route: string } | undefined {
  if (table.aliases.has(probe)) return { resolution: RESOLUTION.ALIAS, route: probe };
  const rewrite = table.rewrites.find((entry) => entry.pattern.test(probe));
  if (rewrite !== undefined) return { resolution: RESOLUTION.REWRITE, route: rewrite.rewrite.src };
  const base = probe.endsWith("/") ? probe.slice(0, -1) : probe;
  const under = table.rewrites.find((entry) => entry.pattern.test(`${base}/${PROBE_SEGMENT}`));
  if (under !== undefined) return { resolution: RESOLUTION.PREFIX, route: under.rewrite.src };
  return undefined;
}

const byToken = (a: readonly [string, unknown], b: readonly [string, unknown]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

/**
 * Every scanned site resolved against the table and the aliases, the sites
 * of one path gathered under it. An unreadable builder is refused before any
 * matching, since the path it builds is not known.
 */
export function resolveCallers(
  sites: readonly ScannedSite[],
  rewrites: readonly Rewrite[],
  aliases: readonly string[],
): ResolvedCallers {
  const table = routeTable(rewrites, aliases);
  const gathered = new Map<string, CallerSite[]>();
  for (const { token, site } of sites) {
    const tokenSites = gathered.get(token);
    if (tokenSites === undefined) gathered.set(token, [site]);
    else tokenSites.push(site);
  }
  const resolved: ResolvedCaller[] = [];
  const refused: RefusedCaller[] = [];
  for (const [token, tokenSites] of [...gathered.entries()].sort(byToken)) {
    const display = token.replaceAll(HOLE, HOLE_DISPLAY);
    if (!holesAreSegments(token)) {
      refused.push({ display, reason: REFUSAL.UNREADABLE_BUILDER, sites: tokenSites });
      continue;
    }
    const caller: CallerPath = {
      display,
      probe: token.replaceAll(HOLE, PROBE_SEGMENT),
      kind: token.includes(HOLE) ? CALLER_KIND.BUILDER : CALLER_KIND.STATIC,
      sites: tokenSites,
    };
    const answer = resolveProbe(caller.probe, table);
    if (answer === undefined) {
      refused.push({ display, reason: REFUSAL.NO_ROUTE, sites: tokenSites });
      continue;
    }
    resolved.push({ caller, ...answer });
  }
  return { resolved, refused };
}

/** The extensionless paths the Build Output serves beside the rewrites: the standalone functions' and the hand-written one's. */
export async function buildOutputAliases(web: string): Promise<readonly string[]> {
  const standalone = (await webFunctions(web)).filter((definition) => !definition.dispatches);
  return [
    ...standalone.map((definition) => `/${functionAliasPath(functionPublicPath(definition))}`),
    ...HAND_WRITTEN_FUNCTIONS.map((fn) => `/${functionAliasPath(fn.path)}`),
  ].sort();
}

/** The whole check: every caller in the repository against the committed table and the emitted aliases. */
export async function checkApiCallers(input: {
  readonly repoRoot: string;
  readonly web: string;
}): Promise<CallerReport> {
  const [scan, evaluated, rewrites, aliases] = await Promise.all([
    callerDirectories(input.repoRoot).then((directories) =>
      scanCallers(input.repoRoot, directories),
    ),
    evaluatePathsModule(input.repoRoot),
    readApiRewritesTable(input.web),
    buildOutputAliases(input.web),
  ]);
  const { resolved, refused } = resolveCallers(
    [...scan.sites, ...evaluated.sites],
    rewrites,
    aliases,
  );
  return {
    filesScanned: scan.filesScanned,
    builderExports: evaluated.builders,
    resolved,
    refused: [...evaluated.refused, ...refused],
  };
}
