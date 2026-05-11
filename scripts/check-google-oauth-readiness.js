#!/usr/bin/env node

const FRONTEND_URL = process.env.BAZUNIA_FRONTEND_URL || "https://bazunia-production.up.railway.app";
const CONVEX_SITE_URL = process.env.BAZUNIA_CONVEX_SITE_URL || "https://notable-salmon-371.eu-west-1.convex.site";

async function readText(url) {
  const response = await fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

async function readRedirect(url) {
  const response = await fetch(url, { redirect: "manual" });
  return {
    status: response.status,
    location: response.headers.get("location") || "",
  };
}

function pass(label) {
  console.log(`OK  ${label}`);
}

function fail(label, detail) {
  console.error(`ERR ${label}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

async function readFrontendJavaScript(frontendHtml) {
  const legacyApp = await readText(`${FRONTEND_URL}/js/app.js`);
  const legacySupabase = await readText(`${FRONTEND_URL}/js/supabase.js`);
  if (legacyApp.ok || legacySupabase.ok) {
    return `${legacyApp.text}\n${legacySupabase.text}`;
  }

  const assetPaths = [...frontendHtml.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
    .map((match) => match[1])
    .filter((src) => src.startsWith("/assets/"));
  const bundles = await Promise.all(assetPaths.map((path) => readText(`${FRONTEND_URL}${path}`)));
  return bundles.map((bundle) => bundle.text).join("\n");
}

async function main() {
  const frontend = await readText(`${FRONTEND_URL}/`);
  if (frontend.ok) pass(`frontend responds (${FRONTEND_URL})`);
  else fail("frontend responds", `HTTP ${frontend.status}`);

  const runtime = await readText(`${FRONTEND_URL}/js/runtime-config.js`);
  if (runtime.text.includes("notable-salmon-371.eu-west-1.convex.cloud")) {
    pass("frontend runtime points at Convex prod");
  } else {
    fail("frontend runtime points at Convex prod");
  }

  const frontendJs = await readFrontendJavaScript(frontend.text);
  if (frontendJs.includes("/api/auth/google/start")) {
    pass("frontend includes Google OAuth redirect code");
  } else {
    fail("frontend includes Google OAuth redirect code");
  }

  if (frontendJs.includes("bazunia_auth") || frontendJs.includes("bazunia_session")) {
    pass("frontend consumes OAuth callback tokens");
  } else {
    fail("frontend consumes OAuth callback tokens");
  }

  const allowed = await readRedirect(
    `${CONVEX_SITE_URL}/api/auth/google/start?redirectTo=${encodeURIComponent(`${FRONTEND_URL}/`)}`
  );
  if (allowed.status !== 302) {
    fail("Convex accepts frontend redirect origin", `HTTP ${allowed.status}, location=${allowed.location}`);
  } else if (allowed.location.startsWith("https://accounts.google.com/")) {
    pass("Convex accepts frontend redirect origin");
    pass("Google OAuth credentials configured in Convex");
  } else if (allowed.location.startsWith(`${FRONTEND_URL}/`) && allowed.location.includes("Google+OAuth")) {
    pass("Convex accepts frontend redirect origin");
    fail("Google OAuth credentials configured in Convex", "missing BAZUNIA_GOOGLE_CLIENT_ID/BAZUNIA_GOOGLE_CLIENT_SECRET or AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET");
  } else {
    pass("Convex accepts frontend redirect origin");
    fail("Google OAuth credentials configured in Convex", `unexpected redirect location=${allowed.location}`);
  }

  const blocked = await readRedirect(
    `${CONVEX_SITE_URL}/api/auth/google/start?redirectTo=${encodeURIComponent("https://example.com/")}`
  );
  if (blocked.status === 400) pass("Convex blocks untrusted redirect origins");
  else fail("Convex blocks untrusted redirect origins", `HTTP ${blocked.status}, location=${blocked.location}`);
}

main().catch((error) => {
  fail("readiness check crashed", error.message);
});
