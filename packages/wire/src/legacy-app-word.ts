import { Schema, SchemaTransformation } from "effect";

export const LEGACY_APP_WORD = "luke";

export function literalsReadingLegacy<const Values extends ReadonlyArray<string>>(
  values: Values,
  legacy: string,
  current: Values[number],
) {
  const stored = Schema.declare(
    (input: unknown): input is Values[number] =>
      input === legacy || values.some((value) => value === input),
  );
  return stored.pipe(
    Schema.decodeTo(
      Schema.Literals(values),
      SchemaTransformation.transform({
        decode: (read) => (read === legacy ? current : read),
        encode: (value) => value,
      }),
    ),
  );
}
