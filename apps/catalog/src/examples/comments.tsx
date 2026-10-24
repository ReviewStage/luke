import {
  AVATAR_SHAPE,
  Badge,
  BUTTON_SIZE,
  COMMENT_ELEMENT,
  Comment,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  STATUS_TONE,
  Stack,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * comments.tsx -- a thread of comments: a person by their picture, a person
 * by their letter where no picture is given, an agent on its square, a
 * status and an action at a head's end, and a draft not yet sent, which
 * says no time.
 */

/** A synthetic picture drawn in place, so the catalog renders offline. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#f4b860"/><stop offset="1" stop-color="#c8553d"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="16" r="7" fill="#fff8"/><path d="M6 40a14 14 0 0 1 28 0" fill="#fff8"/></svg>',
)}`;

const MINUTE = 60_000;

function Comments(): React.JSX.Element {
  // Note that the ages count from the catalog's own load, so each reads the same on every draw.
  const now = Date.now();
  return (
    <>
      <CatalogSection id="comment-thread" title="A thread">
        <div className="catalog-frame">
          <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.BLOCK}>
            <Comment
              as={COMMENT_ELEMENT.LI}
              author={{ name: "Ada Lovelace", id: "user-ada", picture: PICTURE }}
              at={now - 3 * 60 * MINUTE}
              now={now}
              trailing={<Badge tone={STATUS_TONE.COMPLETE}>Resolved</Badge>}
            >
              Can the retry wait for the queue to drain first?
            </Comment>
            <Comment
              as={COMMENT_ELEMENT.LI}
              author={{
                name: "Fix the flaky spec",
                id: "agent-flaky",
                shape: AVATAR_SHAPE.SQUARE,
                glyph: <GLYPH.AGENT />,
              }}
              at={now - 40 * MINUTE}
              now={now}
              trailing={
                <IconButton
                  icon={<GLYPH.MORE />}
                  label="Comment actions"
                  size={BUTTON_SIZE.COMPACT}
                  onClick={() => {}}
                />
              }
            >
              Yes. It waits on the drain now, and the spec passed ten runs in a row.
            </Comment>
            <Comment
              as={COMMENT_ELEMENT.LI}
              author={{ name: "Grace Hopper", id: "user-grace" }}
              at={now - 5 * MINUTE}
              now={now}
            >
              Nice, merging once CI is green.
            </Comment>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="comment-draft" title="A draft, with no time">
        <div className="catalog-frame">
          <Comment author={{ name: "Grace Hopper", id: "user-grace" }}>
            Pending review comment.
          </Comment>
        </div>
      </CatalogSection>
    </>
  );
}

export const COMMENTS_EXAMPLE: Example = {
  id: "comments",
  title: "Comments",
  Render: Comments,
};
