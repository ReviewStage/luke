import { describeWire } from "@repo/wire/effect";
import { Schema } from "effect";

export const COMMAND_DESCRIPTION = Schema.optionalKey(
  describeWire(
    Schema.String,
    "What the command is for, in plain English for the developer reading along: " +
      '3 to 8 words, sentence case, no trailing period, such as "Run the unit tests" or ' +
      '"Find where invites are sent".',
  ),
);

export const COMMAND_DESCRIPTION_INSTRUCTION =
  "Give every command a `description`, what it is for in 3 to 8 plain words, which the " +
  "developer reads in place of the command.";
