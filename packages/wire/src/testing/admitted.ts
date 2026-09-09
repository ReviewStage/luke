import type { Admitted } from "../admitted.js";

/**
 * The way into the admitted set a test needs and production does not have. A
 * test that drives one adapter, one plugin handler, or one performer directly
 * is exercising the layer beneath admission on purpose, and it says so by
 * naming this rather than by reaching a validator of its own. It ships from
 * the testing subpath alone, so a production import of it is a resolution
 * failure rather than a review question.
 */
export function admittedForTest<Value>(value: Value): Admitted<Value> {
  // SAFETY: the brand is nominal; this is the test harness's stand-in for the
  // admission a production caller would have run.
  return value as Admitted<Value>;
}
