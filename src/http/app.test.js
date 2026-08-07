import test, { after } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { createApp, createSession, isAuthRequired } from "./app.js";

const originalPassword = config.auth.password;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;

function setEnvironment({ password = "", production = false } = {}) {
  config.auth.password = password;
  if (production) process.env.NODE_ENV = "production";
  else delete process.env.NODE_ENV;
  delete process.env.VERCEL;
}

function protectedApp() {
  return createApp([{ method: "GET", path: "/private", handler: () => ({ allowed: true }) }]);
}

after(() => {
  config.auth.password = originalPassword;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

test("signed sessions protect private routes without exposing the password", async () => {
  setEnvironment({ password: "correct horse battery staple" });
  const app = protectedApp();
  const session = createSession("correct horse battery staple", { "x-forwarded-for": "203.0.113.10" });

  assert.notEqual(session.token, config.auth.password);
  assert.ok(session.expiresAt > Date.now());
  assert.equal((await app({ method: "GET", url: "/private" })).status, 401);
  assert.equal(
    (await app({ method: "GET", url: "/private", headers: { "x-auth-token": config.auth.password } })).status,
    401,
  );
  assert.equal(
    (await app({ method: "GET", url: "/private", headers: { "x-auth-token": session.token } })).status,
    200,
  );

  config.auth.password = "a different password";
  assert.equal(
    (await app({ method: "GET", url: "/private", headers: { "x-auth-token": session.token } })).status,
    401,
  );
});

test("production fails closed when APP_PASSWORD is missing", async () => {
  setEnvironment({ production: true });
  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await protectedApp()({ method: "GET", url: "/private" });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(isAuthRequired(), true);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /APP_PASSWORD/);
  assert.throws(() => createSession("", {}), /APP_PASSWORD/);
});

test("passwordless access remains available for local development", async () => {
  setEnvironment();
  const result = await protectedApp()({ method: "GET", url: "/private" });

  assert.equal(isAuthRequired(), false);
  assert.equal(result.status, 200);
});

test("repeated login failures are temporarily blocked by client address", () => {
  setEnvironment({ password: "correct horse battery staple" });
  const headers = { "x-forwarded-for": "203.0.113.20" };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.throws(() => createSession("wrong", headers), (error) => error.status === 401);
  }
  assert.throws(() => createSession("wrong", headers), (error) => error.status === 429);
  assert.throws(() => createSession("correct horse battery staple", headers), (error) => error.status === 429);
});
