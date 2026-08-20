#!/usr/bin/env node
// Shared surface vocabulary — the single source for the tokens, marks, labels,
// and window-layout sizes both the desktop renderer and the marketing mock
// draw from.
//
//   node design/generate-surface-shared.mjs
//
// It writes four committed outputs into packages/surface/src/generated, all from the
// tables further down:
//
//   src/motion-tokens.css       springs, durations, and the layout sizes
//   src/motion-tokens.ts        the same durations and sizes, as numbers
//   src/provider-mark-paths.ts  SVG path data for every provider mark
//   src/session-display.ts      urgency value set, labels, and order
//
// The React that traces the marks, and the rules that consume the tokens, stay
// in each app: a shared component would pull desktop-only marks into the web
// bundle. Emitting the data from here keeps the second copy from being a
// second source. `repository-checks.sh` runs this with `--check`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE = join(HERE, "..", "packages", "surface", "src", "generated");

// ---------- Motion tokens ----------
// Sampled damped springs, one duration. A real spring's motion is a property
// of the spring, not of how far it is asked to travel, which is why the same
// samples serve a 176px peek and a 482px panel.
const SPRING = [
  0, 0.0285, 0.0993, 0.1943, 0.3005, 0.4083, 0.5115, 0.6061, 0.69, 0.7623, 0.8229, 0.8727, 0.9125,
  0.9437, 0.9674, 0.9848, 0.9972, 1.0056, 1.0109, 1.0138, 1.015, 1.015, 1.0142, 1.0129, 1.0114,
  1.0098, 1,
];
// The same damping ratio; only the frequency changes, which is what a smaller
// and lighter element wants.
const SPRING_FAST = [
  0, 0.0288, 0.1002, 0.1961, 0.3029, 0.4113, 0.5149, 0.6097, 0.6935, 0.7656, 0.826, 0.8755, 0.9149,
  0.9457, 0.969, 0.9861, 0.9982, 1.0063, 1.0113, 1.014, 1.0151, 1.015, 1.0141, 1.0127, 1.0112,
  1.0095, 1,
];

const MOTION_DURATION_MS = {
  FAST: 280,
  SURFACE: 460,
  EXIT: 90,
  QUICK: 140,
  HOVER: 70,
};
const MOTION_DELAY_MS = {
  EXPAND: 200,
  PEEK: 60,
  ROW_STAGGER: 32,
};
const MOTION_EXIT = "cubic-bezier(0.4, 0, 0.6, 1)";
const ROW_FAN_PX = 7;
const ROW_FAN_LIMIT = 5;

// Window layout sizes the main process and both stylesheets spend. The bubble
// lift is derived: the pill matches the 24pt menu bar it floats beside, which
// is the 32px compact strip minus this much on each side. `--shape-top` is
// assigned from `--bubble-lift` only on a display without a housing; a notch
// stays at the edge.
const SURFACE_GEOMETRY_PX = {
  BUBBLE_LIFT: 4,
  // The caption block shows a spoken reply whole — the block grows to the
  // words and nothing scrolls — so the reservation must sit past what a
  // reply wraps to at the peek's width: fourteen 14px lines plus the block's
  // own padding, room enough for two long responses stacked. The window
  // cannot resize for speech, so this bound is physical: a reply taller
  // still clips at the block's edge rather than growing the window.
  VOICE_CAPTION_MAX_HEIGHT: 210,
  // The notice band under the housing: one row of the pressable chips naming
  // the sessions the reply being spoken is about. The chips size to their
  // names and wrap naturally, so the renderer measures the rows they made
  // and grows the shape by that, the caption block's own pattern. The
  // compact window reserves `SESSION_NOTICE_MAX_ROWS` of these on top of
  // the caption room, because captioned speech drops below the chips' band
  // and a reply may name more sessions than one row holds.
  SESSION_NOTICE_HEIGHT: 26,
  PANEL_WIDTH: 620,
  PANEL_MAX_HEIGHT: 520,
};

// How many chip rows the notice band may grow to before the chips scroll
// inside it instead. A count, not pixels: the window reserves this many
// `SESSION_NOTICE_HEIGHT` rows, and the band clamps its own growth to it.
const SESSION_NOTICE_MAX_ROWS = 3;

// ---------- Session display ----------
// How the surface ranks a row, not what the provider observed. Keys are the
// SESSION_URGENCY members; values are the sentence a row states when the
// provider reported nothing else. "Urgency" rather than "display state"
// because the latter still collides with SESSION_STATUS in conversation,
// and the sort already speaks this language.
const URGENCY_LABEL = {
  WORKING: "Working",
  ATTENTION: "Needs you",
  COMPLETE: "Complete",
  UNKNOWN: "Idle",
};
const URGENCY_PRIORITY = ["ATTENTION", "WORKING", "COMPLETE", "UNKNOWN"];

// ---------- Provider mark paths ----------
// Each is the provider's own mark, reproduced rather than redrawn. Attribution
// lives with the React that traces them; this table is only the geometry.
const MARK_PATHS = {
  CLAUDE_CODE:
    "M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z",
  CODEX:
    "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z",
  COPILOT:
    "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z",
  CURSOR:
    "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
  DEVIN:
    "M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.005 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z",
  LINEAR:
    "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
  JULES:
    "M4.2 24q-1.26 0-2.13-.87T1.2 21v-.6q0-.51.345-.855T2.4 19.2t.855.345.345.855v.6q0 .24.18.42t.42.18.42-.18.18-.42V7.2q0-3 2.1-5.1T12 0t5.1 2.1 2.1 5.1V21q0 .24.18.42t.42.18.42-.18.18-.42v-.6q0-.51.345-.855t.855-.345.855.345.345.855v.6q0 1.26-.87 2.13T19.8 24t-2.13-.87T16.8 21v-5.4h-1.62v4.8q0 .51-.345.855t-.855.345-.855-.345-.345-.855v-4.8h-1.59v4.8q0 .51-.345.855t-.855.345-.855-.345-.345-.855v-4.8H7.2V21q0 1.26-.87 2.13T4.2 24m4.2-11.4q.54 0 .87-.45t.33-1.05-.33-1.05-.87-.45-.87.45-.33 1.05.33 1.05.87.45m7.2 0q.54 0 .87-.45t.33-1.05-.33-1.05-.87-.45-.87.45-.33 1.05.33 1.05.87.45",
  OPENAI:
    "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  OPENCODE_FRAME: "M384 416H128V96H384V416ZM320 160H192V352H320V160Z",
  OPENCODE_BLOCK: "M320 224V352H192V224H320Z",
  /*
   * Orca's whale mark, verbatim from the logo the Orca repository publishes
   * (stablyai/orca, resources/logo.svg). The artwork sits in a 318.6×202.7 box
   * whose group offsets the path by (6.67, 70.67); the component reproduces
   * the offset with its viewBox rather than rewriting the published path.
   */
  ORCA: "m 177.81311,248.33334 c 23.82304,-41.29793 40.54045,-66.84626 49.51207,-75.66667 6.81685,-6.70196 10.07373,-8.7374 20.07265,-12.54475 34.57822,-13.16655 61.04674,-26.78733 72.37222,-37.24295 9.62924,-8.88966 9.34286,-9.01142 -23.43671,-9.964 -35.71756,-1.03796 -43.72989,0.42119 -62.17546,11.323 -16.72118,9.88265 -34.20103,30.11225 -42.74704,49.47157 -2.57353,5.82985 -14.81294,44.3056 -27.96399,87.90747 -2.86036,9.48343 -3.02466,11.71633 -0.86213,11.71633 0.44382,0 7.29659,-11.25 15.22839,-25 z m -65.14644,-8.32267 C 120,239.3326 130.5,237.50979 136,235.95998 c 5.5,-1.5498 12.25,-3.13783 15,-3.52895 2.75,-0.39111 5,-0.95485 5,-1.25275 0,-0.29789 2.15135,-7.58487 4.78078,-16.19328 8.49209,-27.80201 12.21334,-40.41629 21.13747,-71.65166 4.81891,-16.86667 11.23502,-39.185 14.25802,-49.596301 5.12803,-17.66103 5.74763,-23.07037 2.64253,-23.07037 -1.84887,0 -4.07048,6.908293 -16.72243,52.000001 -21.78975,77.65896 -20.80806,74.74393 -26.84794,79.72251 -7.5925,6.25838 -25.03916,14.82524 -36.10856,17.73044 -17.0947,4.48656 -33.410599,3.86724 -53.116765,-2.01622 -18.569242,-5.54403 -23.142662,-5.80284 -33.639754,-1.9037 -5.875424,2.18242 -9.864152,5.04363 -16.716684,11.99127 -4.95,5.0187 -9.0000001,10.02884 -9.0000001,11.13364 0,1.75174 5.9276921,2.00299 46.3333351,1.96383 25.483334,-0.0247 52.333338,-0.59969 59.666668,-1.27777 z M 252.69513,104.63708 c 12.18267,-3.48651 15.77304,-7.895503 9.63821,-11.835773 -10.19296,-6.546726 -36.19849,-1.77301 -41.19436,7.561863 -1.2556,2.3461 -0.98698,3.2037 1.68353,5.375 2.69471,2.19098 4.59991,2.47691 12.53928,1.88189 5.14899,-0.3859 12.94899,-1.72824 17.33334,-2.98298 z",
  // One 12-unit square per grid cell, the idiom Superset's own wordmark path
  // uses, so adjacent cells merge into the four bracket strokes when filled.
  SUPERSET:
    "M12 0H24V12H12ZM24 0H36V12H24ZM60 0H72V12H60ZM72 0H84V12H72ZM96 0H108V12H96ZM108 0H120V12H108ZM144 0H156V12H144ZM156 0H168V12H156ZM12 12H24V24H12ZM60 12H72V24H60ZM108 12H120V24H108ZM156 12H168V24H156ZM0 24H12V36H0ZM48 24H60V36H48ZM120 24H132V36H120ZM168 24H180V36H168ZM0 36H12V48H0ZM48 36H60V48H48ZM120 36H132V48H120ZM168 36H180V48H168ZM12 48H24V60H12ZM60 48H72V60H60ZM108 48H120V60H108ZM156 48H168V60H156ZM12 60H24V72H12ZM24 60H36V72H24ZM60 60H72V72H60ZM72 60H84V72H72ZM96 60H108V72H96ZM108 60H120V72H108ZM144 60H156V72H144ZM156 60H168V72H156Z",
};

const CONDUCTOR_MARK_PATHS = [
  "M4.57422 63.6992H22.373V37.251H4.57422C3.58785 37.2511 2.78711 38.0517 2.78711 39.0381V61.9121C2.78725 62.8984 3.58794 63.6991 4.57422 63.6992Z",
  "M36.5977 63.6992H18.7988V37.251H36.5977C37.584 37.2511 38.3848 38.0517 38.3848 39.0381V61.9121C38.3846 62.8984 37.5839 63.6991 36.5977 63.6992Z",
  "M4.57422 100.297H22.373V73.8486H4.57422C3.58785 73.8488 2.78711 74.6493 2.78711 75.6357V98.5098C2.78725 99.496 3.58794 100.297 4.57422 100.297Z",
  "M36.5977 100.297H18.7988V73.8486H36.5977C37.584 73.8488 38.3848 74.6493 38.3848 75.6357V98.5098C38.3846 99.496 37.5839 100.297 36.5977 100.297Z",
  "M4.57422 136.896H22.373V110.447H4.57422C3.58785 110.447 2.78711 111.248 2.78711 112.234V135.108C2.78725 136.095 3.58794 136.895 4.57422 136.896Z",
  "M36.5977 136.896H18.7988V110.447H36.5977C37.584 110.447 38.3848 111.248 38.3848 112.234V135.108C38.3846 136.095 37.5839 136.895 36.5977 136.896Z",
  "M22.873 173.493H40.6719V147.045H22.873C21.8867 147.045 21.0859 147.846 21.0859 148.832V171.706C21.0861 172.692 21.8868 173.493 22.873 173.493Z",
  "M37.0967 173.493V147.045H58.9707V173.493H37.0967Z",
  "M55.3955 173.493V147.045H77.2695V173.493H55.3955Z",
  "M91.4941 173.493H73.6953V147.045H91.4941C92.4805 147.045 93.2812 147.846 93.2812 148.832V171.706C93.2811 172.692 92.4804 173.493 91.4941 173.493Z",
  "M77.7695 136.896H95.5684V110.447H77.7695C76.7832 110.447 75.9824 111.248 75.9824 112.234V135.108C75.9826 136.095 76.7833 136.895 77.7695 136.896Z",
  "M109.793 136.896H91.9941V110.447H109.793C110.779 110.447 111.58 111.248 111.58 112.234V135.108C111.58 136.095 110.779 136.895 109.793 136.896Z",
  "M22.873 27.1006H40.6719V0.652344H22.873C21.8867 0.652488 21.0859 1.45305 21.0859 2.43945V25.3135C21.0861 26.2998 21.8868 27.1004 22.873 27.1006Z",
  "M37.0967 27.1006V0.652344H58.9707V27.1006H37.0967Z",
  "M55.3955 27.1006V0.652344H77.2695V27.1006H55.3955Z",
  "M73.6963 27.1006V0.652344H95.5703V27.1006H73.6963Z",
  "M109.793 27.1006H91.9941V0.652344H109.793C110.779 0.652488 111.58 1.45305 111.58 2.43945V25.3135C111.58 26.2998 110.779 27.1004 109.793 27.1006Z",
  "M77.7695 63.6992H95.5684V37.251H77.7695C76.7832 37.2511 75.9824 38.0517 75.9824 39.0381V61.9121C75.9826 62.8984 76.7833 63.6991 77.7695 63.6992Z",
  "M109.793 63.6992H91.9941V37.251H109.793C110.779 37.2511 111.58 38.0517 111.58 39.0381V61.9121C111.58 62.8984 110.779 63.6991 109.793 63.6992Z",
];

/*
 * Google Calendar's flat product icon, verbatim from the mark Google
 * distributes (the 2020 icon; trademark of Google LLC). It is the one mark
 * that carries its own colours rather than a single brand colour, so it is a
 * list of filled layers instead of one path. Geometry as published: a 200×200
 * box with the artwork offset by 3.75 on each axis, which the component
 * reproduces with the same translate. Do not restyle or recolour.
 */
const GOOGLE_CALENDAR_MARK_LAYERS = [
  {
    fill: "#ffffff",
    path: "M148.882,43.618l-47.368-5.263l-57.895,5.263L38.355,96.25l5.263,52.632l52.632,6.579l52.632-6.579l5.263-53.947L148.882,43.618z",
  },
  {
    fill: "#1a73e8",
    path: "M65.211,125.276c-3.934-2.658-6.658-6.539-8.145-11.671l9.132-3.763c0.829,3.158,2.276,5.605,4.342,7.342c2.053,1.737,4.553,2.592,7.474,2.592c2.987,0,5.553-0.908,7.697-2.724s3.224-4.132,3.224-6.934c0-2.868-1.132-5.211-3.395-7.026s-5.105-2.724-8.5-2.724h-5.276v-9.039H76.5c2.921,0,5.382-0.789,7.382-2.368c2-1.579,3-3.737,3-6.487c0-2.447-0.895-4.395-2.684-5.855s-4.053-2.197-6.803-2.197c-2.684,0-4.816,0.711-6.395,2.145s-2.724,3.197-3.447,5.276l-9.039-3.763c1.197-3.395,3.395-6.395,6.618-8.987c3.224-2.592,7.342-3.895,12.342-3.895c3.697,0,7.026,0.711,9.974,2.145c2.947,1.434,5.263,3.421,6.934,5.947c1.671,2.539,2.5,5.382,2.5,8.539c0,3.224-0.776,5.947-2.329,8.184c-1.553,2.237-3.461,3.947-5.724,5.145v0.539c2.987,1.25,5.421,3.158,7.342,5.724c1.908,2.566,2.868,5.632,2.868,9.211s-0.908,6.776-2.724,9.579c-1.816,2.803-4.329,5.013-7.513,6.618c-3.197,1.605-6.789,2.421-10.776,2.421C73.408,129.263,69.145,127.934,65.211,125.276z",
  },
  {
    fill: "#1a73e8",
    path: "M121.25,79.961l-9.974,7.25l-5.013-7.605l17.987-12.974h6.895v61.197h-9.895L121.25,79.961z",
  },
  {
    fill: "#ea4335",
    path: "M148.882,196.25l47.368-47.368l-23.684-10.526l-23.684,10.526l-10.526,23.684L148.882,196.25z",
  },
  {
    fill: "#34a853",
    path: "M33.092,172.566l10.526,23.684h105.263v-47.368H43.618L33.092,172.566z",
  },
  {
    fill: "#4285f4",
    path: "M12.039-3.75C3.316-3.75-3.75,3.316-3.75,12.039v136.842l23.684,10.526l23.684-10.526V43.618h105.263l10.526-23.684L148.882-3.75H12.039z",
  },
  {
    fill: "#188038",
    path: "M-3.75,148.882v31.579c0,8.724,7.066,15.789,15.789,15.789h31.579v-47.368H-3.75z",
  },
  {
    fill: "#fbbc04",
    path: "M148.882,43.618v105.263h47.368V43.618l-23.684-10.526L148.882,43.618z",
  },
  {
    fill: "#1967d2",
    path: "M196.25,43.618V12.039c0-8.724-7.066-15.789-15.789-15.789h-31.579v47.368H196.25z",
  },
];

const CLOUD_BADGE_PATH =
  "M4.5 14a4.5 4.5 0 0 1-1.259-8.82 7 7 0 0 1 13.518 0A4.5 4.5 0 0 1 15.5 14z";

// ---------- Emission ----------
const CHECK_ONLY = process.argv.includes("--check");
const written = [];
const stale = [];

function put(path, content) {
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current !== content) stale.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linearCss(samples) {
  return `linear(\n    ${samples.join(",\n    ")}\n  )`;
}

function ms(value) {
  return `${value}ms`;
}

function px(value) {
  return `${value}px`;
}

function motionTokensCss() {
  return `/* Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   One motion vocabulary for both surfaces. The desktop renderer and the
   marketing mock import this file so a spring, a duration, or a layout size
   cannot drift between the product and the page that advertises it. */

:root {
  --spring: ${linearCss(SPRING)};
  --spring-fast: ${linearCss(SPRING_FAST)};
  --duration-fast: ${ms(MOTION_DURATION_MS.FAST)};
  --motion-exit: ${MOTION_EXIT};
  --duration-shape: ${ms(MOTION_DURATION_MS.SURFACE)};
  --duration-exit: ${ms(MOTION_DURATION_MS.EXIT)};
  --duration-quick: ${ms(MOTION_DURATION_MS.QUICK)};
  --duration-hover: ${ms(MOTION_DURATION_MS.HOVER)};
  --expand-delay: ${ms(MOTION_DELAY_MS.EXPAND)};
  --peek-delay: ${ms(MOTION_DELAY_MS.PEEK)};
  --row-stagger: ${ms(MOTION_DELAY_MS.ROW_STAGGER)};
  --row-fan: ${ROW_FAN_PX}px;
  --row-fan-limit: ${ROW_FAN_LIMIT};
  --slot-delay: calc(var(--duration-exit) + var(--peek-delay));
  --bubble-lift: ${px(SURFACE_GEOMETRY_PX.BUBBLE_LIFT)};
  --caption-max: ${px(SURFACE_GEOMETRY_PX.VOICE_CAPTION_MAX_HEIGHT)};
  --notice-size: ${px(SURFACE_GEOMETRY_PX.SESSION_NOTICE_HEIGHT)};
  --notice-max-rows: ${SESSION_NOTICE_MAX_ROWS};
  --panel-width: ${px(SURFACE_GEOMETRY_PX.PANEL_WIDTH)};
  --panel-height-max: ${px(SURFACE_GEOMETRY_PX.PANEL_MAX_HEIGHT)};
}
`;
}

function tsRecord(entries, indent = "  ") {
  return entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");
}

function motionTokensTs() {
  return `// Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Millisecond mirrors of the CSS duration tokens in motion-tokens.css, from the
// same table. A main-process constant that waits on a CSS total names these
// rather than restating the numbers. Pixel sizes follow the same rule: the
// window and the drawing both name these, and the stylesheet spends the CSS
// variables emitted beside them.

export const MOTION_DURATION_MS = {
${tsRecord(Object.entries(MOTION_DURATION_MS).map(([key, value]) => [key, value]))}
} as const;

export const MOTION_DELAY_MS = {
${tsRecord(Object.entries(MOTION_DELAY_MS).map(([key, value]) => [key, value]))}
} as const;

/** How far a bubble floats off the display's top edge. CSS: \`--bubble-lift\`. */
export const BUBBLE_LIFT = ${SURFACE_GEOMETRY_PX.BUBBLE_LIFT};

/** Tallest caption block the window holds — sized past a whole spoken reply,
 * because the block grows to the words and nothing scrolls. CSS: \`--caption-max\`. */
export const VOICE_CAPTION_MAX_HEIGHT = ${SURFACE_GEOMETRY_PX.VOICE_CAPTION_MAX_HEIGHT};

/** One chip row of the session notice band. CSS: \`--notice-size\`. */
export const SESSION_NOTICE_HEIGHT = ${SURFACE_GEOMETRY_PX.SESSION_NOTICE_HEIGHT};

/** Chip rows the band may grow to before scrolling. CSS: \`--notice-max-rows\`. */
export const SESSION_NOTICE_MAX_ROWS = ${SESSION_NOTICE_MAX_ROWS};

/** Expanded panel width. CSS: \`--panel-width\`. */
export const PANEL_WIDTH = ${SURFACE_GEOMETRY_PX.PANEL_WIDTH};

/** Expanded panel height ceiling. CSS: \`--panel-height-max\`. */
export const PANEL_MAX_HEIGHT = ${SURFACE_GEOMETRY_PX.PANEL_MAX_HEIGHT};
`;
}

function tsStringConst(name, value) {
  const single = `export const ${name} = "${value}";`;
  return single.length <= 100 ? single : `export const ${name} =\n  "${value}";`;
}

function providerMarkPathsTs() {
  const pathConsts = Object.entries(MARK_PATHS)
    .map(([name, path]) => tsStringConst(`${name}_PATH`, path))
    .join("\n\n");
  const conductor = CONDUCTOR_MARK_PATHS.map((path) => `  "${path}",`).join("\n");
  // One property per line, matching the shape Biome would format these to —
  // the emitted file is committed and linted, so the two must agree exactly.
  const googleCalendar = GOOGLE_CALENDAR_MARK_LAYERS.map(
    (layer) => `  {\n    fill: "${layer.fill}",\n    path: "${layer.path}",\n  },`,
  ).join("\n");
  return `// Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// SVG path data for every provider mark both surfaces draw. The React that
// traces them stays in each app, because the desktop ships marks the marketing
// mock does not, and a shared component would pull that into the web bundle.

${pathConsts}

export const CONDUCTOR_MARK_PATHS = [
${conductor}
] as const;

// The one mark that carries its own colours: Google Calendar's flat product
// icon, drawn as filled layers in a 200×200 box offset by 3.75 on each axis.
export const GOOGLE_CALENDAR_MARK_LAYERS: readonly { fill: string; path: string }[] = [
${googleCalendar}
];

${tsStringConst("CLOUD_BADGE_PATH", CLOUD_BADGE_PATH)}
`;
}

function sessionDisplayTs() {
  const labels = Object.entries(URGENCY_LABEL)
    .map(([key, label]) => `  [SESSION_URGENCY.${key}]: "${label}",`)
    .join("\n");
  const labelCases = Object.entries(URGENCY_LABEL)
    .map(([key, label]) => `    case SESSION_URGENCY.${key}:\n      return "${label}";`)
    .join("\n");
  const priority = URGENCY_PRIORITY.map((key) => `  SESSION_URGENCY.${key},`).join("\n");
  return `// Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// How urgently the surface treats a row — not the provider-observed condition
// in SESSION_STATUS. Both value sets contain the literal "working"; the brand
// keeps one from typechecking as the other. Labels and order live here so the
// marketing mock cannot advertise a different sentence or a different top row
// than the product draws.

type SessionUrgencyBrand<T extends string> = T & { readonly __brand: "SessionUrgency" };

function sessionUrgencyBrand<T extends string>(value: T): SessionUrgencyBrand<T> {
  // SAFETY: brands an urgency literal at the vocabulary boundary.
  return value as SessionUrgencyBrand<T>;
}

export const SESSION_URGENCY = {
${Object.keys(URGENCY_LABEL)
  .map((key) => `  ${key}: sessionUrgencyBrand("${key.toLowerCase()}"),`)
  .join("\n")}
} as const;

export type SessionUrgency = (typeof SESSION_URGENCY)[keyof typeof SESSION_URGENCY];

export const URGENCY_LABEL = {
${labels}
} as const;

/** The sentence a row states for this urgency when the provider reported nothing else. */
export function urgencyLabel(urgency: SessionUrgency): string {
  switch (urgency) {
${labelCases}
    default:
      throw new Error(\`Unknown session urgency: \${String(urgency)}\`);
  }
}

/** The urgency order the surface reads top-down and the badge collapses to. */
export const URGENCY_PRIORITY: readonly SessionUrgency[] = [
${priority}
];

/** Most urgent first, and within one urgency the one that moved most recently. */
export function compareSessionsByUrgency(
  left: { urgency: SessionUrgency; observedAt: number },
  right: { urgency: SessionUrgency; observedAt: number },
): number {
  return (
    URGENCY_PRIORITY.indexOf(left.urgency) - URGENCY_PRIORITY.indexOf(right.urgency) ||
    right.observedAt - left.observedAt
  );
}
`;
}

const outputs = [
  ["motion-tokens.css", motionTokensCss()],
  ["motion-tokens.ts", motionTokensTs()],
  ["provider-mark-paths.ts", providerMarkPathsTs()],
  ["session-display.ts", sessionDisplayTs()],
];

for (const [name, content] of outputs) {
  put(join(SURFACE, name), content);
  written.push(name);
}

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} files written to packages/surface/src/generated/\n`);
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node design/generate-surface-shared.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length} generated files are up to date\n`);
}
