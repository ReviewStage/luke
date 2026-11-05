/**
 * index.ts -- every `vespin` command, in the order `--help` lists them.
 *
 * A command group is a file of its own in this folder exporting its
 * commands, built on `../output.js` (the answer, notes, `-F` input) and
 * `../session.js` (the service, the bearer, `askService`), and registered
 * by one line below. A group takes the global flags (`../flags.js`) from
 * the context rather than declaring them.
 */

import { ACCOUNT_COMMANDS } from "./account.js";
import { apiCommand } from "./api.js";
import { versionCommand } from "./version.js";

export const COMMANDS = [...ACCOUNT_COMMANDS, apiCommand, versionCommand] as const;
