import { customType, timestamp } from "drizzle-orm/pg-core";

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});
