import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { Effect } from "effect";
import { InboxAttachmentKey, keptContent } from "./kept-content.js";

/** A budget four answers of `ANSWERED` fill: each weighs 20 characters, its type's 9 and 11 of base64. */
const BUDGET = 80;
const ANSWERED = "iVBORw0KGgo";

it.effect(
  "the answer read least recently is let go first past the budget, and one past a quarter of it is answered but not kept",
  () =>
    Effect.gen(function* () {
      const kept = yield* keptContent(BUDGET);
      const asked: string[] = [];
      const read = (attachmentId: string, base64 = ANSWERED) =>
        kept.answer(
          new InboxAttachmentKey({ itemId: "item-1", attachmentId }),
          () => "user-dana",
          Effect.sync(() => {
            asked.push(attachmentId);
            return { contentType: INBOX_IMAGE_TYPE.PNG, base64 };
          }),
          (answer) => answer,
        );

      for (const attachmentId of ["a", "b", "c", "d"]) yield* read(attachmentId);
      yield* read("a");
      yield* read("e");
      yield* read("a");
      yield* read("b");
      assert.deepEqual(asked, ["a", "b", "c", "d", "e", "b"]);

      const large = `${ANSWERED}A`;
      yield* read("large", large);
      yield* read("large", large);
      assert.deepEqual(asked.slice(6), ["large", "large"]);
    }),
);
