#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  PROVIDER_LOCATION_KIND,
} from "../packages/session/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = join(ROOT, "README.md");
const START = "<!-- provider-agents:start -->";
const END = "<!-- provider-agents:end -->";

function generatedTable(): string {
  const rows = PROVIDER_ID_LIST.map((providerId) => {
    const provider = PROVIDER_IDENTITY_BY_ID[providerId];
    const local = provider.location !== PROVIDER_LOCATION_KIND.CLOUD ? "✅" : "";
    const cloud = provider.location !== PROVIDER_LOCATION_KIND.LOCAL ? "✅" : "";
    return `| ${provider.displayName} | ${local} | ${cloud} |`;
  });
  return ["| Agent | Local | Cloud |", "| --- | :---: | :---: |", ...rows].join("\n");
}

function replaceGeneratedBlock(source: string): string {
  const startIndex = source.indexOf(START);
  const endIndex = source.indexOf(END, startIndex + START.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error("README.md is missing its generated provider table markers");
  }
  const before = source.slice(0, startIndex);
  const after = source.slice(endIndex + END.length);
  return `${before}${START}\n${generatedTable()}\n${END}${after}`;
}

const source = readFileSync(README_PATH, "utf8");
const generated = replaceGeneratedBlock(source);
if (process.argv.includes("--check")) {
  if (generated !== source) throw new Error("README.md's provider table is out of date");
} else if (generated !== source) {
  writeFileSync(README_PATH, generated);
}
