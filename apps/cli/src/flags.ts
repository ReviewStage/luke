/**
 * flags.ts -- the flags every `vespin` command takes, read by a command as the settings they stand for.
 *
 * Each is an `effect/cli` global setting, so it is parsed wherever it stands
 * on the command line and handed to any command through the Effect context,
 * with no command declaring it again. `main.ts` registers them on the root.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { Flag, GlobalFlag } from "effect/cli";

/** `--json`: JSON on stdout, as when stdout is not a terminal (`output.ts`). */
export const JSON_FLAG = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print JSON, as when stdout is not a terminal"),
  ),
});

/** `-q/--quiet`: the ids an answer names, one a line, and nothing else. */
export const QUIET_FLAG = GlobalFlag.Setting("quiet")({
  flag: Flag.Boolean("quiet").pipe(
    Flag.withAlias("q"),
    Flag.withDefault(false),
    Flag.withDescription("Print ids only, one a line"),
  ),
});

/** `--url`: the service to talk to, over `VESPIN_URL` and production (`session.ts`). */
export const URL_FLAG = GlobalFlag.Setting("url")({
  flag: Flag.String("url").pipe(
    Flag.optional,
    Flag.withDescription(
      `The ${PRODUCT_NAME} service to use, such as a Preview's address (or VESPIN_URL)`,
    ),
  ),
});

/** `-w/--workspace`: the workspace a command acts in, over `VESPIN_WORKSPACE`. */
const WORKSPACE_FLAG = GlobalFlag.Setting("workspace")({
  flag: Flag.String("workspace").pipe(
    Flag.withAlias("w"),
    Flag.optional,
    Flag.withDescription("The workspace to act in, by its slug (or VESPIN_WORKSPACE)"),
  ),
});

/** Every global flag, in the order `--help` lists them. */
export const GLOBAL_FLAGS = [JSON_FLAG, QUIET_FLAG, URL_FLAG, WORKSPACE_FLAG] as const;
