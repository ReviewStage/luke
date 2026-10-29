/**
 * spring-scope.tsx -- where Motion draws in `@luke/ui`: its slim `m` components, with the features they play loaded on first draw, and no say of Motion's own over reduced motion.
 *
 * Motion's full `motion.*` components carry every feature in the bundle
 * that imports them. `LazyMotion` draws its slim `m.*` instead and loads the
 * features (layout, drag, and the animations under both) as a chunk of their
 * own once a scope first draws; `strict` refuses a `motion.*` drawn inside
 * one, which would carry them all back in. Motion is told never to decide
 * for reduced motion: the tokens decide (`token-spring.ts`), so a capture
 * run, which no OS setting announces, holds still too.
 */

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** The features chunk, loaded once whichever scope draws first. */
function loadFeatures() {
  return import("./motion-features.js").then((features) => features.SPRING_FEATURES);
}

/** The scope a spring component draws its `m.*` elements in. */
export function SpringScope({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="never">{children}</MotionConfig>
    </LazyMotion>
  );
}
