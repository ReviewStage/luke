/**
 * reported-failure.ts -- a failure a member meets that no outcome named, handed to the runtime's error reporter as an issue of its own kind.
 *
 * A failure that is an expected, named outcome (a usage limit, a key the
 * member must fix) is logged and nothing more, so an alert stays worth
 * reading. One that is not, such as a session eve failed or a turn whose end
 * never came, is also reported through Effect's `ErrorReporter`, which the
 * deployment's runtimes hand to Sentry (`observability/sentry.ts`). The kind
 * is the report's message and every report is the one class, so Sentry groups
 * them by kind and never by the ids beside it. Those ride as the report's
 * attributes: ids, codes, statuses, and causes already redacted, never what
 * a member or a model wrote.
 */
import { Cause, Data, type Effect, ErrorReporter } from "effect";

/** What a report carries beside its kind: ids, codes, statuses, and redacted causes. */
export type ReportedAttributes = Readonly<Record<string, string | number | undefined>>;

class UnexpectedFailure extends Data.TaggedError("UnexpectedFailure")<{
  readonly message: string;
  readonly details: ReportedAttributes;
}> {
  override readonly [ErrorReporter.attributes] = this.details;
}

/** Reports one unexpected failure of the kind named, with what it holds as the report's attributes and the kind as its `failure`. */
export function reportUnexpected(
  kind: string,
  attributes: ReportedAttributes,
): Effect.Effect<void> {
  return ErrorReporter.report(
    Cause.fail(new UnexpectedFailure({ message: kind, details: { ...attributes, failure: kind } })),
  );
}
