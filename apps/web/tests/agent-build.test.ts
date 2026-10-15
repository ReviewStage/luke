import { readFileSync } from "node:fs";
import { AGENT_EXTERNAL_DEPENDENCIES } from "@luke/service/agents/agent-runtime/build";
import { describe, expect, it } from "vitest";

/**
 * eve refuses an external dependency its agent's `package.json` does not
 * declare, and only on the hosted build, so a name added to the list without
 * its declaration fails the deploy rather than any local check.
 */
describe("the agents' external dependencies", () => {
  for (const agent of ["eve", "coder"]) {
    it(`are each declared by the ${agent} agent's package`, () => {
      const manifest = JSON.parse(
        readFileSync(new URL(`../${agent}/package.json`, import.meta.url), "utf8"),
      ) as { dependencies: Record<string, string> };
      const undeclared = AGENT_EXTERNAL_DEPENDENCIES.filter(
        (name) => manifest.dependencies[name] === undefined,
      );
      expect(undeclared).toEqual([]);
    });
  }
});
