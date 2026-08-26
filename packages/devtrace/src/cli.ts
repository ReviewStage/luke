/**
 * Turns a recorded trace into the JSON unbox-ai opens:
 *
 *   pnpm --filter @sidecar/devtrace export <trace.jsonl> [out.json]
 *   npx unbox-ai out.json
 *
 * Reading and writing stay on this machine; the viewer the output is meant
 * for runs locally too.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unboxTraceFromLines } from "./unbox-export.js";

const [source, destination] = process.argv.slice(2);
if (!source) {
  process.stderr.write("Usage: export <trace.jsonl> [out.json]\n");
  process.exit(1);
}

// pnpm runs a script with the owning package as its working directory — the
// workspace root for the `trace:export` alias, this package for `--filter` —
// not where the command was typed, so a relative path resolved against the
// process's own cwd lands inside the repository. INIT_CWD is pnpm's record
// of where the developer actually stood.
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const sourcePath = path.resolve(invocationDirectory, source);
const lines = (await readFile(sourcePath, "utf8")).split("\n");
const trace = unboxTraceFromLines(lines, { name: path.basename(sourcePath, ".jsonl") });
const document = `${JSON.stringify(trace, undefined, 2)}\n`;
if (destination) {
  const destinationPath = path.resolve(invocationDirectory, destination);
  await writeFile(destinationPath, document);
  process.stderr.write(`Wrote ${destinationPath}\n`);
} else {
  process.stdout.write(document);
}
