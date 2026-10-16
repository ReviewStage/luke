import assert from "node:assert/strict";
import { test } from "vitest";
import { imageDimensions, sniffImageType } from "./image-signature.js";
import { INBOX_IMAGE_TYPE } from "./inbox-wire.js";

/**
 * image-signature.test.ts -- a picture's type and size read from its own
 * bytes: real files a browser encoded at 37 by 23, and headers written by
 * hand for the WebP forms a browser does not write, each against the size
 * it was made at.
 */

const PNG_37_BY_23 = [
  "iVBORw0KGgoAAAANSUhEUgAAACUAAAAXCAYAAACMLIalAAAAXUlEQVR4AezSsQ0AIQxD0YgxbqCjhFFpGQjWgBV+JA",
  "qCjJTOBX5JKv9Yt02yC58+RZcSR6r1z8jQ5t5cHClvs9N5SVFRSb0nVfM0MrS5N6ebomKSkhQVoDndVGipDQAA//8I",
  "FJ0jAAAABklEQVQDANt9eaw6g4OJAAAAAElFTkSuQmCC",
].join("");
const JPEG_37_BY_23 = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAA",
  "EAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKA",
  "AAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0",
  "AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWi",
  "AAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQA",
  "AAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbA",
  "BlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERX",
  "RTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2",
  "NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAXACUDASIAAhEBAxEB/8QAGAABAQADAAAAAAAAAAAAAAAAAAME",
  "BQb/xAAeEAACAgMAAwEAAAAAAAAAAAABAgADBAURBkFRYf/EABgBAQADAQAAAAAAAAAAAAAAAAABAgQF/8QAGREBAA",
  "MBAQAAAAAAAAAAAAAAAAECAxEh/9oADAMBAAIRAxEAPwCGs112zyGpoZFZULkuSBzoHofsz8jxfNx8e257ccrWhcgM",
  "3eAd+SGg2NOszXuvV2VqygCAE96D7P5Nzm+UYWRhZFKVZAaytkBKrzpHPs7Ot9o05SPFI45KIibEEREBERAREQERED",
  "//2Q==",
].join("");
const WEBP_37_BY_23 = [
  "UklGRmACAABXRUJQVlA4WAoAAAAgAAAAJAAAFgAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAA",
  "EAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKA",
  "AAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0",
  "AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWi",
  "AAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQA",
  "AAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbA",
  "BlACAASQBuAGMALgAgADIAMAAxADZWUDggcgAAALADAJ0BKiUAFwA+0WSsUKglJCKlaAEAGgljAMhcC3azDJhMwLAA",
  "AP6cqflQhFR33kK4yPi1AdTrGeZTbvfitU9eXKtAWL0zzcm5jUCEZcwf/AwcfpTXiu+331X0a/f5TLmOrXn1F+cEsL",
  "fxqluhYAAAAA==",
].join("");

function bytesOf(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** A RIFF WebP holding one chunk of the given four-letter type and payload. */
function webpWith(chunk: string, payload: readonly number[]): Uint8Array {
  const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));
  return new Uint8Array([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii(chunk),
    payload.length,
    0,
    0,
    0,
    ...payload,
  ]);
}

/** An APP1 segment whose payload holds a frame marker, as an EXIF thumbnail does, stating a size that is not the picture's. */
const EXIF_WITH_THUMBNAIL = [
  0xff, 0xe1, 0x00, 0x0b, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x05, 0x00, 0x07,
];

test("a browser's PNG, JPEG, and WebP read as the size they were drawn at", () => {
  for (const [base64, type] of [
    [PNG_37_BY_23, INBOX_IMAGE_TYPE.PNG],
    [JPEG_37_BY_23, INBOX_IMAGE_TYPE.JPEG],
    [WEBP_37_BY_23, INBOX_IMAGE_TYPE.WEBP],
  ] as const) {
    const bytes = bytesOf(base64);
    assert.equal(sniffImageType(bytes), type);
    assert.deepEqual(imageDimensions(bytes, type), { width: 37, height: 23 }, type);
  }
});

test("a JPEG's size is its frame's, never a frame marker inside an earlier segment", () => {
  const jpeg = bytesOf(JPEG_37_BY_23);
  const withExif = new Uint8Array([...jpeg.slice(0, 2), ...EXIF_WITH_THUMBNAIL, ...jpeg.slice(2)]);
  assert.deepEqual(imageDimensions(withExif, INBOX_IMAGE_TYPE.JPEG), { width: 37, height: 23 });
});

test("a lossy and a lossless WebP chunk state their sizes", () => {
  // VP8: a frame tag, the start code, then width and height in fourteen bits each, little-endian.
  const lossy = webpWith("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 37, 0, 23, 0]);
  // VP8L: the signature byte, then width and height less one in fourteen bits each.
  const bits = 36 + 22 * 2 ** 14;
  const lossless = webpWith("VP8L", [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  assert.deepEqual(imageDimensions(lossy, INBOX_IMAGE_TYPE.WEBP), { width: 37, height: 23 });
  assert.deepEqual(imageDimensions(lossless, INBOX_IMAGE_TYPE.WEBP), { width: 37, height: 23 });
});

test("a header cut short states no size", () => {
  for (const [base64, type] of [
    [PNG_37_BY_23, INBOX_IMAGE_TYPE.PNG],
    [JPEG_37_BY_23, INBOX_IMAGE_TYPE.JPEG],
    [WEBP_37_BY_23, INBOX_IMAGE_TYPE.WEBP],
  ] as const) {
    assert.equal(imageDimensions(bytesOf(base64).slice(0, 14), type), undefined, type);
  }
});
