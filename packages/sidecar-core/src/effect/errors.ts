import * as Data from "effect/Data";

export class ParseFailure extends Data.TaggedError("ParseFailure")<{
  readonly cause: unknown;
  readonly message?: string;
}> {}

export class Defect extends Data.TaggedError("Defect")<{
  readonly cause: unknown;
  readonly message?: string;
}> {}
