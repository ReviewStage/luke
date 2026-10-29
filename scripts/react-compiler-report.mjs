// react-compiler-report.mjs -- what the React Compiler trial compiles over the panel's and `@luke/ui`'s modules, and what it leaves as written and why, as Markdown.
//
//   node scripts/react-compiler-report.mjs > report.md
//
// Reads every module the builds compile (`lib/react-compiler.mjs`'s scope)
// through the same transform, with the compiler's logger listening, and
// prints the counts, the reasons it bailed out grouped, each component or
// hook it skipped by file and line, and the modules left out by hand.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileReact,
  inReactCompilerScope,
  REACT_COMPILER_LEFT_AS_WRITTEN,
} from "./lib/react-compiler.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["packages/panel/src", "packages/ui/src"];

/** Every module under the roots the compiler reads, by its path from the repository's root. */
async function modulesInScope() {
  const found = [];
  for (const root of ROOTS) {
    const entries = await readdir(path.join(repositoryRoot, root), {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      const file = path.join(entry.parentPath, entry.name);
      if (entry.isFile() && inReactCompilerScope(file)) found.push(file);
    }
  }
  return found.sort();
}

/** The category and one line of why the compiler bailed out, from the detail its logger was handed. */
function reasonOf(event) {
  const detail = event.detail?.options ?? event.detail ?? {};
  const reason = String(detail.reason ?? event.data ?? "Unknown")
    .split("\n")[0]
    .trim();
  return `${detail.category ?? detail.severity ?? event.kind}: ${reason}`;
}

/** Where in the function the compiler found what it bailed out on, and what it said there. */
function placeOf(event) {
  const detail = event.detail?.options ?? event.detail ?? {};
  const first = detail.details?.find((entry) => entry.loc?.start) ?? detail;
  const line = first.loc?.start?.line;
  return line === undefined ? "" : ` (line ${line}${first.message ? `: ${first.message}` : ""})`;
}

/** The component's or hook's name, read off the line its function starts on. */
function nameAt(lines, line) {
  const text = lines[line - 1] ?? "";
  return text.match(/(?:function\s+|const\s+|let\s+)(\w+)/)?.[1] ?? "(anonymous)";
}

/**
 * What the compiler made of one module: how many functions it compiled and
 * skipped on a directive, and each it bailed out of, by the line it starts
 * on, since its logger tells of every rule a function broke.
 */
async function readModule(file) {
  const source = await readFile(file, "utf8");
  const lines = source.split("\n");
  const read = { compiled: 0, ignored: 0, skipped: new Map() };
  const logger = {
    logEvent(_filename, event) {
      if (event.kind === "CompileSuccess") read.compiled += 1;
      else if (event.kind === "CompileSkip") read.ignored += 1;
      else if (event.kind === "CompileError" || event.kind === "PipelineError") {
        const line = event.fnLoc?.start?.line ?? 0;
        const entry = read.skipped.get(line) ?? { line, name: nameAt(lines, line), why: [] };
        entry.why.push(event);
        read.skipped.set(line, entry);
      }
    },
  };
  await compileReact(source, file, { logger });
  return read;
}

/** The report, as Markdown lines, from what each module's read found. */
function reportOf(reads) {
  const skipped = reads.flatMap(({ file, skipped }) =>
    [...skipped.values()].map((entry) => ({ file, ...entry })),
  );
  // A function counts once, under the first reason the compiler gave for it.
  const byReason = new Map();
  for (const entry of skipped) {
    const reason = reasonOf(entry.why[0]);
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const total = (field) => reads.reduce((sum, read) => sum + read[field], 0);
  const out = ["# React Compiler over packages/panel and packages/ui\n"];
  out.push(`- Components and hooks compiled: ${total("compiled")}`);
  out.push(`- Skipped on a bail-out: ${skipped.length}`);
  out.push(`- Skipped on a directive: ${total("ignored")}`);
  out.push(`- Modules left as written by hand: ${REACT_COMPILER_LEFT_AS_WRITTEN.length}\n`);
  out.push("## Bail-outs by first reason\n", "| Functions | Reason |", "| ---: | --- |");
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    out.push(`| ${count} | ${reason.replaceAll("|", "\\|")} |`);
  }
  out.push("\n## Each function skipped\n");
  for (const { file, line, name, why } of skipped) {
    const more = why.length > 1 ? `, and ${why.length - 1} more` : "";
    out.push(`- \`${file}:${line}\` ${name} — ${reasonOf(why[0])}${placeOf(why[0])}${more}`);
  }
  out.push("\n## Modules left as written by hand\n");
  for (const left of REACT_COMPILER_LEFT_AS_WRITTEN) out.push(`- \`${left.slice(1)}\``);
  return out;
}

async function main() {
  const reads = [];
  for (const file of await modulesInScope()) {
    reads.push({ file: path.relative(repositoryRoot, file), ...(await readModule(file)) });
  }
  process.stdout.write(`${reportOf(reads).join("\n")}\n`);
}

await main();
