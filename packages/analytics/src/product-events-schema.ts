import type { UnparsedWireValue } from "@sidecar/wire";
import {
  decodeUnknown,
  NonNegativeFiniteTimestampSchema,
  ReleaseVersionSchema,
} from "@sidecar/wire/schema";
import * as Schema from "effect/Schema";
import {
  type EnumeratedProductEventProperty,
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_PROPERTIES,
  PRODUCT_EVENT_PROPERTY,
  PRODUCT_EVENT_PROPERTY_VALUES,
  PRODUCT_SESSION_COUNT_BUCKET,
  PRODUCT_SURFACE_EVENT,
  type ProductEvent,
  type ProductEventBatch,
  type ProductEventName,
  type ProductEventProperties,
  type ProductEventProperty,
  type ProductSessionCountBucket,
  type ProductSurfaceEventName,
} from "./product-events.js";

const COUNT_BUCKETS: ReadonlySet<number> = new Set(Object.values(PRODUCT_SESSION_COUNT_BUCKET));

function catalogLiteral<const T extends readonly [string, ...string[]]>(
  ...values: T
): Schema.Schema<T[number]> {
  return Schema.Literal(...values);
}

function enumeratedPropertySchema<Property extends EnumeratedProductEventProperty>(
  property: Property,
): Schema.Schema<(typeof PRODUCT_EVENT_PROPERTY_VALUES)[Property][number]> {
  const values = PRODUCT_EVENT_PROPERTY_VALUES[property];
  // SAFETY: every enumerated property declares at least one member in the catalog.
  return catalogLiteral(...(values as unknown as readonly [string, ...string[]])) as Schema.Schema<
    (typeof PRODUCT_EVENT_PROPERTY_VALUES)[Property][number]
  >;
}

const SessionCountBucketSchema = Schema.Number.pipe(
  Schema.filter((value): value is ProductSessionCountBucket => COUNT_BUCKETS.has(value)),
) as Schema.Schema<ProductSessionCountBucket>;

function propertyValueSchema(property: ProductEventProperty) {
  switch (property) {
    case PRODUCT_EVENT_PROPERTY.APP_VERSION:
      return ReleaseVersionSchema;
    case PRODUCT_EVENT_PROPERTY.SESSION_COUNT:
    case PRODUCT_EVENT_PROPERTY.IMAGE_COUNT:
      return SessionCountBucketSchema;
    case PRODUCT_EVENT_PROPERTY.CONNECTION_ID:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.CONNECTION_ID);
    case PRODUCT_EVENT_PROPERTY.PROVIDER_ID:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.PROVIDER_ID);
    case PRODUCT_EVENT_PROPERTY.TRACKER_ID:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.TRACKER_ID);
    case PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE);
    case PRODUCT_EVENT_PROPERTY.SESSION_STATUS:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SESSION_STATUS);
    case PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE);
    case PRODUCT_EVENT_PROPERTY.SESSION_ACT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SESSION_ACT);
    case PRODUCT_EVENT_PROPERTY.DIAGNOSTIC_KIND:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.DIAGNOSTIC_KIND);
    case PRODUCT_EVENT_PROPERTY.ISSUE_ACT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.ISSUE_ACT);
    case PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT);
    case PRODUCT_EVENT_PROPERTY.SUPERSET_ACT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SUPERSET_ACT);
    case PRODUCT_EVENT_PROPERTY.UPDATE_ACT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.UPDATE_ACT);
    case PRODUCT_EVENT_PROPERTY.PANEL_TAB:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.PANEL_TAB);
    case PRODUCT_EVENT_PROPERTY.PANEL_SOURCE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.PANEL_SOURCE);
    case PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW);
    case PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE);
    case PRODUCT_EVENT_PROPERTY.ASK_OUTCOME:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.ASK_OUTCOME);
    case PRODUCT_EVENT_PROPERTY.EXCHANGE_KIND:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.EXCHANGE_KIND);
    case PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT);
    case PRODUCT_EVENT_PROPERTY.SIGN_IN_AGE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SIGN_IN_AGE);
    case PRODUCT_EVENT_PROPERTY.SETTING_ID:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SETTING_ID);
    case PRODUCT_EVENT_PROPERTY.SETTING_VALUE:
      return enumeratedPropertySchema(PRODUCT_EVENT_PROPERTY.SETTING_VALUE);
  }
}

function eventPropertiesSchema<Name extends ProductEventName>(
  name: Name,
): Schema.Schema<ProductEventProperties> {
  const allowed = PRODUCT_EVENT_PROPERTIES[name];
  if (allowed.length === 0) {
    return Schema.transform(Schema.Unknown, Schema.Struct({}), {
      strict: true,
      decode: () => ({}),
      encode: () => ({}),
    }) as unknown as Schema.Schema<ProductEventProperties>;
  }
  const fields = Object.fromEntries(
    allowed.map((property) => [property, propertyValueSchema(property)]),
  );
  // SAFETY: fields are built only from this event's allowlist with matching readers.
  return Schema.Struct(fields) as unknown as Schema.Schema<ProductEventProperties>;
}

function productEventSchema<Name extends ProductEventName>(
  name: Name,
): Schema.Schema<ProductEvent & { name: Name }> {
  return Schema.Struct({
    name: Schema.Literal(name),
    at: NonNegativeFiniteTimestampSchema,
    properties: eventPropertiesSchema(name),
  }) as Schema.Schema<ProductEvent & { name: Name }>;
}

const PRODUCT_EVENT_NAME_LIST = Object.values(PRODUCT_EVENT) as [
  ProductEventName,
  ...ProductEventName[],
];

/** One counted event assembled from the allowlist rather than the envelope. */
export const ProductEventSchema: Schema.Schema<ProductEvent> = Schema.Union(
  ...PRODUCT_EVENT_NAME_LIST.map((name) => productEventSchema(name)),
);

/** The subset the renderer may ask the main process to count. */
export const ProductSurfaceEventNameSchema: Schema.Schema<ProductSurfaceEventName> = catalogLiteral(
  ...(Object.values(PRODUCT_SURFACE_EVENT) as [
    ProductSurfaceEventName,
    ...ProductSurfaceEventName[],
  ]),
);

const ProductEventBatchEventsSchema = Schema.Array(ProductEventSchema).pipe(
  Schema.filter(
    (events): events is readonly ProductEvent[] =>
      events.length > 0 && events.length <= PRODUCT_EVENT_BATCH_LIMIT,
  ),
);

/** Whole batch decode; one unreadable event refuses the batch. */
export const ProductEventBatchSchema: Schema.Schema<{ readonly events: ProductEventBatch }> =
  Schema.Struct({
    events: ProductEventBatchEventsSchema,
  });

/** Compatibility decode name for the catalog-derived schema decoder. */
export function productEventFromWire(value: UnparsedWireValue): ProductEvent | undefined {
  return decodeUnknown(ProductEventSchema, value);
}

export function productEventBatchFromWire(value: UnparsedWireValue): ProductEventBatch | undefined {
  const decoded = decodeUnknown(ProductEventBatchSchema, value);
  return decoded?.events;
}

export function isProductSurfaceEventName(
  value: UnparsedWireValue,
): value is ProductSurfaceEventName {
  return decodeUnknown(ProductSurfaceEventNameSchema, value) !== undefined;
}

type ProductEventSchemaNames = ProductEvent extends infer Event
  ? Event extends { name: infer Name }
    ? Name
    : never
  : never;

type MissingProductEventSchema = Exclude<ProductEventName, ProductEventSchemaNames>;
type ExtraProductEventSchema = Exclude<ProductEventSchemaNames, ProductEventName>;

type AssertProductEventSchemaParity = MissingProductEventSchema extends never
  ? ExtraProductEventSchema extends never
    ? true
    : ["unexpected product event schema branch", ExtraProductEventSchema]
  : ["missing product event schema branch", MissingProductEventSchema];

const _productEventSchemaParity: AssertProductEventSchemaParity = true;

export { _productEventSchemaParity };
