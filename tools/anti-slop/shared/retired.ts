import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";
import { scanCss } from "./style-guard.ts";

export const RETIRED_GUARD_RULE = "anti-slop/retired";

export const RETIRED_KIND = {
  CLASS: "class",
  GLYPH: "glyph",
  PROP: "prop",
  IMPORT: "import",
} as const;
type RetiredKind = (typeof RETIRED_KIND)[keyof typeof RETIRED_KIND];

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_DIRECTORY = path.join(PLUGIN_DIRECTORY, "retired");

const PREFIX_MARK = "*";

const ICON_DOOR_MODULE = "@repo/ui/icons";
const ICON_DOOR_DIRECTORY = "packages/ui/src/icons/";

export const GLYPH_REGISTRY = "GLYPH";

const NonEmpty = Schema.NonEmptyString;

const BaselineSchema = Schema.Record(NonEmpty, Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)));

const PLACE_FIELDS = {
  allow: Schema.Array(NonEmpty),
  baseline: Schema.optionalKey(BaselineSchema),
};

const ClassEntry = Schema.Struct({ class: NonEmpty, ...PLACE_FIELDS });
const GlyphEntry = Schema.Struct({ glyph: NonEmpty, ...PLACE_FIELDS });
const PropEntry = Schema.Struct({ prop: NonEmpty, ...PLACE_FIELDS });
const ImportEntry = Schema.Struct({
  import: NonEmpty,
  names: Schema.optionalKey(Schema.Array(NonEmpty)),
  ...PLACE_FIELDS,
});

const RetiredFileSchema = Schema.Struct({
  instead: NonEmpty,
  classes: Schema.optionalKey(Schema.Array(ClassEntry)),
  glyphs: Schema.optionalKey(Schema.Array(GlyphEntry)),
  patterns: Schema.optionalKey(Schema.Array(Schema.Union([PropEntry, ImportEntry]))),
});

const decodeRetiredFile = Schema.decodeUnknownSync(Schema.fromJsonString(RetiredFileSchema), {
  onExcessProperty: "error",
});

export interface Retirement {
  readonly kind: RetiredKind;
  readonly name: string;
  readonly names: readonly string[];
  readonly allow: readonly string[];
  readonly baseline: Baseline;
  readonly file: string;
  readonly instead: string;
}

export function parseRetiredFile(file: string, text: string): readonly Retirement[] {
  let decoded: typeof RetiredFileSchema.Type;
  try {
    decoded = decodeRetiredFile(text);
  } catch (cause) {
    throw new Error(`tools/anti-slop/retired/${file} is not a retired file: ${String(cause)}`);
  }
  const shared = { file, instead: decoded.instead };
  const place = (entry: { allow: readonly string[]; baseline?: Baseline }) => ({
    allow: entry.allow,
    baseline: entry.baseline ?? {},
    names: [],
    ...shared,
  });
  return [
    ...(decoded.classes ?? []).map((entry) => ({
      ...place(entry),
      kind: RETIRED_KIND.CLASS,
      name: entry.class,
    })),
    ...(decoded.glyphs ?? []).map((entry) => ({
      ...place(entry),
      kind: RETIRED_KIND.GLYPH,
      name: entry.glyph,
    })),
    ...(decoded.patterns ?? []).map((entry) =>
      "prop" in entry
        ? { ...place(entry), kind: RETIRED_KIND.PROP, name: entry.prop }
        : {
            ...place(entry),
            kind: RETIRED_KIND.IMPORT,
            name: entry.import,
            names: entry.names ?? [],
          },
    ),
  ];
}

export function readRetired(directory: string = RETIRED_DIRECTORY): readonly Retirement[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => parseRetiredFile(name, readFileSync(path.join(directory, name), "utf8")));
}

export const RETIRED: readonly Retirement[] = readRetired();

export function isAllowed(retirement: Retirement, file: string): boolean {
  return retirement.allow.some((prefix) => file.startsWith(prefix));
}

export function matchesClass(retirement: Retirement, token: string): boolean {
  if (retirement.kind !== RETIRED_KIND.CLASS) return false;
  if (!retirement.name.endsWith(PREFIX_MARK)) return token === retirement.name;
  return token.startsWith(retirement.name.slice(0, -PREFIX_MARK.length));
}

function bareGlyph(name: string): string {
  return name.replace(/^Lucide(?=[A-Z])/u, "").replace(/(?<=.)Icon$/u, "");
}

export function matchesGlyph(retirement: Retirement, name: string): boolean {
  if (retirement.kind !== RETIRED_KIND.GLYPH) return false;
  if (retirement.name.startsWith(`${GLYPH_REGISTRY}.`)) return name === retirement.name;
  return bareGlyph(name) === bareGlyph(retirement.name);
}

export function isIconDoor(specifier: string, file: string): boolean {
  if (specifier === ICON_DOOR_MODULE) return true;
  if (!specifier.startsWith(".")) return false;
  const reached = path.posix.join(path.posix.dirname(file), specifier);
  return `${reached}/`.startsWith(ICON_DOOR_DIRECTORY);
}

export function matchesModule(retirement: Retirement, specifier: string): boolean {
  if (retirement.kind !== RETIRED_KIND.IMPORT) return false;
  return specifier === retirement.name || specifier.startsWith(`${retirement.name}/`);
}

export function namesRetired(text: string, retirements: readonly Retirement[] = RETIRED): boolean {
  return retirements.some((retirement) => {
    const name = retirement.name.endsWith(PREFIX_MARK)
      ? retirement.name.slice(0, -PREFIX_MARK.length)
      : retirement.name;
    if (retirement.kind === RETIRED_KIND.IMPORT && retirement.names.length > 0) {
      return retirement.names.some((imported) => text.includes(imported));
    }
    const needle = retirement.kind === RETIRED_KIND.GLYPH ? bareGlyph(name) : name;
    return text.includes(needle.replace(`${GLYPH_REGISTRY}.`, ""));
  });
}

function selectorClasses(selector: string): readonly string[] {
  const bare = selector
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, '""')
    .replace(/\[[^\]]*\]/gu, "[]");
  return [...bare.matchAll(/\.(-?[_a-zA-Z\\](?:\\.|[\w-])*)/gu)].map((match) =>
    (match[1] ?? "").replace(/\\(.)/gu, "$1"),
  );
}

export interface RetiredPlace {
  readonly retirement: Retirement;
  readonly line: number;
  readonly excerpt: string;
}

export function retiredCssPlaces(
  file: string,
  text: string,
  retirements: readonly Retirement[] = RETIRED,
): readonly RetiredPlace[] {
  const places: RetiredPlace[] = [];
  const classes = retirements.filter(
    (retirement) => retirement.kind === RETIRED_KIND.CLASS && !isAllowed(retirement, file),
  );
  if (classes.length === 0) return places;
  for (const block of scanCss(text).blocks) {
    const selector = block.preludes.at(-1);
    if (selector === undefined || selector.startsWith("@")) continue;
    for (const token of selectorClasses(selector)) {
      for (const retirement of classes) {
        if (matchesClass(retirement, token))
          places.push({ retirement, line: block.line, excerpt: selector });
      }
    }
  }
  return places;
}
