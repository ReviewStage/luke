import {
  type ClaudeCodeConfig,
  type CodexConfig,
  type ContentBlock,
  INPUT_LINE,
} from "@luke/agent-runner/protocol";
import { Option, Schema } from "effect";

/**
 * local-agent-first-lines.ts -- a local agent's first lines as its device hands them to the runner: what the device tells the agent of the machine its turn starts on, ahead of the launch's first message, and the harness's session let go of where the device holds none of it to resume.
 *
 * A device's launch carries the runner's first lines in its secrets, the
 * config and then the first message (`@luke/agent-runner/protocol`), which
 * the device writes to the runner's stdin. What only the device knows, that
 * the agent's folder was cleared since its last turn, it says here, as a
 * text block ahead of that message's own, so both harnesses read it as the
 * agent's turn opens and neither runner's handling of its lines changes. A
 * launch whose folder was cleared still names the session it continued,
 * which no longer stands anywhere, so its config is written without it, and
 * the harness starts a session afresh. Every other key of each line is
 * written back as it came, so one a newer service added reaches the runner
 * untouched.
 */

/** What the device tells the agent of the machine its turn starts on, each as the paragraph it reads. */
export const LAUNCH_NOTE = {
  /** The agent's folder on the device was cleared since its last turn, so it starts afresh from what it pushed. */
  CLEARED:
    "Your folder on this machine was cleared since your last turn, so this turn starts in a fresh one, with none of your earlier work but what you pushed to GitHub, and with no memory of the conversation before it. Fetch your branch to carry on from what you pushed. Your transcript is still in Luke.",
} as const;

/** What leads the device's notes, so the agent reads them as Luke's rather than the developer's. */
const NOTES_LEAD = "From Luke, about the machine this turn runs on:";

/** The keys of a runner's config that continue a harness's session: Claude Code's session, Codex's thread, and the cut a rewind makes in either. */
const RESUME_KEYS = ["resume", "threadId", "rewindBefore"] as const satisfies readonly (
  | keyof ClaudeCodeConfig
  | keyof CodexConfig
)[];

/** One stdin line, read and written as a JSON object whose every key is kept. */
const JsonLineSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const readLine = Schema.decodeUnknownOption(JsonLineSchema);
const writeLine = Schema.encodeSync(JsonLineSchema);

/** A message line, as far as a note ahead of its content needs it read. */
const isMessage = Schema.is(
  Schema.Struct({
    type: Schema.Literal(INPUT_LINE.MESSAGE),
    content: Schema.Array(Schema.Unknown),
  }),
);

/** Whether the first lines' config continues a harness's session. */
export function sessionResumed(stdin: string): boolean {
  const config = readLine(stdin.split("\n")[0] ?? "");
  return Option.exists(config, (line) => RESUME_KEYS.some((key) => line[key] !== undefined));
}

/**
 * The first lines given with the notes ahead of the first message's own
 * content, under one lead, and where `fresh`, the config without the keys
 * that continue a session. Lines it cannot read are written back as they
 * came.
 */
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
