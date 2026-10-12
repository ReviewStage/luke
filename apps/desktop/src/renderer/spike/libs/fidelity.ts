// fidelity.ts -- SPIKE: the round-trip page entry, every library on window for the headless driver.

import { milkdownRoundTrip } from "./milkdown";
import { oursRoundTrip } from "./ours";
import { pmMarkdownRoundTrip } from "./pm-markdown";
import { tiptapRoundTrip } from "./tiptap-full";

Object.assign(window, { milkdownRoundTrip, oursRoundTrip, pmMarkdownRoundTrip, tiptapRoundTrip });
