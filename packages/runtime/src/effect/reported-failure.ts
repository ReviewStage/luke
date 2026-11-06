import { Cause, Data, type Effect, ErrorReporter } from "effect";

export type ReportedAttributes = Readonly<Record<string, string | number | undefined>>;

class UnexpectedFailure extends Data.TaggedError("UnexpectedFailure")<{
  readonly message: string;
  readonly details: ReportedAttributes;
}> {
  override readonly [ErrorReporter.attributes] = this.details;
}

export function reportUnexpected(
  kind: string,
  attributes: ReportedAttributes,
): Effect.Effect<void> {
  return ErrorReporter.report(
    Cause.fail(new UnexpectedFailure({ message: kind, details: { ...attributes, reason: kind } })),
  );
}
