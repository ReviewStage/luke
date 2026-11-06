import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDrizzleJson, generateMigration, up } from "drizzle-kit/api-postgres";
import { Schema } from "effect";
import { EFFECT_MIGRATION_FOLDERS } from "../src/core/effect-migration-folders.js";
import * as schema from "../src/schemas/index.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = join(PACKAGE, "migrations");
const MAP_FILE = join(PACKAGE, "src", "core", "effect-migration-folders.ts");
const MIGRATIONS_ON_REF = "packages/database/migrations";
const META = "meta";
const MAP_END = "} as const satisfies Readonly<Record<string, string>>;";

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ when: Schema.Number, tag: Schema.String })),
});
const decodeJournal = Schema.decodeUnknownSync(Schema.fromJsonString(Journal));

function onRef(ref: string, path: string): Buffer {
  return execFileSync("git", ["show", `${ref}:${MIGRATIONS_ON_REF}/${path}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

function folderOf(entry: { readonly when: number; readonly tag: string }): string {
  const stamp = new Date(entry.when).toISOString().replace(/\D/g, "").slice(0, 14);
  return `${stamp}_${entry.tag.split("_").slice(1).join("_")}`;
}

function snapshotIds(): Set<string> {
  return new Set(
    readdirSync(MIGRATIONS)
      .filter((folder) => existsSync(join(MIGRATIONS, folder, "snapshot.json")))
      .map(
        (folder) => JSON.parse(readFileSync(join(MIGRATIONS, folder, "snapshot.json"), "utf8")).id,
      ),
  );
}

type Snapshot = Awaited<ReturnType<typeof generateDrizzleJson>>;

type Entity = Snapshot["ddl"][number];

function renderedText(entity: Entity): string | null | undefined {
  if (entity.entityType === "indexes") return entity.where;
  if (entity.entityType === "checks") return entity.value;
  return undefined;
}

function withText(entity: Entity, text: string | null): Entity {
  if (entity.entityType === "indexes") return { ...entity, where: text };
  if (entity.entityType === "checks" && text !== null) return { ...entity, value: text };
  return entity;
}

async function withRenderedText(upgraded: Snapshot): Promise<Snapshot> {
  const rendered = await generateDrizzleJson(schema);
  const texts = new Map<string, Map<string, string | null>>();
  for (const entity of rendered.ddl) {
    const text = renderedText(entity);
    if (text === undefined) continue;
    const named = texts.get(entity.entityType) ?? new Map<string, string | null>();
    named.set(entity.name, text);
    texts.set(entity.entityType, named);
  }
  const ddl = upgraded.ddl.map((entity) => {
    const text = texts.get(entity.entityType)?.get(entity.name);
    return text === undefined ? entity : withText(entity, text);
  });
  const snapshot = { ...upgraded, ddl };
  const statements = await generateMigration(snapshot, rendered);
  if (statements.length > 0) {
    throw new Error(
      `the schema modules differ from the ref's newest migration by more than rendering:\n${statements.join("\n")}`,
    );
  }
  return snapshot;
}

async function main(ref: string): Promise<void> {
  const journal = decodeJournal(onRef(ref, `${META}/_journal.json`).toString("utf8"));
  const mapped = new Set(Object.keys(EFFECT_MIGRATION_FOLDERS));
  const pending = journal.entries.filter((entry) => !mapped.has(entry.tag));
  const known = snapshotIds();
  const lines: string[] = [];
  const written: string[] = [];
  for (const [index, entry] of pending.entries()) {
    const folder = folderOf(entry);
    const prefix = entry.tag.split("_")[0];
    const { snapshot: upgraded } = up(
      JSON.parse(onRef(ref, `${META}/${prefix}_snapshot.json`).toString("utf8")),
    );
    const snapshot = index === pending.length - 1 ? await withRenderedText(upgraded) : upgraded;
    const parent = snapshot.prevIds.find((id) => known.has(id));
    if (parent === undefined) {
      throw new Error(
        `${entry.tag}'s snapshot descends from ${snapshot.prevIds.join(", ")}, which no folder's snapshot is`,
      );
    }
    if (existsSync(join(MIGRATIONS, folder))) throw new Error(`${folder} already exists`);
    mkdirSync(join(MIGRATIONS, folder));
    writeFileSync(join(MIGRATIONS, folder, "migration.sql"), onRef(ref, `${entry.tag}.sql`));
    writeFileSync(
      join(MIGRATIONS, folder, "snapshot.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
    written.push(join(MIGRATIONS, folder, "snapshot.json"));
    known.add(snapshot.id);
    lines.push(`  ${JSON.stringify(entry.tag)}: ${JSON.stringify(folder)},\n`);
    // biome-ignore lint/suspicious/noConsole: a script's output is its log.
    console.log(`${entry.tag} -> ${folder}`);
  }
  if (lines.length > 0) {
    execFileSync("pnpm", ["exec", "biome", "format", "--write", ...written], { stdio: "inherit" });
    const map = readFileSync(MAP_FILE, "utf8");
    if (!map.includes(MAP_END)) throw new Error(`${MAP_FILE} no longer ends with ${MAP_END}`);
    writeFileSync(MAP_FILE, map.replace(MAP_END, `${lines.join("")}${MAP_END}`));
  }
  rmSync(join(MIGRATIONS, META), { recursive: true, force: true });
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    rmSync(join(MIGRATIONS, file));
  }
  // biome-ignore lint/suspicious/noConsole: a script's output is its log.
  console.log(`${lines.length} converted from ${ref}`);
}

await main(process.argv[2] ?? "origin/main");
