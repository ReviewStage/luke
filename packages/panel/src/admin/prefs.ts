import { ACCOUNTS_SORT_KEY, type AccountsSort } from "@repo/ui/accounts-sort";
import { SORT_DIRECTION } from "@repo/ui/sort-direction";
import { Option, Schema, SchemaTransformation } from "effect";
import { forgetKept, readKeptOption, writeKept } from "../kept-storage.js";

interface RememberedFlag {
  read(): boolean;
  write(value: boolean): void;
}

function rememberedFlag(key: string, absentMeans = false): RememberedFlag {
  return {
    read(): boolean {
      return Option.isSome(readKeptOption(key, Schema.String)) !== absentMeans;
    },
    write(value: boolean): void {
      if (value === absentMeans) forgetKept(key);
      else writeKept(key, Schema.String, String(value));
    },
  };
}

export const SIGN_IN_CHOSEN = rememberedFlag("app-admin-sign-in-chosen");

export const SIDEBAR_HIDDEN = rememberedFlag("app-admin-sidebar-collapsed");

export const ADMINS_HIDDEN = rememberedFlag("app-admin-hide-admins", true);

export const WORKSPACES_SHARED_ONLY = rememberedFlag("app-admin-workspaces-shared-only", true);

interface RememberedValue<T> {
  read(): T | undefined;
  write(value: T): void;
}

function rememberedValue<T>(key: string, schema: Schema.Codec<T, string>): RememberedValue<T> {
  return {
    read: () => Option.getOrUndefined(readKeptOption(key, schema)),
    write: (value) => writeKept(key, schema, value),
  };
}

const storedAccountsSort = Schema.TemplateLiteralParser([
  Schema.Literals(Object.values(ACCOUNTS_SORT_KEY)),
  ":",
  Schema.Literals(Object.values(SORT_DIRECTION)),
]).pipe(
  Schema.decodeTo(
    Schema.Struct({
      key: Schema.Literals(Object.values(ACCOUNTS_SORT_KEY)),
      direction: Schema.Literals(Object.values(SORT_DIRECTION)),
    }),
    SchemaTransformation.transform({
      decode: ([key, , direction]) => ({ key, direction }),
      encode: ({ key, direction }) => [key, ":", direction] as const,
    }),
  ),
);

export const ACCOUNTS_SORT: RememberedValue<AccountsSort> = rememberedValue(
  "app-admin-users-sort",
  storedAccountsSort,
);
