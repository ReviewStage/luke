import assert from "node:assert/strict";
import { Schema } from "effect";
import { describe, it } from "vitest";
import {
  INTEGRATION_PROVIDER,
  integrationAccountLabel,
  integrationAccountNames,
  integrationConnectionNameSchema,
  integrationConnectionOf,
  mintIntegrationConnectionName,
} from "./integration-wire.js";

/**
 * The names an account at a provider goes by: a first account is named
 * after its provider, so every name stored before a second was possible
 * keeps naming it; another takes the lowest free place; and nothing that is
 * not a provider and its place reads as a connection, whatever eve or a
 * window sends.
 */

const NOTION = INTEGRATION_PROVIDER.NOTION;

describe("an integration account's connection name", () => {
  it("is the provider's own for a first account, then the lowest free place", () => {
    assert.equal(mintIntegrationConnectionName(NOTION, []), "notion");
    assert.equal(mintIntegrationConnectionName(NOTION, ["notion"]), "notion-2");
    assert.equal(mintIntegrationConnectionName(NOTION, ["notion", "notion-3"]), "notion-2");
    // An account named after the provider that went is the name the next one takes back.
    assert.equal(mintIntegrationConnectionName(NOTION, ["notion-2", "linear"]), "notion");
  });

  it("reads back as its provider and place, and nothing else reads as one", () => {
    assert.deepEqual(integrationConnectionOf("notion"), { provider: NOTION, place: 1 });
    assert.deepEqual(integrationConnectionOf("notion-12"), { provider: NOTION, place: 12 });
    for (const name of [
      "notion-1",
      "notion-0",
      "notion-02",
      "notion__x",
      "Notion",
      "notionx",
      "gmail",
    ]) {
      assert.equal(integrationConnectionOf(name), undefined, name);
      assert.ok(!Schema.is(integrationConnectionNameSchema)(name), name);
    }
  });

  it("is called by its label among its provider's others, or by its place while it has none", () => {
    assert.equal(
      integrationAccountLabel({ connection: "notion-2", label: "Personal" }),
      "Personal",
    );
    assert.equal(integrationAccountLabel({ connection: "notion-3" }), "Account 3");
    assert.equal(integrationAccountLabel({ connection: "notion", label: "  " }), "Account 1");
  });

  it("is told apart by its place where two of a provider's accounts would be called alike", () => {
    assert.deepEqual(
      [
        ...integrationAccountNames([
          { connection: "notion", label: "Work" },
          { connection: "notion-2", label: "Work" },
          { connection: "notion-3", label: "Personal" },
        ]),
      ],
      [
        ["notion", "Work (1)"],
        ["notion-2", "Work (2)"],
        ["notion-3", "Personal"],
      ],
    );
  });

  it("is never called what another is, where a label already reads like a name told apart", () => {
    assert.deepEqual(
      [
        ...integrationAccountNames([
          { connection: "notion", label: "Work" },
          { connection: "notion-2", label: "Work" },
          { connection: "notion-3", label: "Work (1)" },
        ]),
      ],
      [
        ["notion", "Work (1) (1)"],
        ["notion-2", "Work (2)"],
        ["notion-3", "Work (1) (3)"],
      ],
    );
  });
});
