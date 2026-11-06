import { PRODUCT_NAME } from "@repo/features/product-name";
import { Flag, GlobalFlag } from "effect/cli";

export const JSON_FLAG = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print JSON, as when stdout is not a terminal"),
  ),
});

export const QUIET_FLAG = GlobalFlag.Setting("quiet")({
  flag: Flag.Boolean("quiet").pipe(
    Flag.withAlias("q"),
    Flag.withDefault(false),
    Flag.withDescription("Print ids only, one a line"),
  ),
});

export const URL_FLAG = GlobalFlag.Setting("url")({
  flag: Flag.String("url").pipe(
    Flag.optional,
    Flag.withDescription(
      `The ${PRODUCT_NAME} service to use, such as a Preview's address (or VESPIN_URL)`,
    ),
  ),
});

export const WORKSPACE_FLAG = GlobalFlag.Setting("workspace")({
  flag: Flag.String("workspace").pipe(
    Flag.withAlias("w"),
    Flag.optional,
    Flag.withDescription("The workspace to act in, by its slug (or VESPIN_WORKSPACE)"),
  ),
});

export const GLOBAL_FLAGS = [JSON_FLAG, QUIET_FLAG, URL_FLAG, WORKSPACE_FLAG] as const;
