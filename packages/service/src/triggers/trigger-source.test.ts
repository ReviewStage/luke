import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Redacted } from "effect";
import { describe, it } from "vitest";
import { hmacVerifier, integrationFiltersMatch } from "./trigger-source.js";

/**
 * What every trigger source shares: an HMAC signature read in constant time
 * that fails closed, and a trigger's filters read against an event's fields,
 * any value within a field, every field named across them, case aside, and
 * an empty field keeping nothing out. Synthetic secrets and words throughout.
 */

const BODY = new TextEncoder().encode('{"action":"created"}');

describe("an HMAC verifier", () => {
  const verify = hmacVerifier({ header: "X-Signature", encoding: "hex", prefix: "sha256=" });
  const secret = Redacted.make("synthetic-secret");
  const digest = createHmac("sha256", "synthetic-secret").update(BODY).digest("hex");

  it("takes the digest of the body's own bytes under its prefix, the header named in any case", () => {
    assert.equal(verify({ headers: { "x-signature": `sha256=${digest}` } }, BODY, secret), true);
  });

  it("refuses a digest without its prefix, cut short, under a blank secret, or with no header", () => {
    assert.equal(verify({ headers: { "x-signature": digest } }, BODY, secret), false);
    assert.equal(
      verify({ headers: { "x-signature": `sha256=${digest.slice(0, 32)}` } }, BODY, secret),
      false,
    );
    assert.equal(
      verify({ headers: { "x-signature": `sha256=${digest}` } }, BODY, Redacted.make("")),
      false,
    );
    assert.equal(verify({ headers: {} }, BODY, secret), false);
  });
});

describe("a trigger's filters", () => {
  const attributes = { project: ["Storefront"], environment: ["production"], level: ["error"] };

  it("pass an event any of whose values a field names, and every field named, case aside", () => {
    assert.equal(
      integrationFiltersMatch(
        { project: ["api", "STOREFRONT"], level: ["error", "fatal"] },
        attributes,
      ),
      true,
    );
  });

  it("keep out an event one field names none of its values", () => {
    assert.equal(
      integrationFiltersMatch({ project: ["storefront"], environment: ["staging"] }, attributes),
      false,
    );
  });

  it("keep nothing out where absent or empty, and keep out an event that carries no field a filter names", () => {
    assert.equal(integrationFiltersMatch(undefined, attributes), true);
    assert.equal(integrationFiltersMatch({ project: [], environment: [] }, attributes), true);
    assert.equal(
      integrationFiltersMatch({ environment: ["production"] }, { level: ["error"] }),
      false,
    );
  });
});
