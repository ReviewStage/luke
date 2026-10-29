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
 * the agent's folder was restored onto a machine that held none of it, that
 * its saved state expired, or that its last turn's work could not be saved,
 * it says here, as a text block ahead of that message's own, so both
 * harnesses read it as the agent's turn opens and neither runner's handling
 * of its lines changes. A launch whose saved state expired still names the
 * session it continued, which no longer stands anywhere, so its config is
 * written without it, and the harness starts a session afresh. Every other
 * key of each line is written back as it came, so one a newer service added
 * reaches the runner untouched.
 */

/** What the device tells the agent of the machine its turn starts on, each as the paragraph it reads. */
export const LAUNCH_NOTE = {
  /** The agent's folder was restored from its saved state onto a machine that held none of it. */
  RESTORED:
    "This turn starts on a fresh machine. Luke brought back your work and your conversation as they were saved at your last turn's end: your commits, branches and stashes, your staged, unstaged and untracked changes, your session, and your attachments. Nothing else came back: whatever Git ignores, such as installed dependencies, build output and local environment files, is gone, so reinstall or rebuild what you need before you rely on it.",
  /** The agent's saved state expired before this launch, so it starts afresh. */
  EXPIRED:
    "Your saved work and your session from earlier turns expired: Luke keeps an agent's saved state for 7 days after its last save. This turn starts on a fresh machine with none of your earlier work but what you pushed, and with no memory of the conversation before it. Its transcript is still in Luke.",
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

/** The paragraph telling the agent why its last turn's work could not be saved, in the words its record kept. */
export function unsavedNote(why: string): string {
  return `Your last turn's work couldn't be saved off this machine: ${why.trim().replace(/\.$/u, "")}. Fix it so it saves.`;
}

/** Whether the first lines' config continues a harness's session. */
export function sessionResumed(stdin: string): boolean {
  const config = readLine(stdin.split("\n")[0] ?? "");
  return Option.exists(config, (line) => RESUME_KEYS.some((key) => line[key] !== undefined));
}

/**
 * The first lines given with the notes ahead of the first message's own
 * content, under one lead, and where `fresh`, the config without the keys
 * that continue a session; and whether a message carried the notes. Lines
 * it cannot read are written back as they came.
 */
export function notedFirstLines(
  stdin: string,
  notes: readonly string[],
  fresh: boolean,
): { readonly stdin: string; readonly said: boolean } {
  if (notes.length === 0 && !fresh) return { stdin, said: true };
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
  return { stdin: lines.join("\n"), said };
}
