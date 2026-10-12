// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { VoiceSpeakers } from "#shared/messages/voice-view";
import { captionStripProps } from "#testing/captions";
import { navigationHistory } from "#testing/navigation-history";
import { plansControl, usedPlan } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppKeymap } from "./app-commands";
import { CaptionStrip, type CaptionStripProps } from "./caption-strip";
import { DesktopShell } from "./desktop/desktop-shell";
import { useSidebarCollapse } from "./desktop/sidebar-collapse";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "./planning/planning-model";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "./planning/transcript-model";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
  useSidePanel,
} from "./planning/use-side-panel";
import {
  CAPTION_LINGER_MS,
  CAPTION_TONE,
  type CaptionContent,
  useCaptionPresentation,
} from "./use-caption-presentation";

const ignore = () => undefined;

const PLAN: Plan = {
  id: "0f6c2a1e-5b7d-4e3a-8c91-2d4f6a8b0c13",
  name: "Invoice export",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Invoice export", assumptions: [] },
};

const LUKE_WORDS = "The export runs nightly and writes one file per account.";

const LUKE_SPEAKING: CaptionContent = { tone: CAPTION_TONE.LUKE, words: LUKE_WORDS };

/** A transcript whose read landed, drawing the plan's calls. */
const TRANSCRIPT_READY: TranscriptRegion = {
  kind: TRANSCRIPT_REGION.READY,
  calls: [],
  earlierOmitted: false,
};

/** The panel open beside the plan on the tab given. */
function panelOn(tab: SidePanelState["tab"]): SidePanelState {
  return { open: true, tabs: SIDE_PANEL_TABS, tab, width: SIDE_PANEL_WIDTH.DEFAULT };
}

/** The window as `App` stands it over an open plan whose panel is staged, the captions handed in. */
function Window({
  tab,
  staged,
  captions,
  transcript = TRANSCRIPT_READY,
}: {
  tab: PanelTab;
  staged: SidePanelState | undefined;
  captions: CaptionStripProps;
  transcript?: TranscriptRegion;
}): React.JSX.Element {
  const sidebar = useSidebarCollapse(false);
  const sidePanel = useSidePanel(staged, usedPlan(PLAN.id));
  useAppKeymap(true);
  return createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
    },
    identity: {
      speakers: { listening: false, lukeSpeaking: true },
      voiceActive: { developer: false, luke: true },
      fixtureSpeaking: false,
      voiceOpening: false,
    },
    tab,
    onTabChange: ignore,
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
      transcript: { region: transcript, onRetry: ignore },
    }),
    history: navigationHistory(),
    sidebar,
    call: undefined,
    captions,
    settings: settingsPanelProps(),
  });
}

/** The voice view's words as `App` reads them, through the presentation and into the strip. */
function Strip({
  lukeCaptions,
  developerCaptions,
  voiceError,
  voiceNotice,
  speakers,
}: {
  lukeCaptions?: readonly string[];
  developerCaptions?: readonly string[];
  voiceError?: string;
  voiceNotice?: string;
  speakers: VoiceSpeakers;
}): React.JSX.Element {
  const caption = useCaptionPresentation({
    lukeCaptions,
    developerCaptions,
    voiceError,
    voiceNotice,
    speakers,
    fixtureSpeaking: false,
  });
  return createElement(CaptionStrip, { ...captionStripProps(), caption });
}

let root: Root | undefined;

function render(element: React.ReactElement): void {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(element);
  });
}

function strip(): HTMLElement {
  const caption = document.body.querySelector<HTMLElement>(".voice-caption");
  assert.ok(caption, "the caption strip is mounted");
  return caption;
}

/** Whether the strip is drawn, and what a sighted developer reads on it. */
function reads(): string | undefined {
  const caption = strip();
  return caption.dataset.shown === "true" ? (caption.textContent ?? "") : undefined;
}

function pressTab(label: string): void {
  const tab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(tab, `no ${label} tab`);
  act(() => tab.click());
}

function pressNamed(label: string): void {
  const button = document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  assert.ok(button, `no ${label} button`);
  act(() => button.click());
}

beforeEach(() => {
  window.localStorage.clear();
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

test("Luke's words stand just above the call bar, labelled with his name, clear of the side panel", () => {
  render(
    createElement(Window, {
      tab: PANEL_TAB.PLANS,
      staged: panelOn(SIDE_PANEL_TAB.BOARD),
      captions: captionStripProps(LUKE_SPEAKING),
    }),
  );
  const bar = document.body.querySelector(".desktop-call-bar");
  assert.ok(bar, "the plan's call bar is drawn");
  assert.equal(strip().parentElement, bar);
  assert.equal(strip().nextElementSibling, bar.querySelector("footer.call-bar"));
  assert.equal(strip().closest("aside"), null);
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
});

test("the captions are held back while the Transcript is the panel's chosen tab, and come back on another tab", () => {
  render(
    createElement(Window, {
      tab: PANEL_TAB.PLANS,
      staged: panelOn(SIDE_PANEL_TAB.TRANSCRIPT),
      captions: captionStripProps(LUKE_SPEAKING),
    }),
  );
  assert.equal(reads(), undefined);
  pressTab("Board");
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
  pressTab("Transcript");
  assert.equal(reads(), undefined);
});

test("the captions come back when the panel showing the Transcript closes", () => {
  render(
    createElement(Window, {
      tab: PANEL_TAB.PLANS,
      staged: panelOn(SIDE_PANEL_TAB.TRANSCRIPT),
      captions: captionStripProps(LUKE_SPEAKING),
    }),
  );
  assert.equal(reads(), undefined);
  pressNamed("Hide panel");
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
});

test("a Transcript tab standing behind the chosen one does not hold the captions back", () => {
  render(
    createElement(Window, {
      tab: PANEL_TAB.PLANS,
      staged: panelOn(SIDE_PANEL_TAB.CODE),
      captions: captionStripProps(LUKE_SPEAKING),
    }),
  );
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
});

test("a Transcript still reading, or whose read failed, shows no words, so the captions stay", () => {
  for (const transcript of [
    { kind: TRANSCRIPT_REGION.READING },
    { kind: TRANSCRIPT_REGION.FAILED },
  ] as const) {
    render(
      createElement(Window, {
        tab: PANEL_TAB.PLANS,
        staged: panelOn(SIDE_PANEL_TAB.TRANSCRIPT),
        captions: captionStripProps(LUKE_SPEAKING),
        transcript,
      }),
    );
    assert.equal(reads(), `Luke${LUKE_WORDS}`, transcript.kind);
  }
});

test("a voice failure is drawn over the Transcript, since nothing there says it", () => {
  const failure = "Luke's voice could not connect. Try again in a moment.";
  render(
    createElement(Window, {
      tab: PANEL_TAB.PLANS,
      staged: panelOn(SIDE_PANEL_TAB.TRANSCRIPT),
      captions: captionStripProps({ tone: CAPTION_TONE.ERROR, words: failure }),
    }),
  );
  assert.equal(reads(), failure);
  assert.equal(strip().querySelector('[role="status"]')?.textContent, failure);
});

test("in Settings the captions float at the window's foot, there being no call bar to stand on", () => {
  render(
    createElement(Window, {
      tab: PANEL_TAB.SETTINGS,
      staged: undefined,
      captions: captionStripProps(LUKE_SPEAKING),
    }),
  );
  assert.ok(strip().parentElement?.classList.contains("desktop-shell"));
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
});

test("the developer's own words are labelled as theirs, and Luke's take the strip over them", () => {
  const asked = "Does it retry a failed account?";
  render(
    createElement(Strip, {
      developerCaptions: [asked],
      speakers: { listening: true, lukeSpeaking: false },
    }),
  );
  assert.equal(reads(), `You${asked}`);
  render(
    createElement(Strip, {
      developerCaptions: [asked],
      lukeCaptions: ["It does,", "three times."],
      speakers: { listening: true, lukeSpeaking: true },
    }),
  );
  assert.equal(reads(), "LukeIt does, three times.");
});

test("a notice answered while the developer speaks takes the strip over their own words", () => {
  const notice = "The microphone is open. Finish saying it.";
  render(
    createElement(Strip, {
      developerCaptions: ["Can we also export credit notes"],
      voiceNotice: notice,
      speakers: { listening: true, lukeSpeaking: false },
    }),
  );
  assert.equal(reads(), notice);
});

test("words rewrapped onto more lines by a resize keep the newest line in view", () => {
  render(
    createElement(Strip, {
      lukeCaptions: [LUKE_WORDS],
      speakers: { listening: false, lukeSpeaking: true },
    }),
  );
  const words = strip().querySelector<HTMLElement>(".voice-caption-words");
  assert.ok(words, "the words are drawn");
  // A narrower window wraps the same words onto a third line.
  Object.defineProperty(words, "scrollHeight", { configurable: true, value: 66 });
  act(() => relayout());
  assert.equal(words.scrollTop, 66);
});

test("Luke's last words stay a moment after he stops, then leave", () => {
  vi.useFakeTimers();
  const speakers = { listening: false, lukeSpeaking: true };
  render(createElement(Strip, { lukeCaptions: [LUKE_WORDS], speakers }));
  render(createElement(Strip, { speakers: { listening: false, lukeSpeaking: false } }));
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
  act(() => vi.advanceTimersByTime(CAPTION_LINGER_MS - 1));
  assert.equal(reads(), `Luke${LUKE_WORDS}`);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(reads(), undefined);
  render(createElement(Strip, { lukeCaptions: ["And a summary at the end."], speakers }));
  assert.equal(reads(), "LukeAnd a summary at the end.");
});

test("with the Captions setting off no words arrive, and the strip draws nothing while Luke speaks", () => {
  render(createElement(Strip, { speakers: { listening: false, lukeSpeaking: true } }));
  assert.equal(reads(), undefined);
  assert.ok(strip().hasAttribute("inert"), "an undrawn strip takes no focus");
});
