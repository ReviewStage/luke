import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { markdownHtmlParserAtom } from "../markdown-html-parser.js";
import { rendererRegistry } from "../renderer-runtime.js";

export const markdownHtmlParserLanded: Effect.Effect<void, Error> = AtomRegistry.getResult(
  rendererRegistry,
  markdownHtmlParserAtom,
).pipe(Effect.asVoid);
