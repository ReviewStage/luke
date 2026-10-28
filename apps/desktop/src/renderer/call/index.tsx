/**
 * index.tsx -- the floating call window's entry: the call card alone, and nothing of the panel.
 *
 * Loaded by `call.html` alone, which may reach no host. It never mounts
 * `App`, the one place recording starts.
 */

import { mountWindow } from "../window-root";
import { CallWindowCard } from "./call-window-card";

mountWindow(<CallWindowCard />);
