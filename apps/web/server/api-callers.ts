import { readdir, readFile } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { hostedContract } from "@repo/features/contract";
import { getOpenAPIMeta } from "@orpc/openapi";
import { walkProcedureContractsSync } from "@orpc/server";
import { Predicate, Schema } from "effect";
import ts from "typescript";
import { functionAliasPath, HAND_WRITTEN_FUNCTIONS } from "./build-output.js";
import { functionPublicPath, webFunctions } from "./function-layout.js";
import { ORPC_FALLBACK_SRC, type Rewrite, readApiRewritesTable } from "./function-rewrites.js";

const CALLER_ROOTS = ["apps/desktop/src", "packages", "scripts", "tools"] as const;
const PACKAGES_ROOT = "packages";
const CALLEE_PACKAGES: ReadonlySet<string> = new Set(["service"]);
const PACKAGE_SOURCE_DIRECTORY = "src";
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", "dist"]);

export const PATHS_MODULE = posix.join("packages", "features", "src", "service-paths.ts");

const SOURCE_KIND = {
  TYPESCRIPT: "typescript",
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
  [".sh", SOURCE_KIND.SHELL],
]);

const SCRIPT_KIND_BY_EXTENSION: ReadonlyMap<string, ts.ScriptKind> = new Map([
  [".tsx", ts.ScriptKind.TSX],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
]);

export const CALLER_KIND = {
  STATIC: "static",
  BUILDER: "builder",
} as const;
type CallerKind = (typeof CALLER_KIND)[keyof typeof CALLER_KIND];

export const RESOLUTION = {
  ALIAS: "alias",
  REWRITE: "rewrite",
  PROCEDURE: "procedure",
  PREFIX: "prefix",
} as const;
type Resolution = (typeof RESOLUTION)[keyof typeof RESOLUTION];

const REFUSAL = {
  NO_ROUTE: "no-route",
  UNREADABLE_BUILDER: "unreadable-builder",
  NOT_A_PATH: "not-a-path",
} as const;
type Refusal = (typeof REFUSAL)[keyof typeof REFUSAL];

interface CallerSite {
  readonly file: string;
  readonly line: number;
}

interface CallerPath {
  readonly display: string;
  readonly probe: string;
  readonly kind: CallerKind;
  readonly sites: readonly CallerSite[];
}

interface ResolvedCaller {
  readonly caller: CallerPath;
  readonly resolution: Resolution;
  readonly route: string;
}

interface RefusedCaller {
  readonly display: string;
  readonly reason: Refusal;
  readonly sites: readonly CallerSite[];
}

interface ResolvedCallers {
  readonly resolved: readonly ResolvedCaller[];
  readonly refused: readonly RefusedCaller[];
}

export interface CallerReport extends ResolvedCallers {
  readonly filesScanned: number;
  readonly builderExports: number;
}

export const PROBE_SEGMENT = "probe";
const HOLE = "\u0000";
const HOLE_DISPLAY = "{…}";
const PATH_START = "/api/";
const RELATIVE_PATH_START = "api/";
const PATH_END = /[?#\s"'`<>()\\]/u;

interface Literal {
  readonly text: string;
  readonly line: number;
}

interface ScannedSite {
  readonly token: string;
  readonly site: CallerSite;
}

const SCHEME_END = "://";

function insideForeignPath(text: string, start: number): boolean {
  const scheme = text.lastIndexOf(SCHEME_END, start);
  if (scheme === -1 || text.slice(scheme, start).search(PATH_END) !== -1) return false;
  const hostEnd = text.indexOf("/", scheme + SCHEME_END.length);
  return hostEnd !== -1 && hostEnd < start;
}

function rooted(text: string): string {
  const fromStart = text.startsWith(RELATIVE_PATH_START) ? `/${text}` : text;
  return fromStart.replaceAll(`${HOLE}${RELATIVE_PATH_START}`, `${HOLE}${PATH_START}`);
}

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
    if (!insideForeignPath(rootedText, start)) tokens.push(rootedText.slice(start, end));
    from = end;
  }
  return tokens;
}

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

const SHELL_COMMENT = /^\s*#/u;
const SHELL_PATH = /\/api\/[^\s"'`<>()]*/gu;
const SHELL_EXPANSION = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/gu;

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
    case SOURCE_KIND.SHELL:
      return shellLiterals(source);
  }
}

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

async function callerDirectories(repoRoot: string): Promise<readonly string[]> {
  const directories: string[] = [];
  for (const root of CALLER_ROOTS) {
    if (root !== PACKAGES_ROOT) {
      directories.push(root);
      continue;
    }
    const packages = await readdir(join(repoRoot, PACKAGES_ROOT), { withFileTypes: true });
    for (const entry of packages) {
      if (!entry.isDirectory() || CALLEE_PACKAGES.has(entry.name)) continue;
      const contents = await readdir(join(repoRoot, PACKAGES_ROOT, entry.name), {
        withFileTypes: true,
      });
      if (!contents.some((child) => child.name === PACKAGE_SOURCE_DIRECTORY)) continue;
      directories.push(posix.join(PACKAGES_ROOT, entry.name, PACKAGE_SOURCE_DIRECTORY));
    }
  }
  return directories;
}

interface Scan {
  readonly filesScanned: number;
  readonly sites: readonly ScannedSite[];
}

function repositoryPath(repoRoot: string, file: string): string {
  return relative(repoRoot, file).split(sep).join(posix.sep);
}

async function scanCallers(repoRoot: string, directories: readonly string[]): Promise<Scan> {
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
  readonly parameterCount: number | undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

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

type PathBuilderCall = (...segments: readonly string[]) => unknown;
const PathBuilder = Schema.declare((input: unknown): input is PathBuilderCall =>
  Predicate.isFunction(input),
);
const PathTable = Schema.Record(Schema.String, Schema.String);
const ExportedPaths = Schema.Union([Schema.String, PathTable, PathBuilder]);
const isPathTable = Schema.is(PathTable);
const isPathBuilder = Schema.is(PathBuilder);
const decodeExportedPaths = Schema.decodeUnknownOption(ExportedPaths);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeModuleNamespace = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Unknown),
);

interface EvaluatedModule {
  readonly sites: readonly ScannedSite[];
  readonly refused: readonly RefusedCaller[];
  readonly builders: number;
}

async function evaluatePathsModule(
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

export interface ProcedureRoute {
  readonly key: readonly string[];
  readonly method: string;
  readonly path: string;
}

const DEFAULT_PROCEDURE_METHOD = "POST";

export function hostedProcedureRoutes(): readonly ProcedureRoute[] {
  const routes: ProcedureRoute[] = [];
  walkProcedureContractsSync(hostedContract, (contract, key) => {
    const meta = getOpenAPIMeta(contract);
    if (meta?.path === undefined || meta.prefix !== undefined) {
      throw new Error(`the hosted procedure ${key.join(".")} names no public path of its own`);
    }
    routes.push({ key, method: meta.method ?? DEFAULT_PROCEDURE_METHOD, path: meta.path });
  });
  return routes;
}

const PATH_PARAMETER = /^\{(\+?)[^{}]+\}$/u;

function procedurePattern(path: string): RegExp {
  const segments = path.split("/").map((segment) => {
    const parameter = PATH_PARAMETER.exec(segment);
    if (parameter === null) return segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return parameter[1] === "+" ? ".+" : "[^/]+";
  });
  return new RegExp(`^${segments.join("/")}$`, "u");
}

interface RouteTable {
  readonly rewrites: readonly { readonly rewrite: Rewrite; readonly pattern: RegExp }[];
  readonly procedures: readonly { readonly path: string; readonly pattern: RegExp }[];
  readonly aliases: ReadonlySet<string>;
}

function routeTable(
  rewrites: readonly Rewrite[],
  procedures: readonly ProcedureRoute[],
  aliases: readonly string[],
): RouteTable {
  return {
    rewrites: rewrites
      .filter((rewrite) => rewrite.src !== ORPC_FALLBACK_SRC)
      .map((rewrite) => ({ rewrite, pattern: new RegExp(`^${rewrite.src}$`, "u") })),
    procedures: procedures.map((procedure) => ({
      path: procedure.path,
      pattern: procedurePattern(procedure.path),
    })),
    aliases: new Set(aliases),
  };
}

function servedBy(
  probe: string,
  table: RouteTable,
): { readonly resolution: Resolution; readonly route: string } | undefined {
  const rewrite = table.rewrites.find((entry) => entry.pattern.test(probe));
  if (rewrite !== undefined) return { resolution: RESOLUTION.REWRITE, route: rewrite.rewrite.src };
  const procedure = table.procedures.find((entry) => entry.pattern.test(probe));
  if (procedure !== undefined) return { resolution: RESOLUTION.PROCEDURE, route: procedure.path };
  return undefined;
}

function resolveProbe(
  probe: string,
  table: RouteTable,
): { readonly resolution: Resolution; readonly route: string } | undefined {
  if (table.aliases.has(probe)) return { resolution: RESOLUTION.ALIAS, route: probe };
  const served = servedBy(probe, table);
  if (served !== undefined) return served;
  const base = probe.endsWith("/") ? probe.slice(0, -1) : probe;
  const under = servedBy(`${base}/${PROBE_SEGMENT}`, table);
  if (under !== undefined) return { resolution: RESOLUTION.PREFIX, route: under.route };
  return undefined;
}

const byToken = (a: readonly [string, unknown], b: readonly [string, unknown]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

function resolveCallers(
  sites: readonly ScannedSite[],
  rewrites: readonly Rewrite[],
  procedures: readonly ProcedureRoute[],
  aliases: readonly string[],
): ResolvedCallers {
  const table = routeTable(rewrites, procedures, aliases);
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

async function buildOutputAliases(web: string): Promise<readonly string[]> {
  const standalone = (await webFunctions(web)).filter((definition) => !definition.dispatches);
  return [
    ...standalone.map((definition) => `/${functionAliasPath(functionPublicPath(definition))}`),
    ...HAND_WRITTEN_FUNCTIONS.map((fn) => `/${functionAliasPath(fn.path)}`),
  ].sort();
}

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
    hostedProcedureRoutes(),
    aliases,
  );
  return {
    filesScanned: scan.filesScanned,
    builderExports: evaluated.builders,
    resolved,
    refused: [...evaluated.refused, ...refused],
  };
}
