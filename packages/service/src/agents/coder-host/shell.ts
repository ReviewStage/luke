import { describeWire, emitJsonSchema } from "@luke/wire/effect";
import { Schema } from "effect";
import { defineTool, type ToolContext, type ToolDefinition } from "eve/tools";
import { type BashToolInput, bash } from "eve/tools/bash";
import { COMMAND_DESCRIPTION } from "../command-description.js";

/**
 * shell.ts -- the coding agent's shell: eve's own `bash`, with every command started in the checkout.
 *
 * eve runs each command in a fresh shell at `/workspace`, the sandbox's
 * root, and the agent's checkout stands one directory below it
 * (`bounds.ts`), so a model told where the checkout is opens every command
 * with a `cd` into it, since the last call's `cd` is gone. The shell here
 * starts each command in the checkout instead. Note that the `cd` is a line
 * of its own ahead of the command, which runs whole after it, so a heredoc
 * or a multi-line script reads as the model wrote it; that a checkout that
 * is not there fails the call rather than running the command at the
 * sandbox's root; and that the call's input stays the model's command, so
 * the transcript shows what the model wrote and nothing of this. The input
 * takes the command's description beside it (`command-description.ts`),
 * which eve's own schema refuses as a key it does not know, and the shell
 * hands eve's `bash` the command alone.
 *
 * eve reads a command's output and exit over calls to Vercel Sandbox's API
 * apart from the one that starts it, and Vercel at times answers one of
 * those 404 "Vercel Sandbox not found" a moment after the start, or cuts
 * the stream of a long one, while the sandbox stays up and the command runs
 * on. eve throws either, so the model read that its sandbox was gone, of a
 * command that had in fact run (a push among them). Where the call fails so
 * and the sandbox still answers, the shell says instead that the command's
 * outcome was lost and may have taken effect, so the model checks before it
 * runs it again; where the sandbox does not answer, eve's failure stands.
 */

/** eve's `bash` input as the model is offered it, with the description beside the command. */
const SHELL_INPUT = Schema.Struct({
  command: describeWire(Schema.String, "The shell command to execute."),
  description: COMMAND_DESCRIPTION,
});

/** What the shell answers where a command's outcome was lost on the way back from a sandbox that is still up. */
const OUTCOME_LOST = "unknown";

/** The shell's answers: eve's `bash`'s two, and a command whose outcome was lost. */
const SHELL_OUTPUT = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    exitCode: Schema.Number,
    stderr: Schema.String,
    stdout: Schema.String,
    truncated: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("running"),
    pid: Schema.Number,
    outputDirectory: Schema.String,
    message: Schema.String,
    stderr: Schema.String,
    stdout: Schema.String,
    truncated: Schema.Boolean,
  }),
  Schema.Struct({ status: Schema.Literal(OUTCOME_LOST), message: Schema.String }),
]);

type ShellOutput = typeof SHELL_OUTPUT.Type;

/** What the model reads of a command whose outcome was lost. */
const OUTCOME_LOST_MESSAGE =
  "The sandbox is up, but Vercel Sandbox's API failed while this command ran, so its output and exit code were lost. " +
  "The command may have run in full, in part, or not at all, and may still be running. Check its effects with another " +
  "command (such as `git status`, `git log`, or the pull request) before you run it again, above all one that is not " +
  "safe to repeat, such as a push.";

/** Vercel's answer for a sandbox, session, or command it did not find, which it gives a command just started too. */
const NOT_FOUND_STATUS = 404;

/** The lowest status of a server failure, which a gateway in front of the sandbox answers. */
const SERVER_ERROR_STATUS = 500;

/** undici's code for a socket the other side closed, which a stream it cut carries as its cause. */
const SOCKET_CLOSED_CODE = "UND_ERR_SOCKET";

/** `@vercel/sandbox`'s code for a command's stream that ended before the command did. */
const STREAM_ENDED_EARLY_CODE = "stream_ended_early";

/** An error as `@vercel/sandbox`'s API error holds the answer it failed on: the response, with its status. */
const isAnsweredFailure = Schema.is(
  Schema.Struct({ response: Schema.Struct({ status: Schema.Number }) }),
);

/** An error that undici or `@vercel/sandbox` throws for a stream cut or ended short, by its code. */
const isStreamLost = Schema.is(
  Schema.Struct({ code: Schema.Literals([SOCKET_CLOSED_CODE, STREAM_ENDED_EARLY_CODE]) }),
);

/** An error that carries another as its cause. */
const isCaused = Schema.is(Schema.Struct({ cause: Schema.Unknown }));

/** The most causes a failure is read through, past which a chain (or a cycle) is not followed. */
const MAX_CAUSES = 8;

/** Whether one error, not its causes, is Vercel's API losing a command: a 404 or a server failure answered, or a stream lost. */
function losesOutcome(cause: unknown): boolean {
  if (isStreamLost(cause)) return true;
  if (!isAnsweredFailure(cause)) return false;
  const { status } = cause.response;
  return status === NOT_FOUND_STATUS || status >= SERVER_ERROR_STATUS;
}

/**
 * Whether a failure is Vercel Sandbox's API losing a command on the way
 * back rather than the command's own: a 404 or a server error answered to
 * one of its calls, its stream cut by the other side, or ended before the
 * command did, on the failure itself or any cause it carries.
 */
function isOutcomeLost(cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < MAX_CAUSES; depth += 1) {
    if (losesOutcome(current)) return true;
    if (!isCaused(current)) return false;
    current = current.cause;
  }
  return false;
}

/** Whether the call's sandbox runs a command that does nothing, reached as eve hands it to the call. */
async function sandboxAnswers(ctx: ToolContext): Promise<boolean> {
  try {
    await (await ctx.getSandbox()).run({ command: "true" });
    return true;
  } catch {
    return false;
  }
}

/** A path as one single-quoted shell word. */
function quoted(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * A command's failure as the shell answers it: its outcome lost where
 * Vercel's API lost it and the sandbox still answers, and eve's failure as
 * it was thrown otherwise.
 */
async function lostOrThrown(cause: unknown, ctx: ToolContext): Promise<ShellOutput> {
  // A call the turn cancelled, or a failure of the command's own, stands as eve threw it.
  if (ctx.abortSignal?.aborted === true || !isOutcomeLost(cause)) throw cause;
  // A sandbox that does not answer a command of its own is gone indeed, and eve's failure says so.
  if (!(await sandboxAnswers(ctx))) throw cause;
  return { status: OUTCOME_LOST, message: OUTCOME_LOST_MESSAGE };
}

/**
 * eve's `bash` as the shell is built on, its marks among it, typed over the
 * shell's answers. SAFETY: of what eve's `bash` holds, only its label reads
 * the call, and that only the input, never the answer (it has no `complete`,
 * `toModelOutput`, or `endsTurn`), so nothing of it reads an answer the
 * shell adds to eve's.
 */
const BASH_BASE = bash as ToolDefinition<BashToolInput, ShellOutput>;

/** eve's `bash`, told and run so that every command starts in the directory given. */
export function bashStartingIn(directory: string) {
  return defineTool<typeof SHELL_INPUT.Type, ShellOutput>({
    ...BASH_BASE,
    description: `${bash.description} Every command starts in ${directory}, the repository's checkout, in a fresh shell, so a \`cd\` lasts only for the call it is in.`,
    inputSchema: emitJsonSchema(SHELL_INPUT),
    outputSchema: emitJsonSchema(SHELL_OUTPUT),
    execute: (input, ctx) => {
      const answer = bash.execute(
        { command: `cd ${quoted(directory)} || exit\n${input.command}` },
        ctx,
      );
      if (Symbol.asyncIterator in answer) return answer;
      return Promise.resolve(answer).catch((cause: unknown) => lostOrThrown(cause, ctx));
    },
  });
}
