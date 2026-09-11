import {
  jsonSchemaGoldenRoot,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import {
  type ActionToolDefinition,
  actionToolDefinitions,
  remoteRealtimeToolDefinitions,
} from "./actions.js";

/**
 * The tool definitions as a model is handed them, recorded whole: the name,
 * the prose, and the parameters the request schema emits. What is held still
 * here is not the wording but the bytes — a provider keys its prompt cache on
 * them — so a description that is genuinely improved is re-recorded under
 * `LUKE_UPDATE_FIXTURES=1` and the diff is what says the cache was spent.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const GOLDEN_PREFIX = { DESKTOP: "tool", REMOTE: "remote-tool" } as const;

function goldenName(prefix: string, definition: ActionToolDefinition): string {
  return `${prefix}-${definition.name}`;
}

const RECORDED: readonly (readonly [string, ActionToolDefinition])[] = [
  ...actionToolDefinitions().map(
    (definition) => [goldenName(GOLDEN_PREFIX.DESKTOP, definition), definition] as const,
  ),
  ...remoteRealtimeToolDefinitions().map(
    (definition) => [goldenName(GOLDEN_PREFIX.REMOTE, definition), definition] as const,
  ),
];

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, definition]) => {
  await settleJsonSchemaGolden(ROOT, name, definition);
});

test("the recorded set is exactly the definitions the catalog produces", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
