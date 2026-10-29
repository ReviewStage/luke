import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Option } from "effect";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { failureDetail } from "./failure-kind.js";

/** A `SqlError` the way the pg client builds one it has no kind for: the driver's error beneath an `UnknownError`. */
function unknownSqlError(driver: unknown): SqlError {
  return new SqlError({ reason: new UnknownError({ cause: driver, message: "row 42 refused" }) });
}

describe("failureDetail", () => {
  it("names the SQLSTATE a driver's error carries, and nothing of its sentence", () => {
    const driver = Object.assign(new Error('duplicate key value "secret-row"'), { code: "57P01" });
    assert.deepEqual(failureDetail(unknownSqlError(driver)), Option.some("code 57P01"));
  });

  it("names the error where the driver's carries no code", () => {
    assert.deepEqual(
      failureDetail(unknownSqlError(new Error("Connection terminated unexpectedly"))),
      Option.some("cause Error"),
    );
  });

  it("says nothing of a failure that is no SqlError", () => {
    assert.deepEqual(failureDetail(new Error("boom")), Option.none());
  });
});
