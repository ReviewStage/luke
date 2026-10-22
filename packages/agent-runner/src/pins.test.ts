/**
 * pins.test.ts -- the runner and the Codex protocol agree with the pins the image installs: the Agent SDK the runner bundles, the `claude` that SDK carries, and the Codex the protocol types were generated from.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { CODEX_PROTOCOL_VERSION } from "./codex-protocol/generated-from.js";
import { CLAUDE_CODE_PIN, CODEX_PIN } from "./pins.js";

const SDK = "@anthropic-ai/claude-agent-sdk";

/** A package manifest as JSON, by its path. */
function manifest(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

it.effect("the runner bundles the Agent SDK the image installs, exactly", () =>
  Effect.sync(() => {
    const runner = manifest(path.join(import.meta.dirname, "..", "package.json"));
    const dependencies = runner.dependencies as Record<string, string>;
    assert.equal(dependencies[SDK], CLAUDE_CODE_PIN.SDK_VERSION);
  }),
);

it.effect("the Agent SDK installed carries the claude the image checks for", () =>
  Effect.sync(() => {
    const entry = createRequire(import.meta.url).resolve(SDK);
    const sdk = manifest(path.join(path.dirname(entry), "package.json"));
    assert.deepEqual(
      [sdk.version, sdk.claudeCodeVersion],
      [CLAUDE_CODE_PIN.SDK_VERSION, CLAUDE_CODE_PIN.VERSION],
    );
  }),
);

it.effect("the Codex protocol types were generated from the Codex the image installs", () =>
  Effect.sync(() => {
    assert.equal(CODEX_PROTOCOL_VERSION, CODEX_PIN.VERSION);
  }),
);
