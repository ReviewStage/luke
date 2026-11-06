import langBash from "@shikijs/langs/bash";
import langC from "@shikijs/langs/c";
import langCpp from "@shikijs/langs/cpp";
import langCss from "@shikijs/langs/css";
import langGo from "@shikijs/langs/go";
import langHtml from "@shikijs/langs/html";
import langJava from "@shikijs/langs/java";
import langJavascript from "@shikijs/langs/javascript";
import langJson from "@shikijs/langs/json";
import langJsx from "@shikijs/langs/jsx";
import langKotlin from "@shikijs/langs/kotlin";
import langMarkdown from "@shikijs/langs/markdown";
import langPython from "@shikijs/langs/python";
import langRuby from "@shikijs/langs/ruby";
import langRust from "@shikijs/langs/rust";
import langSql from "@shikijs/langs/sql";
import langSwift from "@shikijs/langs/swift";
import langToml from "@shikijs/langs/toml";
import langTsx from "@shikijs/langs/tsx";
import langTypescript from "@shikijs/langs/typescript";
import langYaml from "@shikijs/langs/yaml";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubLightDefault from "@shikijs/themes/github-light-default";
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export function createTaskCodeHighlighter(): HighlighterCore {
  return createHighlighterCoreSync({
    themes: [githubDarkDefault, githubLightDefault],
    langs: [
      langBash,
      langC,
      langCpp,
      langCss,
      langGo,
      langHtml,
      langJava,
      langJavascript,
      langJson,
      langJsx,
      langKotlin,
      langMarkdown,
      langPython,
      langRuby,
      langRust,
      langSql,
      langSwift,
      langToml,
      langTsx,
      langTypescript,
      langYaml,
    ],
    engine: createJavaScriptRegexEngine(),
  });
}
