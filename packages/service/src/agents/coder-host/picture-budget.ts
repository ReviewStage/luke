import type { LanguageModelMiddleware } from "ai";

/**
 * picture-budget.ts -- the pictures one step of a coding agent sends its model: the newest, inside its provider's bounds.
 *
 * A picture an agent looks at, a screenshot it reads with `read_file`, one
 * of its plan's pictures, or one a message carried, stays in its
 * transcript, and every step after sends the transcript whole. An agent
 * that screenshots its work as it goes so sends more pictures with each
 * step, until its provider refuses the request outright: Anthropic holds
 * every picture of a request carrying more than twenty to 2,000 px a side,
 * and a whole request to 32 MB. The refusal fails the turn, and every step
 * after would send the same pictures, so the agent is lost. Each step here
 * sends only the newest pictures, at most `PICTURE_BUDGET.MOST` of them and
 * `PICTURE_BUDGET.BYTES` of their data, and says in each older one's place
 * that it was left out, so the agent can read it again where it needs to.
 * Note that the oldest are left out `PICTURE_BUDGET.BATCH` at a time rather
 * than one per new picture, because leaving one out changes the request
 * from that picture on, which the provider's prompt cache misses whole; so
 * the cache misses once per batch, not once per step.
 */

const PICTURE_BUDGET = {
  /** The most pictures a step sends: Anthropic's own line, past which every picture of the request is held to 2,000 px a side. */
  MOST: 20,
  /** The most picture data a step sends, base64 as it goes on the wire: half of Anthropic's 32 MB request, the rest left to the words. */
  BYTES: 16 * 1024 * 1024,
  /** How many of the oldest pictures are left out together once the newest no longer fit. */
  BATCH: 10,
} as const;

/** What a model call is asked with, as a middleware is handed it. */
type ModelCallOptions = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"];

type PromptMessage = ModelCallOptions["prompt"][number];

/** A part of a message's content, of any role. */
type MessagePart = PromptMessage["content"][number];

type FilePart = Extract<MessagePart, { type: "file" }>;

type ToolResultPart = Extract<MessagePart, { type: "tool-result" }>;

/** A part of a tool's result as the model is shown it. */
type ResultPart = Extract<ToolResultPart["output"], { type: "content" }>["value"][number];

type ResultFilePart = Extract<ResultPart, { type: "file" }>;

/** The bytes a picture's data takes on the wire: base64 as written, raw bytes as base64 will write them, none for a URL or a reference the provider fetches. */
function wireBytesOf(data: FilePart["data"]): number {
  if (data.type !== "data") return 0;
  return typeof data.data === "string" ? data.data.length : Math.ceil(data.data.byteLength / 3) * 4;
}

/** Whether a file part is a picture. */
function isPicture(part: FilePart | ResultFilePart): boolean {
  return part.mediaType.startsWith("image") && part.data.type !== "text";
}

/** The words that stand in a left-out picture's place. */
function leftOutWords(filename: string | undefined): string {
  const named = filename === undefined ? "An earlier picture" : `The earlier picture ${filename}`;
  return `[${named} was left out of this request, which sends only the newest pictures; read it again if you need to see it.]`;
}

/** Every picture of the prompt, oldest first, by the bytes it takes on the wire. */
function pictureSizesOf(prompt: ModelCallOptions["prompt"]): number[] {
  const sizes: number[] = [];
  for (const message of prompt) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "file" && isPicture(part)) sizes.push(wireBytesOf(part.data));
      if (part.type !== "tool-result" || part.output.type !== "content") continue;
      for (const shown of part.output.value) {
        if (shown.type === "file" && isPicture(shown)) sizes.push(wireBytesOf(shown.data));
      }
    }
  }
  return sizes;
}

/**
 * How many of the oldest pictures a step leaves out: none while every
 * picture fits, else the fewest that leave the newest inside the budget,
 * rounded up to a whole batch where that still keeps one, since a few
 * large pictures may fill the budget long before a batch is sent.
 */
function leftOutCount(sizes: readonly number[]): number {
  let leftOut = Math.max(0, sizes.length - PICTURE_BUDGET.MOST);
  let kept = sizes.slice(leftOut).reduce((total, size) => total + size, 0);
  while (kept > PICTURE_BUDGET.BYTES && leftOut < sizes.length) {
    kept -= sizes[leftOut] ?? 0;
    leftOut += 1;
  }
  const batched = Math.ceil(leftOut / PICTURE_BUDGET.BATCH) * PICTURE_BUDGET.BATCH;
  return batched < sizes.length ? batched : leftOut;
}

/** The prompt with its oldest `count` pictures each replaced by words saying so, kept as it was where `count` is none. */
function withoutOldest(
  prompt: ModelCallOptions["prompt"],
  count: number,
): ModelCallOptions["prompt"] {
  if (count === 0) return prompt;
  let seen = 0;
  // Note that a picture is counted in the same order `pictureSizesOf` counts it, so the oldest are the ones left out.
  const leftOut = (part: FilePart | ResultFilePart) => isPicture(part) && seen++ < count;
  const inPlace = (part: FilePart | ResultFilePart) => ({
    type: "text" as const,
    text: leftOutWords(part.filename),
    ...(part.providerOptions === undefined ? undefined : { providerOptions: part.providerOptions }),
  });
  const resultOf = (part: ToolResultPart): ToolResultPart => {
    if (part.output.type !== "content") return part;
    const value = part.output.value.map((shown) =>
      shown.type === "file" && leftOut(shown) ? inPlace(shown) : shown,
    );
    return { ...part, output: { ...part.output, value } };
  };
  return prompt.map((message): PromptMessage => {
    if (message.role === "system") return message;
    if (message.role === "user") {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "file" && leftOut(part) ? inPlace(part) : part,
        ),
      };
    }
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "tool-result" ? resultOf(part) : part,
        ),
      };
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "file" && leftOut(part)) return inPlace(part);
        return part.type === "tool-result" ? resultOf(part) : part;
      }),
    };
  });
}

/** The middleware that holds every call's pictures to the budget above. */
export const pictureBudgetMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    prompt: withoutOldest(params.prompt, leftOutCount(pictureSizesOf(params.prompt))),
  }),
};
