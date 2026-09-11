import { glob, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const NODE_TEST_IMPORT =
  /^import\s+(?:(\w+)\s*(?:,\s*\{([^}]+)\})?|\{([^}]+)\})\s+from\s+["']node:test["'];?$/m;

export function transformNodeTestImport(source) {
  const match = NODE_TEST_IMPORT.exec(source);
  if (!match) {
    return source;
  }

  const [full, defaultImport, namedAlongsideDefault, namedOnly] = match;
  const names = [];
  if (defaultImport) {
    names.push(defaultImport);
  }
  for (const named of (namedAlongsideDefault ?? namedOnly ?? "").split(",")) {
    const trimmed = named.trim();
    if (trimmed && !names.includes(trimmed)) {
      names.push(trimmed);
    }
  }

  const replacement = `import { ${names.join(", ")} } from "vitest";`;
  return source.slice(0, match.index) + replacement + source.slice(match.index + full.length);
}

export function needsTransform(source) {
  return NODE_TEST_IMPORT.test(source);
}

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    throw new Error("usage: node scripts/node-test-to-vitest.mjs <glob>");
  }

  let changed = 0;
  for await (const path of glob(pattern)) {
    const source = await readFile(path, "utf8");
    if (!needsTransform(source)) {
      continue;
    }
    await writeFile(path, transformNodeTestImport(source));
    changed += 1;
    process.stdout.write(`rewrote ${path}\n`);
  }
  process.stdout.write(`${changed} file(s) rewritten\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
