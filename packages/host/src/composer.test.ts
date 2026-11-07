import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { GATEWAY_METHOD } from "@repo/gateway";
import { Effect, Result } from "effect";
import { DuplicateGatewayMethod, DuplicateHostAct, foldActs, foldMethods } from "./composer.js";

/**
 * Which composer answers a name is a fact about the split, so a second claim
 * fails the fold rather than replacing the first, for an act as for a method,
 * the host's own methods among them.
 */

const answered = () => Effect.succeed(undefined);

describe("the composers' tables folded into the host's", () => {
  it("refuse an act two composers claim", () => {
    const folded = foldActs([
      { INSTALLED_SKILLS_READ: answered, INSTALLED_SKILLS_REMOVE: answered },
      { INSTALLED_SKILLS_READ: answered },
    ]);
    assert.deepEqual(
      Result.isFailure(folded) && folded.failure,
      new DuplicateHostAct({ act: "INSTALLED_SKILLS_READ" }),
    );
  });

  it("refuse a composer's claim on a method the host answers itself", () => {
    const folded = foldMethods([
      { [GATEWAY_METHOD.SHUTDOWN]: answered },
      { [GATEWAY_METHOD.CLIENT_BOOTSTRAP]: answered, [GATEWAY_METHOD.SHUTDOWN]: answered },
    ]);
    assert.deepEqual(
      Result.isFailure(folded) && folded.failure,
      new DuplicateGatewayMethod({ method: GATEWAY_METHOD.SHUTDOWN }),
    );
  });
});
