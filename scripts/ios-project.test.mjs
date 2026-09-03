import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const project = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "Luke.xcodeproj", "project.pbxproj"),
  "utf8",
);
const watchScheme = fs.readFileSync(
  path.join(
    repoRoot,
    "apps",
    "ios",
    "Luke.xcodeproj",
    "xcshareddata",
    "xcschemes",
    "LukeWatch.xcscheme",
  ),
  "utf8",
);
const watchRoster = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchRosterView.swift"),
  "utf8",
);

test("the iPhone app embeds and depends on the Watch app", () => {
  assert.match(project, /LukeWatch\.app in Embed Watch Content/);
  assert.match(project, /name = "Embed Watch Content";/);
  assert.match(project, /dstPath = "\$\(CONTENTS_FOLDER_PATH\)\/Watch";/);
  assert.match(project, /dstSubfolderSpec = 16;/);
  assert.match(project, /PBXTargetDependency[\s\S]*?target = [^;]+ \/\* LukeWatch \*\//);
});

test("the Watch scheme builds the companion and runs the Watch app", () => {
  assert.match(watchScheme, /BuildableName = "Luke\.app"[\s\S]*?BuildableName = "LukeWatch\.app"/);
  assert.match(
    watchScheme,
    /<LaunchAction[\s\S]*?<BuildableProductRunnable[\s\S]*?BuildableName = "LukeWatch\.app"/,
  );
  assert.match(watchScheme, /<MacroExpansion>[\s\S]*?BuildableName = "Luke\.app"/);
});

test("iPhone and Watch messages use the same Markdown renderer", () => {
  assert.equal(project.match(/MarkdownMessageView\.swift in Sources/g)?.length, 4);
  assert.match(watchRoster, /MarkdownMessageView\(message\.text\)/);
  assert.doesNotMatch(watchRoster, /AttributedString\(markdown:/);
});
