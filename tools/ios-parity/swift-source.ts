/**
 * The iOS app hand-transcribes vocabularies that live in `packages/` as Swift
 * enums, and nothing but a diff can tell whether the transcription still says
 * the same thing. These readers are that diff's Swift half: they lift the raw
 * values out of a declaration by parsing the source, because there is no Swift
 * toolchain in the checks that matter — `./scripts/check.sh` runs on Linux, and
 * the drift has to fail there rather than on a device.
 *
 * Every reader throws when it cannot find what it was asked for. A reader that
 * answered an empty set instead would turn a renamed declaration into a passing
 * test, which is the one failure mode a parity suite cannot afford.
 */

const OPEN = "{";
const CLOSE = "}";

/**
 * Walks Swift source from `start`, which must be the index of an opening brace,
 * and answers the matching body. String literals and comments are skipped
 * rather than counted, so a brace inside either cannot close the body early.
 *
 * `topLevelOnly` replaces every nested body with a newline, which is what makes
 * a case list readable: a computed property's own `switch self { case … }` sits
 * one level down, and its case lines are not the enum's.
 */
function braceMatchedBody(source: string, start: number, topLevelOnly: boolean): string {
  let depth = 0;
  let index = start;
  let collected = "";
  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (character === '"') {
      const literal = readStringLiteral(source, index);
      if (depth === 1 || !topLevelOnly) collected += literal;
      index += literal.length;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === OPEN) depth += 1;
    if (character === CLOSE) {
      depth -= 1;
      if (depth === 0) return collected;
    }
    if (index > start) {
      const inBody = depth === 1 || !topLevelOnly;
      collected += inBody ? character : character === "\n" ? "\n" : "";
    }
    index += 1;
  }
  throw new Error("unbalanced braces: the declaration's body never closes");
}

/** The literal starting at `start`, quotes included, escapes honoured. */
function readStringLiteral(source: string, start: number): string {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (character === '"') break;
  }
  return source.slice(start, index);
}

function bodyOf(source: string, declaration: RegExp, what: string, topLevelOnly: boolean): string {
  const match = declaration.exec(source);
  if (!match) throw new Error(`no ${what} in the Swift source`);
  const opening = match.index + match[0].length - 1;
  return braceMatchedBody(source, opening, topLevelOnly);
}

function splitOutsideQuotes(line: string): readonly string[] {
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/u);
}

const CASE_LINE = /^[ \t]*case[ \t]+(.+)$/gmu;
const CASE_ENTRY = /^\s*`?([A-Za-z_]\w*)`?\s*(?:=\s*"([^"]*)")?\s*$/u;

/**
 * Every raw value of a `enum <name>: String`, in source order. A case with no
 * `= "…"` contributes its own name, which is the raw value Swift derives for
 * it — the way `codex`, `conductor`, and every voice get theirs.
 */
export function swiftEnumRawValues(source: string, name: string): readonly string[] {
  const declaration = new RegExp(
    String.raw`(?:public\s+|private\s+|internal\s+|fileprivate\s+)?enum\s+${name}\s*:\s*String\b[^{]*\{`,
    "u",
  );
  const body = bodyOf(source, declaration, `String-raw-valued enum ${name}`, true);
  const values: string[] = [];
  for (const line of body.matchAll(CASE_LINE)) {
    for (const entry of splitOutsideQuotes(line[1] ?? "")) {
      const parsed = CASE_ENTRY.exec(entry);
      if (!parsed) throw new Error(`${name}: cannot read the case "${entry.trim()}"`);
      values.push(parsed[2] ?? parsed[1] ?? "");
    }
  }
  if (values.length === 0) throw new Error(`${name}: the enum declares no cases`);
  return values;
}

function typeBody(source: string, type: string): string {
  const declaration = new RegExp(
    String.raw`(?:public\s+|private\s+|internal\s+|fileprivate\s+)?(?:final\s+)?(?:enum|struct|class|extension)\s+${type}\b[^{]*\{`,
    "u",
  );
  return bodyOf(source, declaration, `type ${type}`, false);
}

function propertyBody(source: string, type: string, property: string, returns: string): string {
  const body = typeBody(source, type);
  const declaration = new RegExp(
    String.raw`(?:public\s+|private\s+|internal\s+|fileprivate\s+)?var\s+${property}\s*:\s*${returns}\s*\{`,
    "u",
  );
  return bodyOf(body, declaration, `property ${type}.${property}`, false);
}

const SWITCH_CASE = /case\s+\.(\w+)[^:\n]*:\s*(?:"([^"]*)"|(-?[\d.]+))/gu;

/** The string literals a `var <property>: String { switch self { … } }` answers. */
export function swiftSwitchLiterals(
  source: string,
  type: string,
  property: string,
): readonly string[] {
  const body = propertyBody(source, type, property, "String");
  const literals = [...body.matchAll(SWITCH_CASE)].flatMap((match) =>
    match[2] === undefined ? [] : [match[2]],
  );
  if (literals.length === 0) throw new Error(`${type}.${property}: no string literals`);
  return literals;
}

/** The numbers a numeric computed property answers, by the case name answering them. */
export function swiftSwitchNumbers(
  source: string,
  type: string,
  property: string,
  returns: string,
): ReadonlyMap<string, number> {
  const body = propertyBody(source, type, property, returns);
  const numbers = new Map<string, number>();
  for (const match of body.matchAll(SWITCH_CASE)) {
    if (match[3] === undefined || match[1] === undefined) continue;
    numbers.set(match[1], Number(match[3]));
  }
  if (numbers.size === 0) throw new Error(`${type}.${property}: no numeric literals`);
  return numbers;
}

function staticLiteral(source: string, name: string): string {
  const declaration = new RegExp(
    String.raw`static\s+let\s+${name}\s*(?::[^=\n]+)?=\s*(?:"([^"]*)"|(-?[\d.]+))`,
    "gu",
  );
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1) {
    throw new Error(`static let ${name}: expected one declaration, found ${matches.length}`);
  }
  const match = matches[0];
  const value = match?.[1] ?? match?.[2];
  if (value === undefined) throw new Error(`static let ${name}: no literal`);
  return value;
}

/** The string a `static let <name> = "…"` holds. */
export function swiftStaticString(source: string, name: string): string {
  return staticLiteral(source, name);
}

/** The number a `static let <name> = 42` holds. */
export function swiftStaticNumber(source: string, name: string): number {
  const value = Number(staticLiteral(source, name));
  if (Number.isNaN(value)) throw new Error(`static let ${name}: not a number`);
  return value;
}
