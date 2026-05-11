#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_CALLBACK = "https://notable-salmon-371.eu-west-1.convex.site/api/auth/google/callback";
const DEFAULT_FRONTEND = "https://bazunia-production.up.railway.app";

function usage() {
  console.error(`Usage:
  node scripts/configure-google-oauth-from-client-secret.js <client_secret_web.json> [--deployment notable-salmon-371]

The JSON file must be a Google OAuth client of type "Web application" and must include:
  ${DEFAULT_CALLBACK}
as an authorized redirect URI.`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    file: "",
    deployment: "notable-salmon-371",
    frontendUrl: DEFAULT_FRONTEND,
    callbackUrl: DEFAULT_CALLBACK,
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--deployment") {
      options.deployment = args.shift() || "";
    } else if (arg === "--frontend-url") {
      options.frontendUrl = args.shift() || "";
    } else if (arg === "--callback-url") {
      options.callbackUrl = args.shift() || "";
    } else if (!options.file) {
      options.file = arg;
    } else {
      usage();
    }
  }

  if (!options.file || !options.deployment || !options.frontendUrl || !options.callbackUrl) usage();
  return options;
}

function loadWebClient(file, callbackUrl) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  if (!data.web) {
    throw new Error("This is not a Google OAuth Web application client JSON. Create/download a Web application client, not Desktop app/installed.");
  }

  const web = data.web;
  const redirectUris = Array.isArray(web.redirect_uris) ? web.redirect_uris : [];
  if (!redirectUris.includes(callbackUrl)) {
    throw new Error(`OAuth client is missing the required redirect URI: ${callbackUrl}`);
  }
  if (!web.client_id || !web.client_secret) {
    throw new Error("OAuth client JSON is missing client_id or client_secret.");
  }
  return web;
}

function setConvexEnvFromFile(deployment, values) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bazunia-google-oauth-"));
  const envFile = path.join(tempDir, ".env");
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
  fs.writeFileSync(envFile, `${content}\n`, { mode: 0o600 });

  const result = spawnSync(
    "npx",
    ["convex", "env", "set", "--deployment", deployment, "--from-file", envFile, "--force"],
    { stdio: "inherit" }
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(`convex env set failed with exit code ${result.status}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const web = loadWebClient(options.file, options.callbackUrl);
  const allowedOrigins = `${options.frontendUrl},http://localhost:8080`;

  setConvexEnvFromFile(options.deployment, {
    BAZUNIA_GOOGLE_CLIENT_ID: web.client_id,
    BAZUNIA_GOOGLE_CLIENT_SECRET: web.client_secret,
    AUTH_GOOGLE_ID: web.client_id,
    AUTH_GOOGLE_SECRET: web.client_secret,
    BAZUNIA_APP_URL: options.frontendUrl,
    BAZUNIA_ALLOWED_REDIRECT_ORIGINS: allowedOrigins,
  });

  console.log(`Configured Google OAuth env vars on Convex deployment ${options.deployment}.`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
