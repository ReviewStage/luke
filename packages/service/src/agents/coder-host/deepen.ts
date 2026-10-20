/**
 * deepen.ts -- which of a coding agent's calls deepen its shallow checkout, and the tools that deepen it before they run.
 *
 * A coding agent's sandbox opens on a shallow checkout with no credential
 * standing (`checkout.ts`), so a turn that only reads the code, as a call's
 * first look at it does, opens fast. A call that writes deepens it first:
 * `write_file` and `apply_patch`, which change what will be committed;
 * `open_pull_request`, which opens a pull request from a pushed branch; and
 * a `bash` command, unless it is plainly a read (`readsOnly`), since a
 * command may reach git's history or GitHub itself, as `git log` or
 * `git push` does, or through a script that runs git, as a repository's
 * checks often do. A read is told by its words alone, so a command whose
 * words this cannot read as plain reads is taken for one that writes: a
 * command deepened needlessly costs one fetch, and one not deepened that
 * needed it would read a cut history or push without a credential.
 *
 * Nothing here deepens: the deepen is the host's (`host.ts`'s `deepen`),
 * run by the authored file through the door the wrapped tool is handed,
 * the moment the tool first opens its sandbox, so a call refused before it
 * reaches the sandbox deepens nothing.
 */

import { type UnparsedWireValue, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Option, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import type {
  RuntimeSandboxSession,
  RuntimeSandboxSessionFor,
  SandboxEnvironment,
  SandboxSession,
} from "eve/sandbox";
import type { ToolContext, ToolDefinition } from "eve/tools";
import { CODER_TOOL } from "./tool-set.js";

/** The commands that only read: they reach no git history, no network, and no script that might. */
const READ_COMMANDS: ReadonlySet<string> = new Set([
  "awk",
  "basename",
  "cat",
  "cd",
  "column",
  "cut",
  "diff",
  "dirname",
  "du",
  "echo",
  "fd",
  "file",
  "find",
  "grep",
  "head",
  "jq",
  "less",
  "ls",
  "nl",
  "printf",
  "pwd",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "tree",
  "true",
  "uniq",
  "wc",
  "which",
]);

/** Where one command of a line ends and the next begins: a pipe, a list's operators, or a new line. */
const COMMAND_BREAK = /&&|\|\||[|;&\n]/u;

/** A word that names git or GitHub's command line, anywhere in a command, where a read's argument might run it. */
const GIT_WORD = /(^|[^\w.-])(git|gh)([^\w.-]|$)/u;

/** A command run inside another's words, whose name the line's own reading does not see. */
const SUBSTITUTION = /\$\(|`/u;

/** A variable set ahead of a command, `NAME=value`, which is no command of its own. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** The name of the command one part of a line runs, past any variables set ahead of it and the brackets a group opens with. */
function commandName(part: string): string | undefined {
  const words = part
    .trim()
    .replace(/^[({\s]+/u, "")
    .split(/\s+/u);
  return words.find((word) => word !== "" && !ASSIGNMENT.test(word));
}

/** A redirection that writes no file: one stream onto another, or onto nothing. */
const HARMLESS_REDIRECTION = /[0-9&]?>>?\s*(&[0-9-]|\/dev\/null\b)/gu;

/** A redirection left once the harmless ones are taken out, which writes a file. */
const REDIRECTION = />/u;

/** The arguments that make a plain read write: `sed` editing in place, and `find` running, deleting, or printing to a file. */
const WRITING_ARGUMENTS = new Map<string, RegExp>([
  ["sed", /(^|\s)(-i\S*|--in-place\S*|-[a-hj-zA-Z]*i\S*)(\s|$)/u],
  ["find", /(^|\s)-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(\s|$)/u],
]);

/** Whether one command of a line only reads: a plain read, given no argument that makes it write. */
function partReadsOnly(part: string): boolean {
  const name = commandName(part);
  if (name === undefined) return true;
  if (!READ_COMMANDS.has(name)) return false;
  return !(WRITING_ARGUMENTS.get(name)?.test(part) ?? false);
}

/**
 * Whether a shell command only reads: every command of it one of the plain
 * reads, given no argument that makes it write, none naming git or `gh`,
 * none run inside another's words, and nothing redirected into a file.
 */
function readsOnly(command: string): boolean {
  if (GIT_WORD.test(command) || SUBSTITUTION.test(command)) return false;
  const unredirected = command.replace(HARMLESS_REDIRECTION, "");
  if (REDIRECTION.test(unredirected)) return false;
  return unredirected.split(COMMAND_BREAK).every(partReadsOnly);
}

/** The tools whose every call deepens the checkout, whatever it was given. */
const ALWAYS_DEEPENS: ReadonlySet<string> = new Set([
  CODER_TOOL.WRITE_FILE,
  CODER_TOOL.APPLY_PATCH,
  CODER_TOOL.OPEN_PULL_REQUEST,
]);

/** What a shell call's input is read for here: its command. */
const readCommand = Schema.decodeUnknownOption(Schema.Struct({ command: Schema.String }));

/**
 * Whether a call of the tool named, with the input given, deepens the
 * checkout before it runs. Note that a shell call whose command does not
 * read is taken for one that writes, since it ran no read the checkout
 * would serve shallow.
 */
export function deepensCheckout(toolName: string, input: UnparsedWireValue): boolean {
  if (ALWAYS_DEEPENS.has(toolName)) return true;
  if (toolName !== CODER_TOOL.BASH) return false;
  return Option.match(readCommand(input), {
    onNone: () => true,
    onSome: ({ command }) => !readsOnly(command),
  });
}

/** The door a deepening tool deepens through: the session's checkout deepened, with the credential set, before the call goes on. */
export type DeepenDoor = (ctx: ToolContext) => Promise<void>;

/**
 * The call's context with its sandbox door deepening first: the first time
 * the call opens its sandbox, the checkout is deepened through the door
 * given, and the sandbox is handed over only once that is done; a deepen
 * that fails fails the call, in the host's words, and the next write tries
 * again. Note that eve hands a tool its context as a plain object of
 * functions, so a spread keeps every other member as it was.
 */
function deepeningOnOpen(ctx: ToolContext, deepen: DeepenDoor): ToolContext {
  let deepened: Promise<void> | undefined;
  const once = () => {
    deepened ??= deepen(ctx);
    return deepened;
  };
  function getSandbox(): Promise<RuntimeSandboxSession>;
  function getSandbox<Session extends SandboxSession>(
    environment: SandboxEnvironment<object | undefined, Session>,
  ): Promise<RuntimeSandboxSessionFor<Session>>;
  async function getSandbox<Session extends SandboxSession>(
    environment?: SandboxEnvironment<object | undefined, Session>,
  ) {
    await once();
    return environment === undefined ? ctx.getSandbox() : ctx.getSandbox(environment);
  }
  return { ...ctx, getSandbox };
}

/**
 * The tool, deepening the checkout first where its call writes
 * (`deepensCheckout`), the moment it opens its sandbox; a call that only
 * reads runs as it was.
 */
export function deepeningFirst<Input, Output>(
  toolName: string,
  tool: ToolDefinition<Input, Output>,
  deepen: DeepenDoor,
): ToolDefinition<Input, Output> {
  return {
    ...tool,
    execute: (input, ctx) =>
      tool.execute(
        input,
        // SAFETY: eve hands a tool the JSON object the model emitted, which its own schema read.
        deepensCheckout(toolName, unparsedWire(input as WireBoundaryInput))
          ? deepeningOnOpen(ctx, deepen)
          : ctx,
      ),
  };
}

/**
 * Whether an event of the agent's session deepened its checkout: a request
 * for a call that deepens it before it runs, which is when the credential
 * was first set at the firewall.
 */
export function deepensSandbox(event: MessageStreamEvent): boolean {
  return (
    event.type === "actions.requested" &&
    event.data.actions.some(
      (action) =>
        action.kind === "tool-call" &&
        // SAFETY: eve's event carries the JSON object the model emitted for the call.
        deepensCheckout(action.toolName, unparsedWire(action.input as WireBoundaryInput)),
    )
  );
}
