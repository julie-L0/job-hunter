import test from "node:test";
import assert from "node:assert/strict";

import { cleanSiteLink, isMiniProgramLink, isWebUrl, siteLinkLabel } from "./site-link.js";

test("site link accepts mini program launch links as copy-only entries", () => {
  const link = " #小程序://圆通招聘/ogfgxcUEHClSP6A ";

  assert.equal(cleanSiteLink(link), "#小程序://圆通招聘/ogfgxcUEHClSP6A");
  assert.equal(isMiniProgramLink(link), true);
  assert.equal(isWebUrl(link), false);
  assert.equal(siteLinkLabel(link), "复制小程序链接");
});

test("site link keeps http and https urls openable", () => {
  assert.equal(isWebUrl("https://example.com/careers"), true);
  assert.equal(isWebUrl("http://example.com/careers"), true);
  assert.equal(siteLinkLabel("https://example.com/careers"), "官网");
});

test("site link treats other non-empty text as copyable", () => {
  assert.equal(isWebUrl("圆通招聘"), false);
  assert.equal(isMiniProgramLink("圆通招聘"), false);
  assert.equal(siteLinkLabel("圆通招聘"), "复制链接");
});
