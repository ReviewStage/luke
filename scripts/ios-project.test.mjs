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
const watchAccount = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchAccountSession.swift"),
  "utf8",
);
const watchRoot = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "LukeWatchView.swift"),
  "utf8",
);
const watchRosterStore = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchRosterStore.swift"),
  "utf8",
);
const watchConnectivity = fs.readFileSync(
  path.join(repoRoot, "apps", "ios", "LukeWatch", "WatchConnectivityReceiver.swift"),
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

test("the Watch tears down account-scoped UI when the paired account changes", () => {
  assert.match(watchAccount, /private\(set\) var accountScope: String\?/);
  assert.match(watchAccount, /private static func scope\(email: String\)/);
  assert.match(watchAccount, /email\.trimmingCharacters[\s\S]*?\.lowercased\(\)/);
  assert.match(watchAccount, /func signOut\(\)[\s\S]*?accountScope = nil/);
  assert.match(watchRoot, /NavigationStack[\s\S]*?\.id\(watchSession\.accountScope\)/);
  assert.match(watchRoot, /\.onChange\(of: watchSession\.accountScope\)/);
});

test("cancelled Watch roster reads do not become completed empty states", () => {
  assert.match(watchRosterStore, /var completedRequest = false/);
  assert.match(watchRosterStore, /if completedRequest \{[\s\S]*?hasLoaded = true[\s\S]*?\}/);
  assert.match(watchRosterStore, /guard !Task\.isCancelled else \{ return \}/);
});

test("the Watch requests replacement credentials after an expired token", () => {
  assert.match(watchAccount, /@ObservationIgnored var onCredentialsNeeded/);
  assert.match(
    watchAccount,
    /private func invalidateCredentialsAndRequestReplacement\(\)[\s\S]*?signOut\(\)[\s\S]*?onCredentialsNeeded\?\(\)/,
  );
  assert.equal(watchAccount.match(/invalidateCredentialsAndRequestReplacement\(\)/g)?.length, 3);
  assert.match(
    watchConnectivity,
    /watchSession\.onCredentialsNeeded = \{[\s\S]*?requestTokensIfNeeded\(\)/,
  );
});

test("empty Watch conversations leave the native composer interactive", () => {
  assert.match(
    watchRoster,
    /if centersConversationState \{[\s\S]*?conversationContent[\s\S]*?\.allowsHitTesting\(loadError != nil\)/,
  );
});
