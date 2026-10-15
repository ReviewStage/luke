import { readFileSync } from "node:fs";
import { AGENT_EXTERNAL_DEPENDENCIES } from "@luke/service/agents/agent-runtime/build";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ dependencies: Schema.Record(Schema.String, Schema.String) }),
  ),
);

/**
 * eve refuses an external dependency its agent's `package.json` does not
 * declare, and only on the hosted build, so a name added to the list without
 * its declaration fails the deploy rather than any local check.
 */
describe("the agents' external dependencies", () => {
  for (const manifestPath of ["../../luke/package.json", "../../dev/package.json"]) {
    it(`are each declared by ${manifestPath}`, () => {
      const manifest = decodeManifest(readFileSync(new URL(manifestPath, import.meta.url), "utf8"));
      const undeclared = AGENT_EXTERNAL_DEPENDENCIES.filter(
        (name) => manifest.dependencies[name] === undefined,
      );
      expect(undeclared).toEqual([]);
    });
  }
});
