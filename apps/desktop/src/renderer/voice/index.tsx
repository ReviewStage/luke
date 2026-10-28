/**
 * index.tsx -- the hidden voice window's entry: `VoiceHost`, and nothing of the panel.
 *
 * Loaded by `voice.html` alone, whose policy allows no network. It never
 * mounts `App`, the one place recording starts.
 */

import { mountWindow } from "../window-root";
import { VoiceHost } from "./voice-host";

mountWindow(<VoiceHost />);
