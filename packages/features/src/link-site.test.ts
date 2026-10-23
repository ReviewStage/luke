import assert from "node:assert/strict";
import { test } from "vitest";
import { LINK_SITE, linkSiteName, linkSiteOf } from "./link-site.js";

const site = (href: string) => linkSiteOf(new URL(href));
const mapsName = (href: string) => linkSiteName(LINK_SITE.GOOGLE_MAPS, href);

test("a page under /maps on Google's own host in any country, on its maps host, or a Maps short link is Google Maps's", () => {
  for (const href of [
    "https://www.google.com/maps/place/Ferry+Building",
    "https://google.co.uk/maps?q=Big+Ben",
    "https://www.google.com.au/maps/@-33.85,151.21,14z",
    "https://maps.google.de/?q=Brandenburger+Tor",
    "https://maps.app.goo.gl/Ab12Cd34",
    "https://goo.gl/maps/Ab12Cd34",
  ]) {
    assert.equal(site(href), LINK_SITE.GOOGLE_MAPS, href);
  }
});

test("a page of Google's that is not a map, or of a host only spelled like Google's, is no site's", () => {
  for (const href of [
    "https://www.google.com/search?q=maps",
    "https://docs.google.com/maps/place/Nowhere",
    "https://www.google.com/mapsearch",
    "https://google.example.com/maps/place/Nowhere",
    "https://goo.gl/Ab12Cd34",
    "https://example.com/maps/place/Nowhere",
  ]) {
    assert.equal(site(href), undefined, href);
  }
});

test("a place is called by its name, without the view after it", () => {
  assert.equal(
    mapsName(
      "https://www.google.com/maps/place/Golden+Gate+Bridge/@37.8199286,-122.4782551,17z/data=!3m1!4b1",
    ),
    "Golden Gate Bridge",
  );
  assert.equal(
    mapsName("https://www.google.com/maps/place/Caf%C3%A9+de+Flore,+Paris/@48.85,2.33,17z"),
    "Café de Flore, Paris",
  );
});

test("a search is called by its words, in its path or in Maps's own query", () => {
  assert.equal(
    mapsName("https://www.google.com/maps/search/coffee+near+Union+Square/@37.78,-122.40,15z"),
    "coffee near Union Square",
  );
  assert.equal(
    mapsName("https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower"),
    "Eiffel Tower",
  );
  assert.equal(mapsName("https://maps.google.com/?q=Pike+Place+Market"), "Pike Place Market");
  assert.equal(mapsName("https://www.google.com/maps/search/?q=coffee"), "coffee");
});

test("a route is called by its stops in order, an empty stop, where you stand, left out", () => {
  assert.equal(
    mapsName(
      "https://www.google.com/maps/dir/SFO/Ferry+Building/Oakland/@37.7,-122.3,11z/data=!4m2",
    ),
    "SFO → Ferry Building → Oakland",
  );
  assert.equal(
    mapsName("https://www.google.com/maps/dir//Ferry+Building/@37.79,-122.39,15z"),
    "Ferry Building",
  );
  assert.equal(
    mapsName("https://www.google.com/maps/dir/?api=1&origin=SFO&destination=Ferry%20Building"),
    "SFO → Ferry Building",
  );
  assert.equal(
    mapsName(
      "https://www.google.com/maps/dir/?api=1&origin=SFO&destination=Oakland&waypoints=Ferry+Building%7CPier+39",
    ),
    "SFO → Ferry Building → Pier 39 → Oakland",
  );
  assert.equal(mapsName("https://maps.google.com/maps?saddr=SFO&daddr=Oakland"), "SFO → Oakland");
});

test("a bare view, a short link, or an address that spells nothing is called Google Maps", () => {
  for (const href of [
    "https://www.google.com/maps/@37.77,-122.41,14z",
    "https://maps.app.goo.gl/Ab12Cd34",
    "https://www.google.com/maps/place/",
    "https://www.google.com/maps?q=%20%0A",
  ]) {
    assert.equal(mapsName(href), "Google Maps", href);
  }
});

test("a long name is cut to one short line", () => {
  const name = mapsName(`https://www.google.com/maps/place/${"Very+Long+Name+".repeat(10)}`);

  assert.ok(name.length <= 60, name);
  assert.ok(name.endsWith("…"), name);
});

test("a page of one of Google's apps is that app's, by its host or, on the Docs host, its editor", () => {
  for (const [href, expected] of [
    ["https://docs.google.com/document/d/1AbC/edit", LINK_SITE.GOOGLE_DOCS],
    ["https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0", LINK_SITE.GOOGLE_SHEETS],
    ["https://docs.google.com/presentation/d/1AbC/edit", LINK_SITE.GOOGLE_SLIDES],
    ["https://docs.google.com/forms/d/e/1AbC/viewform", LINK_SITE.GOOGLE_FORMS],
    ["https://forms.gle/Ab12Cd34", LINK_SITE.GOOGLE_FORMS],
    ["https://drive.google.com/drive/folders/1AbC", LINK_SITE.GOOGLE_DRIVE],
    ["https://calendar.google.com/calendar/u/0/r/week", LINK_SITE.GOOGLE_CALENDAR],
    ["https://calendar.app.google/Ab12Cd34", LINK_SITE.GOOGLE_CALENDAR],
    ["https://meet.google.com/abc-defg-hij", LINK_SITE.GOOGLE_MEET],
    ["https://mail.google.com/mail/u/0/#inbox/FMfcg", LINK_SITE.GMAIL],
  ] as const) {
    assert.equal(site(href), expected, href);
  }
  assert.equal(site("https://docs.google.com/"), undefined);
  assert.equal(site("https://docs.example.com/document/d/1AbC"), undefined);
});

test("a Google app's page is called by its app, and a Meet by its code", () => {
  assert.equal(
    linkSiteName(LINK_SITE.GOOGLE_DOCS, "https://docs.google.com/document/d/1AbC/edit"),
    "Google Docs",
  );
  assert.equal(
    linkSiteName(LINK_SITE.GOOGLE_MEET, "https://meet.google.com/abc-defg-hij?authuser=0"),
    "abc-defg-hij",
  );
  assert.equal(
    linkSiteName(LINK_SITE.GOOGLE_MEET, "https://meet.google.com/landing"),
    "Google Meet",
  );
});

test("a YouTube page, on its own host or a short link, is YouTube's, a channel called by its handle", () => {
  for (const href of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "https://m.youtube.com/@acme",
  ]) {
    assert.equal(site(href), LINK_SITE.YOUTUBE, href);
  }
  assert.equal(site("https://notyoutube.com/watch"), undefined);
  const named = (href: string) => linkSiteName(LINK_SITE.YOUTUBE, href);
  assert.equal(named("https://www.youtube.com/@acme"), "@acme");
  assert.equal(named("https://www.youtube.com/@acme/videos"), "@acme");
  assert.equal(named("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "YouTube");
  assert.equal(named("https://www.youtube.com/@日本語チャンネル"), "@日本語チャンネル");
  assert.equal(named("https://www.youtube.com/@%E0%A4"), "YouTube");
});

test("an X page, under its old name too, is X's, an account called by its handle and a post by its author", () => {
  for (const href of [
    "https://x.com/acme/status/1850000000000000000",
    "https://twitter.com/acme",
    "https://mobile.twitter.com/acme/status/1",
  ]) {
    assert.equal(site(href), LINK_SITE.X, href);
  }
  assert.equal(site("https://xx.com/acme"), undefined);
  const named = (href: string) => linkSiteName(LINK_SITE.X, href);
  assert.equal(named("https://x.com/acme/status/1850000000000000000"), "Post by @acme");
  assert.equal(named("https://twitter.com/acme"), "@acme");
  assert.equal(named("https://x.com/acme/likes"), "X");
  assert.equal(named("https://x.com/home"), "X");
  assert.equal(named("https://x.com/search?q=luke"), "X");
  assert.equal(named("https://x.com/i/spaces/1AbC"), "X");
  for (const page of ["premium", "jobs", "communities", "grok"]) {
    assert.equal(named(`https://x.com/${page}`), "X", page);
  }
});
