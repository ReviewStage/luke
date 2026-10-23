import assert from "node:assert/strict";
import { test } from "vitest";
import { startsLikeWebm, webmDimensions } from "./video-signature.js";

/**
 * video-signature.test.ts -- a WebM told from its own bytes and its size
 * read off its video track: the head of a real recording Playwright's
 * `recordVideo` wrote at 800 by 600, cut before its first cluster as a
 * reader may hold it, and headers written by hand for the shapes a muxer
 * may leave, each against the size it states.
 */

/** Playwright's `recordVideo` at 800 by 600, up to its first cluster: the EBML header, then the segment's seek head, info, tracks, and tags. */
const PLAYWRIGHT_800_BY_600 = [
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAzyEU2bdLpNu4tTq4QVSalmU6yBoU27",
  "i1OrhBZUrmtTrIHhTbuMU6uEElTDZ1OsggExTbuMU6uEHFO7a1Osggzc7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAVSalmuyrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEYYgLTUHdSGO2gESJiECPQAAAAAAAFlSu",
  "a8uuAQAAAAAAAELXgQFzxYjQIzg/Rygb7JyBACK1nINlbmeGhVZfVlA5g4EBI+ODhAJiWgDglrCCAyC6ggJYmoECVbCI",
  "VbeBAlW4gQISVMNn/nNzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuMS4xMDBzc9ljwItjxYjQIzg/Rygb7GfIpEWj",
  "h0VOQ09ERVJEh5dMYXZjNjEuMy4xMDAgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAw",
  "AA==",
].join("");

function decoded(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/** One EBML element: its ID's bytes as written, its size in one byte, then its body. */
function element(id: readonly number[], body: readonly number[]): number[] {
  return [...id, 0x80 | body.length, ...body];
}

/** An EBML header naming the doctype. */
function ebmlHeader(docType: string): number[] {
  return element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], [...Buffer.from(docType)]));
}

/** A track entry whose video states the size, each as two bytes. */
function videoTrack(width: number, height: number): number[] {
  const video = element(
    [0xe0],
    [
      ...element([0xb0], [width >> 8, width & 0xff]),
      ...element([0xba], [height >> 8, height & 0xff]),
    ],
  );
  return element([0xae], [...element([0xd7], [1]), ...video]);
}

/** A segment of unknown size, as a live muxer leaves it, holding the children given. */
function liveSegment(children: readonly number[]): number[] {
  return [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...children];
}

const TRACKS = [0x16, 0x54, 0xae, 0x6b] as const;
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75] as const;

test("a real recording's head is a WebM, of the size Playwright recorded it at", () => {
  const bytes = decoded(PLAYWRIGHT_800_BY_600);

  assert.equal(startsLikeWebm(bytes.subarray(0, 12)), true);
  assert.deepEqual(webmDimensions(bytes), { width: 800, height: 600 });
});

test("a segment of unknown size is walked to the track that states the size", () => {
  const bytes = new Uint8Array([
    ...ebmlHeader("webm"),
    ...liveSegment([...element([0xec], [0, 0, 0]), ...element([...TRACKS], videoTrack(1280, 800))]),
  ]);

  assert.deepEqual(webmDimensions(bytes), { width: 1280, height: 800 });
});

test("a doctype padded with zero bytes still names a WebM", () => {
  const bytes = new Uint8Array([
    ...element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], [...Buffer.from("webm"), 0, 0])),
    ...liveSegment(element([...TRACKS], videoTrack(640, 480))),
  ]);

  assert.deepEqual(webmDimensions(bytes), { width: 640, height: 480 });
});

test("a Matroska file that is no WebM, and a WebM whose frames come before any track's size, state no size", () => {
  const matroska = new Uint8Array([
    ...ebmlHeader("matroska"),
    ...liveSegment(element([...TRACKS], videoTrack(640, 480))),
  ]);
  const clusterFirst = new Uint8Array([
    ...ebmlHeader("webm"),
    ...liveSegment([
      ...element([...CLUSTER], [0, 0]),
      ...element([...TRACKS], videoTrack(640, 480)),
    ]),
  ]);

  assert.equal(startsLikeWebm(matroska), true, "the header is sniffed alike");
  assert.equal(webmDimensions(matroska), undefined);
  assert.equal(webmDimensions(clusterFirst), undefined);
});

test("a picture, and a WebM cut short inside its header, are no WebM of any size", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const cut = decoded(PLAYWRIGHT_800_BY_600).subarray(0, 20);

  assert.equal(startsLikeWebm(png), false);
  assert.equal(webmDimensions(png), undefined);
  assert.equal(webmDimensions(cut), undefined);
});
