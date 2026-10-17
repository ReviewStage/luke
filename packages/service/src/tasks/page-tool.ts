import { posix } from "node:path";
import type { DatabaseServices } from "@luke/database/core/query";
import { writePage } from "@luke/database/models/plan-pages";
import { MENTION_KIND } from "@luke/features/mention-link";
import {
  PAGE_BOUNDS,
  type PageShower,
  type PageWrite,
  pageHtmlSchema,
  pageTitleSchema,
} from "@luke/features/page-wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { SandboxSession } from "eve/sandbox";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { taskStepOf, writtenMention } from "../agents/written-mentions.js";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { logStoreFailure } from "../http/store-failure.js";
import { isSecretFile } from "./shown-file.js";

/**
 * page-tool.ts -- `show_page`, every agent's one tool for a page: an interactive HTML document written for the task and shown in the developer's side panel.
 *
 * A page is one self-contained HTML document, its scripts and styles inline
 * or from cdnjs, which the Mac draws in a sandbox that reaches no network
 * (`apps/desktop/src/main/window/page-protocol.ts`). The brain
 * writes it in the call as `html`; a coding agent, which builds pages as
 * files, names one in its sandbox as `path`, read here through the same door
 * its own file tools reach the sandbox by, bounded and never read whole past
 * the bound. Naming a page shown before writes its next version, and naming
 * none makes a new page, so an agent revises a page rather than piling up
 * copies of it. The answer carries the page's id and version, and its
 * mention ready to write (`../agents/written-mentions.ts`), and never the
 * HTML, which the model wrote and need not read again.
 *
 * Note that the account and task are the binding the service built from
 * the conversation's task, never an argument, exactly as `draw_on_board`'s
 * are. Every outcome is a result the model reads, never a failure of the
 * call, and a refusal says how to mend the call.
 */

/** A sandbox as the tool reads a page from it: one file read as a stream of bytes, or nothing where there is no file. */
type PageSandbox = Pick<SandboxSession, "readFile">;

/** Where a call's page is written: the account and task the service bound, and, for an agent with one, its sandbox, opened on first use, and the checkout a relative path is read from. */
export interface PageToolBinding {
  readonly userId: string;
  readonly taskId: string;
  readonly sandbox?: {
    readonly door: () => Promise<PageSandbox>;
    readonly checkout: string;
  };
}

/** Why a call showed nothing, in words the model can act on. */
export const SHOW_PAGE_REFUSAL = {
  UNREADABLE: `Not shown: give a title of at most ${PAGE_BOUNDS.MAX_TITLE_CHARS} characters, and the page as either \`html\` or \`path\`, not both.`,
  NO_SANDBOX: "Not shown: you have no sandbox to read a path from. Send the page's HTML as `html`.",
  SECRET: "Not shown: that file holds secrets, such as a `.env`, and is never shown.",
  NO_FILE: "Not shown: no such file in your sandbox:",
  EMPTY: "Not shown: the page is empty.",
  TASKLESS: "Not shown: you work on no task, so there is no task to show a page on.",
  TOO_LARGE: `Not shown: the page is larger than ${PAGE_BOUNDS.MAX_HTML_CHARS / 1024} KB. Inline less data, or load a library from cdnjs rather than inlining it.`,
  NO_PAGE:
    "Not shown: this task has no page with that id. Leave `page` out to make a new page, or name one you showed on this task.",
  NO_TASK: "Not shown: this task no longer exists.",
  UNAVAILABLE: "Not shown: the page could not be saved just now. The call may be made again.",
} as const;

const SHOW_PAGE_INPUT = Schema.Struct({
  title: describeWire(
    pageTitleSchema,
    "What the page is, in a few words: its tab's name in the developer's side panel.",
  ),
  html: Schema.optionalKey(
    describeWire(
      pageHtmlSchema,
      "The page as one whole HTML document, its scripts and styles inline. Send this or `path`.",
    ),
  ),
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1_024)),
      "A file in your sandbox holding the page as one whole HTML document, relative to the checkout. Send this or `html`.",
    ),
  ),
  page: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "The id a page you showed on this task answered with, to write its next version in its place. Leave it out to make a new page.",
    ),
  ),
});

const readInput = readEither(SHOW_PAGE_INPUT);

/** The tool as an agent is offered it: its name, its words, and its input schema. */
export const SHOW_PAGE_TOOL = {
  name: AGENT_TOOL.SHOW_PAGE,
  description:
    "Show the developer an interactive HTML page in the task's side panel: a chart, a table to " +
    "sort, a mockup of a screen, or a comparison they can click through, when it says more than " +
    "a diagram or words would. The page is one self-contained HTML document: scripts and styles " +
    "inline, and libraries only from https://cdnjs.cloudflare.com. It runs sealed off: it cannot " +
    "fetch, post, open links or windows, store anything, or load images from the web, so put its " +
    "data in the page. Never put a secret in a page. Call it again with the `page` it answered to " +
    "replace that page with a new version rather than making another. Answers `accepted` with the " +
    "page's id, its version, and its mention, the `[@title](link)` to name it by in your words, " +
    "or `rejected` and why nothing was shown.",
  inputSchema: SHOW_PAGE_INPUT,
} as const;

/** A call that showed nothing, and why. */
export function showPageRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The most bytes a page's file is read to: its bound in characters, at the most bytes UTF-8 spends on one. */
const MAX_FILE_BYTES = PAGE_BOUNDS.MAX_HTML_CHARS * 4;

/**
 * The stream read whole as text, or nothing where it runs past the bound.
 * The reader is cancelled however the read ends, so a stream refused, or
 * one that failed mid-way, holds nothing open behind it.
 */
const readBoundedText = Effect.fnUntraced(function* (stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  return yield* Effect.gen(function* () {
    let text = "";
    let bytes = 0;
    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());
      if (next.done) return Option.some(text + decoder.decode());
      bytes += next.value.byteLength;
      if (bytes > MAX_FILE_BYTES) return Option.none<string>();
      text += decoder.decode(next.value, { stream: true });
    }
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))));
});

/**
 * The page's HTML at the path, read from the agent's sandbox, or the one
 * sentence refusing it. A path is resolved from the checkout: inside it
 * when relative, as written when absolute.
 */
function readPageFile(
  sandbox: NonNullable<PageToolBinding["sandbox"]>,
  path: string,
): Effect.Effect<Result.Result<string, string>> {
  // Note that the rule reads the path as resolved, because `x/.env/.` names the `.env` it spells around.
  const resolved = posix.resolve(sandbox.checkout, path);
  if (isSecretFile(resolved)) return Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.SECRET));
  return Effect.gen(function* () {
    const opened = yield* Effect.tryPromise(() => sandbox.door());
    const stream = yield* Effect.tryPromise(() => opened.readFile({ path: resolved }));
    if (stream === null) return Result.fail(`${SHOW_PAGE_REFUSAL.NO_FILE} ${path}`);
    const text = yield* readBoundedText(stream);
    return Option.match(text, {
      onNone: () => Result.fail(SHOW_PAGE_REFUSAL.TOO_LARGE),
      onSome: (html) => Result.succeed(html),
    });
  }).pipe(Effect.catch(() => Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.UNAVAILABLE))));
}

/** The page's HTML as the call gave it: inline, or read from the path it names; the refusal where it gave neither, both, or a file that does not read. */
function htmlOf(
  binding: PageToolBinding,
  given: { readonly html?: string; readonly path?: string },
): Effect.Effect<Result.Result<string, string>> {
  if ((given.html === undefined) === (given.path === undefined)) {
    return Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.UNREADABLE));
  }
  if (given.html !== undefined) return Effect.succeed(Result.succeed(given.html));
  if (binding.sandbox === undefined)
    return Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.NO_SANDBOX));
  return readPageFile(binding.sandbox, given.path ?? "");
}

/** Why HTML read from a file cannot be a page's: empty, or past the bound in characters. */
function htmlRefusal(html: string): string | undefined {
  if (html.trim() === "") return SHOW_PAGE_REFUSAL.EMPTY;
  return html.length > PAGE_BOUNDS.MAX_HTML_CHARS ? SHOW_PAGE_REFUSAL.TOO_LARGE : undefined;
}

/**
 * The page's mention as the agent writes it, its title as its name; none
 * where its task's workspace cannot be read just now, since the page was
 * shown all the same.
 */
const pageMentionOf = (binding: PageToolBinding, pageId: string, title: string) =>
  taskStepOf(binding.userId, binding.taskId).pipe(
    Effect.tapError(logStoreFailure),
    Effect.option,
    Effect.map((step) =>
      Option.getOrUndefined(
        Option.map(Option.flatten(step), (workspace) =>
          writtenMention(
            { kind: MENTION_KIND.PAGE, taskId: binding.taskId, pageId },
            title,
            workspace,
          ),
        ),
      ),
    ),
  );

/** One call of `show_page` under the task the service bound, by who makes it, Luke or a coding agent, answered as the result the model reads. */
export function runShowPage(
  binding: PageToolBinding,
  input: UnparsedWireValue,
  shownBy: PageShower,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const read = readInput(input);
    if (Result.isFailure(read)) return showPageRejected(SHOW_PAGE_REFUSAL.UNREADABLE);
    const { title, page } = read.success;
    const html = yield* htmlOf(binding, read.success);
    if (Result.isFailure(html)) return showPageRejected(html.failure);
    const refusal = htmlRefusal(html.success);
    if (refusal !== undefined) return showPageRejected(refusal);
    const write: PageWrite =
      page === undefined
        ? { title, html: html.success }
        : { title, html: html.success, pageId: page };
    const written = yield* writePage(binding.userId, binding.taskId, write, shownBy).pipe(
      Effect.tapError(logStoreFailure),
      Effect.option,
    );
    if (Option.isNone(written)) return showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE);
    if (Option.isNone(written.value)) {
      return showPageRejected(
        page === undefined ? SHOW_PAGE_REFUSAL.NO_TASK : SHOW_PAGE_REFUSAL.NO_PAGE,
      );
    }
    const { id, version } = written.value.value;
    const mention = yield* pageMentionOf(binding, id, title);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      page: { id, version, ...(mention === undefined ? undefined : { mention }) },
    } satisfies WireRecord;
  });
}
