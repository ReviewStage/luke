import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { declaredWrite } from "./door.js";
import { entityPool, type FieldChange, fieldKind, type WriteDeclaration } from "./entity-pool.js";

/**
 * A row write's handler as `declaredWrite` builds it for a caller that
 * hands it its input already read: the write's own input made by `read`,
 * and the caller's answer made by `answered` of the write's. Synthetic rows.
 */

interface Row {
  readonly id: string;
  readonly name: string;
}

const ROW = fieldKind((row: Row) => row.id);

it.effect(
  "a write is made from what its caller hands it by `read`, and answers what `answered` makes of the service's answer",
  () =>
    Effect.gen(function* () {
      const sent: Row[] = [];
      const makes: WriteDeclaration<Row, FieldChange<Row>, Row, { readonly kept: string }> = {
        kind: ROW,
        keys: (row) => [row.id],
        change: (row) => ({ made: row }),
        send: (row) =>
          Effect.sync(() => {
            sent.push(row);
            return { answer: { kept: row.id }, txid: undefined };
          }),
      };
      const handler = declaredWrite(yield* entityPool(), makes, {
        read: (input: { readonly name: string }) =>
          Effect.succeed({ id: "row-1", name: input.name }),
        answered: (answer) => Effect.succeed(`kept ${answer.kept}`),
      });

      const answered = yield* handler({ name: "Triage" });

      assert.deepEqual(sent, [{ id: "row-1", name: "Triage" }]);
      assert.equal(answered, "kept row-1");
    }),
);
