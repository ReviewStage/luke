import { describe, expect, it } from "vitest";

import {
  STYLE_RULE,
  type StyleRule,
  styleSuppressionLines,
  styleViolations,
  themeNames,
} from "./style-guard.ts";

const THEME = `@theme inline {
  --color-primary: var(--luke-color-text);
  --text-body: var(--luke-type-body-size);
  --text-body--line-height: var(--luke-type-body-leading);
  --radius-menu: var(--luke-menu-radius);
  --ease-pane: var(--luke-motion-pane);
  --animate-menu-in: luke-menu-in var(--luke-duration-quick) var(--luke-spring-fast);
}`;
const NAMES = themeNames(THEME);
const SHEET = "packages/ui/src/components/thing/thing.css";
const MODULE = "packages/panel/src/thing.tsx";

/** The rules a stylesheet breaks, in order. */
function sheetRules(css: string, file = SHEET): readonly StyleRule[] {
  return styleViolations(file, css, NAMES).map((violation) => violation.rule);
}

/** The rules a module's class strings break, in order. */
function classRules(source: string, file = MODULE): readonly StyleRule[] {
  return styleViolations(file, source, NAMES).map((violation) => violation.rule);
}

describe("a stylesheet", () => {
  it("refuses a colour literal in a rule, and passes a token", () => {
    expect(sheetRules(".a { color: #fff; background: rgba(0, 0, 0, 0.5); }")).toEqual([
      STYLE_RULE.COLOUR,
      STYLE_RULE.COLOUR,
    ]);
    expect(sheetRules(".a { color: var(--luke-color-text); border-color: currentColor; }")).toEqual(
      [],
    );
  });

  it("passes a colour where a token is defined, a brand's ink, and a mask's alpha", () => {
    const css = `
      :root { --file-icon-red: light-dark(#d52c36, #ff6762); }
      :root[data-luke-theme="dark"] { --ink: #fff; }
      [data-luke-theme="dark"] .integration-mark-neon { color: #34d59a; }
      .a { mask-image: linear-gradient(#000, transparent); --terminal-red: #f00; }`;
    expect(sheetRules(css)).toEqual([]);
  });

  it("refuses a colour under a selector that only starts at :root", () => {
    expect(sheetRules(":root .a { color: #000; }")).toEqual([STYLE_RULE.COLOUR]);
  });

  it("refuses a literal font size or weight, and passes the type roles", () => {
    const css = `.a {
      font-size: 13px;
      font-weight: 600;
      font: 500 12px/1.4 system-ui;
      font-size: 0.9em;
    }
    .b {
      font-size: var(--luke-type-body-size);
      font-weight: var(--luke-weight-medium);
      font: inherit;
      font-size: calc(var(--luke-avatar-size) * 0.5);
    }`;
    expect(sheetRules(css)).toEqual([
      STYLE_RULE.TYPE,
      STYLE_RULE.TYPE,
      STYLE_RULE.TYPE,
      STYLE_RULE.TYPE,
    ]);
  });

  it("refuses a literal radius, 50% among them, and passes a role or a factor of one", () => {
    const css = `.a { border-radius: 50%; border-top-left-radius: 4px; }
      .b { border-radius: var(--luke-radius-full); border-radius: 0;
           border-radius: calc(var(--luke-control-height) / 2); }`;
    expect(sheetRules(css)).toEqual([STYLE_RULE.RADIUS, STYLE_RULE.RADIUS]);
  });

  it("refuses an ellipsis", () => {
    expect(sheetRules(".a { overflow: hidden; text-overflow: ellipsis; }")).toEqual([
      STYLE_RULE.ELLIPSIS,
    ]);
    expect(sheetRules(".a { text-overflow: clip; }")).toEqual([]);
  });

  it("refuses a literal duration or delay, and passes a token or none", () => {
    const css = `.a { transition: opacity 200ms; animation-delay: 1s; }
      .b { transition: opacity var(--luke-duration-quick); transition-delay: 0s; }`;
    expect(sheetRules(css)).toEqual([STYLE_RULE.DURATION, STYLE_RULE.DURATION]);
  });

  it("passes a literal duration on an endless loop that answers a play-state token", () => {
    const loop = `.spin {
      animation: turn 900ms linear infinite;
      animation-play-state: var(--luke-loop-motion);
    }`;
    expect(sheetRules(loop)).toEqual([]);
    const unanswered = ".spin { animation: turn 900ms infinite; }";
    expect(sheetRules(unanswered)).toEqual([STYLE_RULE.DURATION]);
  });

  it("still refuses a transition beside a loop, and a finite animation that answers the loop token", () => {
    const beside = `.spin {
      animation: turn 900ms linear infinite;
      animation-play-state: var(--luke-loop-motion);
      transition: opacity 200ms ease;
    }`;
    expect(sheetRules(beside)).toEqual([STYLE_RULE.DURATION]);
    const finite = `.pop {
      animation: pop 300ms both;
      animation-play-state: var(--luke-loop-motion);
    }`;
    expect(sheetRules(finite)).toEqual([STYLE_RULE.DURATION]);
  });

  it("refuses a literal easing in a transition or animation, and passes a token", () => {
    const css = `.a { transition: opacity var(--luke-duration-hover) ease; }
      .b { transition-timing-function: cubic-bezier(0.4, 0, 0.6, 1); }
      .c { --wobble: steps(4); }
      .d { transition: transform var(--luke-duration-fast) var(--luke-spring-fast); }
      .e { transition: opacity var(--luke-duration-hover); }`;
    expect(sheetRules(css)).toEqual([STYLE_RULE.EASING, STYLE_RULE.EASING, STYLE_RULE.EASING]);
  });

  it("refuses a literal width on a picker's, popover's or menu's box, outside @luke/ui, and passes a token, a share, and a glyph in one", () => {
    const panel = "packages/panel/src/styles/tasks.css";
    const css = `.mention-menu { width: 360px; max-width: 100%; }
      .composer .skill-menu { min-width: 20rem; }
      .settings-picker, .thing { max-width: 420px; }
      .a-popover { width: calc(100% - 2 * var(--luke-space-8)); max-width: 100%; }
      .b-menu { width: var(--luke-popover-width-regular); }
      .issue-picker-detail > svg { width: 12px; }
      .menubar { width: 200px; }
      .automation-field { width: 200px; }`;
    expect(sheetRules(css, panel)).toEqual([
      STYLE_RULE.PICKER_WIDTH,
      STYLE_RULE.PICKER_WIDTH,
      STYLE_RULE.PICKER_WIDTH,
    ]);
    expect(sheetRules(css, "packages/ui/src/components/thing/thing.css")).toEqual([]);
  });

  it("refuses a pixel or rem literal on a space in the panel's sheets, and passes a role, a step, zero, auto and a hairline", () => {
    const panel = "packages/panel/src/styles/tasks.css";
    const css = `.a { padding: 8px 12px; margin-left: -5px; gap: 0.5rem; row-gap: 6px; }
      .b { padding-block: max(0px, calc((14px - 1lh) / 2)); margin-inline-start: 4PX; }
      .c { padding: var(--luke-row-inset) var(--luke-list-inset); gap: var(--luke-space-6); }
      .d { margin: 0 auto; padding: 0px; gap: 0; margin-top: 1px; margin-bottom: -1px; }
      .e { padding: var(--luke-card-inset, 12px); margin-left: 0.3em; width: 12px; top: 8px; }
      .f { --people-gap: 8px; scroll-margin-top: 8px; }
      :root { --column-inset: 12px; }`;
    expect(sheetRules(css, panel)).toEqual([
      STYLE_RULE.SPACING,
      STYLE_RULE.SPACING,
      STYLE_RULE.SPACING,
      STYLE_RULE.SPACING,
      STYLE_RULE.SPACING,
      STYLE_RULE.SPACING,
    ]);
  });

  it("reads the spacing rule in the panel's sheets alone", () => {
    const css = ".a { padding: 8px; }";
    expect(sheetRules(css, "packages/panel/src/styles/desktop.css")).toEqual([STYLE_RULE.SPACING]);
    expect(sheetRules(css, "packages/panel/src/tasks/thing.css")).toEqual([]);
    expect(sheetRules(css, "packages/ui/src/components/thing/thing.css")).toEqual([]);
    expect(sheetRules(css, "apps/catalog/src/catalog.css")).toEqual([]);
  });

  it("refuses the hand spelled out or a cursor chosen per profile, and passes the press and link roles and the other cursors", () => {
    const css = `.a { cursor: pointer; }
      [data-luke-profile="desktop"] .b { cursor: default; }
      .c { cursor: var(--luke-cursor-press); }
      .d { cursor: var(--luke-cursor-link); }
      .e { cursor: col-resize; }
      .f:disabled { cursor: default; }
      .g { --luke-cursor-press: pointer; }`;
    expect(sheetRules(css)).toEqual([STYLE_RULE.CURSOR, STYLE_RULE.CURSOR]);
  });

  it("reads declarations through nesting, layers, strings, and comments", () => {
    const css = `@layer components {
      .a {
        content: "{ color: #fff; }"; /* color: #000; } */
        background: url(data:image/png;base64,AAAA);
        &:hover { color: #abc; }
        @media (width > 4px) { .b { border-radius: 3px; } }
      }
    }`;
    const violations = styleViolations(SHEET, css, NAMES);
    expect(violations.map((violation) => [violation.rule, violation.line])).toEqual([
      [STYLE_RULE.COLOUR, 5],
      [STYLE_RULE.RADIUS, 6],
    ]);
  });

  it("checks an @apply's classes", () => {
    expect(sheetRules(".a { @apply truncate text-sm; }")).toEqual([
      STYLE_RULE.ELLIPSIS,
      STYLE_RULE.TYPE,
    ]);
  });

  it("is not read where tokens are defined, nor where agents keep their tools", () => {
    const css = ".a { color: #fff; transition: opacity 90ms ease; }";
    expect(sheetRules(css, "packages/ui/src/tokens/motion.css")).toEqual([]);
    expect(sheetRules(css, "packages/ui/src/tailwind/theme.css")).toEqual([]);
    expect(sheetRules(css, ".agents/skills/shots/shots.css")).toEqual([]);
  });

  it("passes the face's generated motions their literal phases", () => {
    const css = ".face { animation: blink 3200ms cubic-bezier(0.2, 0, 0, 1) both; }";
    expect(sheetRules(css, "packages/ui/src/face/face-motion.css")).toEqual([]);
  });
});

describe("a module's class strings", () => {
  it("refuses Tailwind's own type, radius, motion, and palette", () => {
    const source = `export const A = <div className="text-sm font-medium rounded-md duration-150 ease-in-out bg-red-500 hover:bg-[#fff]" />;`;
    expect(classRules(source)).toEqual([
      STYLE_RULE.TYPE,
      STYLE_RULE.TYPE,
      STYLE_RULE.RADIUS,
      STYLE_RULE.DURATION,
      STYLE_RULE.EASING,
      STYLE_RULE.COLOUR,
      STYLE_RULE.COLOUR,
    ]);
  });

  it("passes the utilities @luke/ui's theme maps onto tokens", () => {
    const source = `const card = cn("text-body bg-primary rounded-menu ease-pane animate-menu-in rounded-full", \`data-open:duration-(--luke-duration-quick) \${x}\`);`;
    expect(classRules(source)).toEqual([]);
  });

  it("refuses truncate in a class list, and passes the word in a sentence or a comment", () => {
    const source = `
      // a \`truncate\` class cuts with an ellipsis
      const label = "We truncate the log at a thousand lines.";
      const cut = <span className="min-w-0 truncate">{name}</span>;
      const words = <p>Don't truncate what's said</p>;`;
    const violations = styleViolations(MODULE, source, NAMES);
    expect(violations.map((violation) => [violation.rule, violation.line])).toEqual([
      [STYLE_RULE.ELLIPSIS, 4],
    ]);
  });

  it("refuses cursor-pointer and a cursor chosen per profile, and passes cursor-press, cursor-link and the other cursors", () => {
    const source = `const a = cn("cursor-pointer in-data-[luke-profile=desktop]:cursor-default", "cursor-press disabled:cursor-default cursor-link cursor-progress cursor-text");`;
    expect(classRules(source)).toEqual([STYLE_RULE.CURSOR, STYLE_RULE.CURSOR]);
  });

  it("reads a class list whose arbitrary value holds a character no class name has", () => {
    const source = `const a = <nav className="flex rounded-md [&>*+*]:before:content-['·']" />;`;
    expect(classRules(source)).toEqual([STYLE_RULE.RADIUS]);
  });

  it("is not read in a test", () => {
    const source = `const a = <div className="text-sm" />;`;
    expect(classRules(source, "packages/panel/src/thing.test.tsx")).toEqual([]);
  });
});

describe("styleSuppressionLines", () => {
  it("finds a comment asking to silence the guard, and passes the markers DESIGN.md defines", () => {
    const css = [
      ".a { color: #fff; } /* style-guard-disable */",
      "/* stylelint-disable-next-line */",
      ".b { outline: none; /* no ring: the caret marks the field */ }",
      ".c { padding: 3px; /* off-scale: optical */ }",
    ].join("\n");
    expect(styleSuppressionLines(css)).toEqual([1, 2]);
  });
});
