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
