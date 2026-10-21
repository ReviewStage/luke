/**
 * act-stream.ts -- one stream the window holds open on its act port, each word it carries handed to a listener until the window lets it go.
 *
 * A host procedure that follows something streams it (an `eventIterator`):
 * the window opens the stream, reads each word as it lands, and ends it when
 * the place that drew it goes. Note that a stream the window could not open,
 * or one that broke, hands nothing more, so the place keeps what it last held
 * rather than throwing where it draws.
 */
export function streamFrom<View>(
  open: () => Promise<AsyncIteratorObject<View, unknown, unknown>>,
  take: (view: View) => void,
): () => void {
  let stopped = false;
  let stream: AsyncIteratorObject<View, unknown, unknown> | undefined;
  const read = async () => {
    stream = await open();
    if (stopped) {
      await stream.return?.(undefined);
      return;
    }
    for await (const view of stream) take(view);
  };
  read().catch(() => undefined);
  return () => {
    stopped = true;
    stream?.return?.(undefined).catch(() => undefined);
  };
}
