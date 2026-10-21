/**
 * line-file-wire.ts -- a file a developer's line carried, as the transcript's row names it once the service keeps its bytes beside the conversation.
 *
 * A line's files once stood in its row as the AI SDK's file part over a
 * `data:` URL, so every read, journal amend, and long poll of the
 * transcript carried their bytes. The service now keeps each as a row of
 * its own beside the conversation (`attachment`), as it keeps a picture a
 * tool answered (`conversation-picture-wire.ts`), and the row's file part
 * names that row in its URL instead: the part keeps its type, its media
 * type, and its name, so whatever reads a file by its name reads it as
 * before, and its bytes are read apart, under the agent, by the id the URL
 * carries. A row written before the move still carries its `data:` URL
 * until the backfill moves it, so a reader takes both.
 */

/** The scheme a kept file's URL is written in: no address anything fetches, only the id it names. */
const LINE_FILE_SCHEME = "luke-attachment:";

/** The id the service mints a kept row under, a UUID in lower case. */
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The URL a row's file part names a kept file by. */
export function lineFileUrl(attachmentId: string): string {
  return `${LINE_FILE_SCHEME}${attachmentId}`;
}

/** The kept row a file part's URL names, or nothing for any other URL, a `data:` URL among them. */
export function lineFileIdOf(url: string): string | undefined {
  if (!url.startsWith(LINE_FILE_SCHEME)) return undefined;
  const id = url.slice(LINE_FILE_SCHEME.length);
  return ATTACHMENT_ID.test(id) ? id : undefined;
}
