import { expect, test } from "vitest";
import { SEARCH_TIER, type SearchSubject, type SearchTier, searchHit } from "./search-score.js";

/**
 * search-score.test.ts -- a row answers a query in the first tier it meets,
 * a task's key typed whole, its label begun, every word starting a word,
 * every word somewhere, its keywords, then letters in order where it is
 * loose, and the hit marks exactly the stretches that tier landed on.
 */

interface Case {
  readonly name: string;
  readonly subject: SearchSubject;
  readonly query: string;
  /** The tier it meets, or none where nothing finds it. */
  readonly tier: SearchTier | undefined;
  /** What the hit marks in the label, then in each line, as the words it covers. */
  readonly marks?: { readonly label: readonly string[]; readonly lines?: readonly string[][] };
}

const CASES: readonly Case[] = [
  {
    name: "a task's key typed whole, in any case, whatever its name",
    subject: { label: "Fix the login page", lines: ["STAG-42"], key: "STAG-42" },
    query: "stag-42 ",
    tier: SEARCH_TIER.KEY,
    marks: { label: [], lines: [["STAG-42"]] },
  },
  {
    name: "a label the query begins",
    subject: { label: "Theme" },
    query: "the",
    tier: SEARCH_TIER.PREFIX,
    marks: { label: ["The"] },
  },
  {
    name: "a label two words begin, the spaces between them read as one",
    subject: { label: "New task" },
    query: "new  ta",
    tier: SEARCH_TIER.PREFIX,
    marks: { label: ["New ta"] },
  },
  {
    name: "a word started inside the label",
    subject: { label: "Open settings" },
    query: "set",
    tier: SEARCH_TIER.WORD_STARTS,
    marks: { label: ["set"] },
  },
  {
    name: "a word started after a small letter by a capital, as in a name written camel case",
    subject: { label: "fileRow" },
    query: "row",
    tier: SEARCH_TIER.WORD_STARTS,
    marks: { label: ["Row"] },
  },
  {
    name: "each word starting a word, one in the label and one in a line",
    subject: { label: "Fix the login page", lines: ["acme/web"] },
    query: "web log",
    tier: SEARCH_TIER.WORD_STARTS,
    marks: { label: ["log"], lines: [["web"]] },
  },
  {
    name: "a word inside a word",
    subject: { label: "Reset Luke" },
    query: "set",
    tier: SEARCH_TIER.WORDS,
    marks: { label: ["set"] },
  },
  {
    name: "a word only the keywords hold, marking nothing drawn",
    subject: { label: "Theme", keywords: ["Light, dark, or as the Mac is"] },
    query: "dark",
    tier: SEARCH_TIER.KEYWORDS,
    marks: { label: [] },
  },
  {
    name: "letters in order through a loose row's label, each run marked",
    subject: { label: "theme.ts", lines: ["src/theme.ts"], loose: true },
    query: "thm",
    tier: SEARCH_TIER.LOOSE,
    marks: { label: ["th", "m"], lines: [[]] },
  },
  {
    name: "letters in order through a loose row's line, the tightest run taken",
    subject: { label: "notes.md", lines: ["a/xbc/ab_c"], loose: true },
    query: "abc",
    tier: SEARCH_TIER.LOOSE,
    marks: { label: [], lines: [["ab", "c"]] },
  },
  {
    name: "letters in order through a row that is not loose: nothing",
    subject: { label: "Theme" },
    query: "thm",
    tier: undefined,
  },
  {
    name: "fewer than three letters in order through a loose row: nothing",
    subject: { label: "a_x_b", loose: true },
    query: "ab",
    tier: undefined,
  },
  {
    name: "a word one line holds and another none: nothing",
    subject: { label: "Fix the login page", lines: ["acme/web"] },
    query: "login api",
    tier: undefined,
  },
  {
    name: "nothing typed: no search at all",
    subject: { label: "Theme" },
    query: "  ",
    tier: undefined,
  },
];

/** The words each of a text's ranges covers. */
function covered(text: string, ranges: readonly { start: number; end: number }[]): string[] {
  return ranges.map((range) => text.slice(range.start, range.end));
}

test.each(CASES)("$name", ({ subject, query, tier, marks }) => {
  const hit = searchHit(subject, query);
  expect(hit?.tier).toBe(tier);
  if (hit === undefined || marks === undefined) return;
  expect(covered(subject.label, hit.label)).toEqual(marks.label);
  const lines = subject.lines ?? [];
  expect(lines.map((line, index) => covered(line, hit.lines[index] ?? []))).toEqual(
    marks.lines ?? lines.map(() => []),
  );
});

test("every row a tier finds ranks above every row the next tier finds, a label typed whole first, and the rest of a tier in the order given", () => {
  const rows: readonly SearchSubject[] = [
    { label: "Reset Luke" },
    { label: "Theme", keywords: ["the settings of the window"] },
    { label: "Open settings" },
    { label: "Settings sync" },
    { label: "Settings" },
    { label: "Set" },
    { label: "Open a set", loose: true },
  ];
  const ranked = rows
    .map((row) => ({ row, score: searchHit(row, "set")?.score ?? 0 }))
    .filter((each) => each.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((each) => each.row.label);
  expect(ranked).toEqual([
    "Set",
    "Settings sync",
    "Settings",
    "Open settings",
    "Open a set",
    "Reset Luke",
    "Theme",
  ]);
});
