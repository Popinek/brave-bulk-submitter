import test from "node:test";
import assert from "node:assert/strict";
import { createSiteRecords, normalizeUrl, parseBulkInput } from "../src/queue.js";

test("normalizes bare domains and removes a root slash", () => {
  assert.equal(normalizeUrl("example.com/"), "https://example.com");
  assert.equal(normalizeUrl("https://example.com/path#section"), "https://example.com/path");
});

test("rejects non-web, credential-bearing, and local URLs", () => {
  assert.throws(() => normalizeUrl("ftp://example.com"), /Only http and https/);
  assert.throws(() => normalizeUrl("https://user:pass@example.com"), /embedded credentials/);
  assert.throws(() => normalizeUrl("http://localhost:3000"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://192.168.1.10"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://[::1]"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://[fc00::1]"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://[fe80::1]"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://[::ffff:192.168.1.10]"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://203.0.113.8"), /Private, local, or special-use/);
  assert.throws(() => normalizeUrl("http://printer.home.arpa"), /Private, local, or special-use/);
});

test("parses, normalizes, deduplicates, and reports invalid entries", () => {
  const result = parseBulkInput("example.com\nhttps://example.com/\nnot a url\nftp://bad.example");
  assert.deepEqual(result.sites, ["https://example.com"]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /valid/);
  assert.match(result.errors[1].message, /Only http and https/);
});

test("creates stable queue records", () => {
  const [record] = createSiteRecords(["https://example.com"]);
  assert.equal(record.url, "https://example.com");
  assert.equal(record.status, "ready");
  assert.equal(record.attempts, 0);
  assert.match(record.id, /^1-/);
});
