import {
  type ClaudeCodeConfig,
  type CodexConfig,
  type ContentBlock,
  INPUT_LINE,
} from "@repo/agent-runner/protocol";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Option, Schema } from "effect";

export const LAUNCH_NOTE = {
  CLEARED: `Your folder on this machine was cleared since your last turn, so this turn starts in a fresh one, with none of your earlier work but what you pushed to GitHub, and with no memory of the conversation before it. Fetch your branch to carry on from what you pushed. Your transcript is still in ${PRODUCT_NAME}.`,
} as const;

const NOTES_LEAD = `From ${PRODUCT_NAME}, about the machine this turn runs on:`;

const RESUME_KEYS = ["resume", "threadId", "rewindBefore"] as const satisfies readonly (
  | keyof ClaudeCodeConfig
  | keyof CodexConfig
)[];

const JsonLineSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const readLine = Schema.decodeUnknownOption(JsonLineSchema);
const writeLine = Schema.encodeSync(JsonLineSchema);

const isMessage = Schema.is(
  Schema.Struct({
    type: Schema.Literal(INPUT_LINE.MESSAGE),
    content: Schema.Array(Schema.Unknown),
  }),
);

export function sessionResumed(stdin: string): boolean {
  const config = readLine(stdin.split("\n")[0] ?? "");
  return Option.exists(config, (line) => RESUME_KEYS.some((key) => line[key] !== undefined));
}

export function notedFirstLines(stdin: string, notes: readonly string[], fresh: boolean): string {
  if (notes.length === 0 && !fresh) return stdin;
  let said = notes.length === 0;
  const lines = stdin.split("\n").map((text, at) => {
    const line = readLine(text);
    if (Option.isNone(line)) return text;
    if (at === 0) {
      if (!fresh) return text;
      return writeLine(
        Object.fromEntries(
          Object.entries(line.value).filter(([key]) => !RESUME_KEYS.some((each) => each === key)),
        ),
      );
    }
    if (said || !isMessage(line.value)) return text;
    said = true;
    const note: ContentBlock = { type: "text", text: [NOTES_LEAD, ...notes].join("\n\n") };
    return writeLine({ ...line.value, content: [note, ...line.value.content] });
  });
  return lines.join("\n");
}
