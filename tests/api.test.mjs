import test from "node:test";
import assert from "node:assert/strict";
import { request, DEFAULT_API_URL, validateEndpoint } from "../src/lib/api.js";

test("connection sends credentials only in a readable simple POST body", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, DEFAULT_API_URL);
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "follow");
    assert.equal(options.headers["Content-Type"], "text/plain;charset=utf-8");
    assert.equal(JSON.parse(options.body).key, "unit-test-key");
    assert.equal(options.mode, undefined);
    return {
      ok: true,
      json: async () => ({ ok: true, data: { title: "Test" } }),
    };
  });
  assert.deepEqual(await request(DEFAULT_API_URL, "unit-test-key", "read"), {
    title: "Test",
  });
  assert.equal(validateEndpoint("https://example.com/exec"), false);
});
test("an HTTP 200 application failure is never reported as a successful save", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      ok: false,
      error: { code: "CONFLICT", message: "Changed elsewhere" },
    }),
  }));
  await assert.rejects(
    request(DEFAULT_API_URL, "unit-test-key", "saveTab"),
    (e) => e.code === "CONFLICT",
  );
});
