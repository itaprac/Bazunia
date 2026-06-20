// @ts-nocheck
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function base64FromBytes(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function bytesFromBase64(value: string) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function parseDataUrl(value: string) {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    bytes: bytesFromBase64(match[2]),
  };
}

async function sha256Base64(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64FromBytes(new Uint8Array(buffer));
}

async function hashPassword(password: string, saltBase64: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: bytesFromBase64(saltBase64),
      iterations: 120000,
      hash: "SHA-256",
    },
    key,
    256
  );
  return base64FromBytes(new Uint8Array(bits));
}

function randomBase64(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64FromBytes(bytes);
}

function randomBase64Url(byteLength = 32) {
  return randomBase64(byteLength)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomUsername() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `u_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10)}`;
}

function ensurePassword(password: string) {
  if (String(password || "").length < 6) {
    throw new Error("Hasło musi mieć co najmniej 6 znaków.");
  }
}

function roleForNewUser(email: string) {
  const devEmails = String(process.env.BAZUNIA_DEV_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return devEmails.includes(String(email || "").trim().toLowerCase()) ? "dev" : "user";
}

function envValue(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function getGoogleOAuthConfig() {
  const clientId = envValue("BAZUNIA_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_ID", "GOOGLE_CLIENT_ID");
  const clientSecret = envValue("BAZUNIA_GOOGLE_CLIENT_SECRET", "AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Brak konfiguracji Google OAuth w Convex. Ustaw BAZUNIA_GOOGLE_CLIENT_ID/BAZUNIA_GOOGLE_CLIENT_SECRET albo AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET.");
  }
  return { clientId, clientSecret };
}

function redirectResponse(url: string, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
    },
  });
}

function getUrlOrigin(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return "";
  }
}

function allowedRedirectOrigins() {
  return new Set(
    [
      ...String(process.env.BAZUNIA_ALLOWED_REDIRECT_ORIGINS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      envValue("BAZUNIA_APP_URL"),
    ]
      .map((item) => getUrlOrigin(item) || item)
      .filter(Boolean)
  );
}

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function normalizeRedirectTo(request: Request) {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("redirectTo") || request.headers.get("Referer") || envValue("BAZUNIA_APP_URL") || "";
  if (!raw) throw new Error("Brak adresu powrotu po logowaniu Google.");

  const redirectUrl = new URL(raw);
  if (redirectUrl.protocol !== "https:" && redirectUrl.protocol !== "http:") {
    throw new Error("Nieprawidłowy adres powrotu po logowaniu Google.");
  }

  const allowed = allowedRedirectOrigins();
  if (!allowed.has(redirectUrl.origin) && !(allowed.size === 0 && isLoopbackOrigin(redirectUrl.origin))) {
    throw new Error("Ten adres powrotu nie jest dozwolony dla logowania Google.");
  }
  return redirectUrl.toString();
}

function authRedirectUrl(redirectTo: string, params: Record<string, string>) {
  const url = new URL(redirectTo);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [key, value] of Object.entries(params)) hashParams.set(key, value);
  url.hash = hashParams.toString();
  return url.toString();
}

async function sessionHashFromToken(sessionToken?: string) {
  const token = String(sessionToken || "").trim();
  if (!token) throw new Error("Brak aktywnej sesji. Zaloguj się ponownie.");
  return await sha256Base64(token);
}

async function optionalSessionHash(sessionToken?: string) {
  const token = String(sessionToken || "").trim();
  return token ? await sha256Base64(token) : undefined;
}

async function fetchGoogleIdentity(code: string, redirectUri: string, clientId: string, clientSecret: string) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.id_token) {
    throw new Error(tokenPayload?.error_description || "Google nie zwrócił tokenu tożsamości.");
  }

  const infoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenPayload.id_token)}`);
  const identity = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok) throw new Error(identity?.error_description || "Nie udało się zweryfikować tokenu Google.");
  if (identity.aud !== clientId) throw new Error("Token Google ma nieprawidłowego odbiorcę.");
  if (String(identity.email_verified) !== "true") throw new Error("Adres e-mail Google nie jest zweryfikowany.");
  const email = String(identity.email || "").trim().toLowerCase();
  if (!email) throw new Error("Google nie zwrócił adresu e-mail.");
  return { email };
}

async function handleRpc(ctx: any, request: Request) {
  const payload = await request.json().catch(() => ({}));
  const operation = String(payload.operation || "");
  const args = payload.args || {};
  const sessionToken = payload.sessionToken || "";

  switch (operation) {
    case "auth.getSession": {
      const tokenHash = await optionalSessionHash(sessionToken);
      if (!tokenHash) return { data: { session: null } };
      const result = await ctx.runQuery(internal.ops.getSession, { tokenHash });
      return { data: { session: result?.session || null } };
    }
    case "auth.signInWithPassword": {
      const email = String(args.email || "").trim().toLowerCase();
      const password = String(args.password || "");
      const user = await ctx.runQuery(internal.ops.getUserPrivateByEmail, { email });
      if (!user) throw new Error("Nieprawidłowy e-mail lub hasło.");
      const passwordHash = await hashPassword(password, user.passwordSalt);
      if (passwordHash !== user.passwordHash) throw new Error("Nieprawidłowy e-mail lub hasło.");
      const token = randomBase64(36);
      const tokenHash = await sha256Base64(token);
      const result = await ctx.runMutation(internal.ops.createSession, { userId: user.id, tokenHash });
      return { data: { user: result.session.user, session: { ...result.session, access_token: token } } };
    }
    case "auth.signUpWithPassword": {
      const email = String(args.email || "").trim().toLowerCase();
      const password = String(args.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Podaj poprawny adres e-mail.");
      ensurePassword(password);
      const existing = await ctx.runQuery(internal.ops.getUserPrivateByEmail, { email });
      if (existing) throw new Error("Konto o tym adresie e-mail już istnieje.");
      const salt = randomBase64(16);
      const passwordHash = await hashPassword(password, salt);
      const created = await ctx.runMutation(internal.ops.createUser, {
        email,
        passwordSalt: salt,
        passwordHash,
        username: randomUsername(),
        role: roleForNewUser(email),
      });
      const token = randomBase64(36);
      const tokenHash = await sha256Base64(token);
      const result = await ctx.runMutation(internal.ops.createSession, { userId: created.user.id, tokenHash });
      return { data: { user: result.session.user, session: { ...result.session, access_token: token } } };
    }
    case "auth.signOut": {
      const tokenHash = await sessionHashFromToken(sessionToken);
      await ctx.runMutation(internal.ops.deleteSession, { tokenHash });
      return { data: {} };
    }
    case "auth.resetPassword":
      throw new Error("Reset hasła nie jest jeszcze skonfigurowany po migracji na Convex.");
    case "role.current":
      return { data: await ctx.runQuery(internal.ops.currentRole, { tokenHash: await sessionHashFromToken(sessionToken) }) };
    case "admin.users":
      return { data: await ctx.runQuery(internal.ops.adminListUsers, { tokenHash: await sessionHashFromToken(sessionToken) }) };
    case "admin.setRole":
      return {
        data: await ctx.runMutation(internal.ops.adminSetUserRole, {
          tokenHash: await sessionHashFromToken(sessionToken),
          targetUserId: args.targetUserId,
          nextRole: args.nextRole,
        }),
      };
    case "profile.get":
      return { data: await ctx.runQuery(internal.ops.fetchMyProfile, { tokenHash: await sessionHashFromToken(sessionToken) }) };
    case "profile.updateUsername":
      return {
        data: await ctx.runMutation(internal.ops.updateMyUsername, {
          tokenHash: await sessionHashFromToken(sessionToken),
          username: args.username,
        }),
      };
    case "storage.fetchAll":
      return {
        data: await ctx.runQuery(internal.ops.fetchAllUserStorage, {
          tokenHash: await sessionHashFromToken(sessionToken),
          userId: args.userId,
        }),
      };
    case "storage.upsert":
      return {
        data: await ctx.runMutation(internal.ops.upsertUserStorage, {
          tokenHash: await sessionHashFromToken(sessionToken),
          userId: args.userId,
          key: args.key,
          value: args.value,
        }),
      };
    case "storage.deleteKeys":
      return {
        data: await ctx.runMutation(internal.ops.deleteUserStorageKeys, {
          tokenHash: await sessionHashFromToken(sessionToken),
          userId: args.userId,
          keys: args.keys || [],
        }),
      };
    case "publicDecks.fetch":
      return { data: await ctx.runQuery(internal.ops.fetchPublicDecks, { includeArchived: args.includeArchived === true }) };
    case "publicDecks.upsert":
      return {
        data: await ctx.runMutation(internal.ops.upsertPublicDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          deck: args.deck,
        }),
      };
    case "publicDecks.archive":
      return {
        data: await ctx.runMutation(internal.ops.archivePublicDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          deckId: args.deckId,
          isArchived: args.isArchived === true,
        }),
      };
    case "publicDeckVisibility.fetch":
      return { data: await ctx.runQuery(internal.ops.fetchPublicDeckVisibility, {}) };
    case "publicDeckVisibility.set":
      return {
        data: await ctx.runMutation(internal.ops.setPublicDeckVisibility, {
          tokenHash: await sessionHashFromToken(sessionToken),
          deckId: args.deckId,
          isHidden: args.isHidden === true,
        }),
      };
    case "imageAssets.upsert":
      return {
        data: await ctx.runMutation(internal.ops.upsertImageAsset, {
          tokenHash: await sessionHashFromToken(sessionToken),
          assetId: args.assetId,
          contentType: args.contentType,
          data: args.data,
          byteLength: Number(args.byteLength) || 0,
        }),
      };
    case "sharedDecks.search":
      return {
        data: await ctx.runQuery(internal.ops.searchSharedDecks, {
          query: String(args.query || ""),
          page: Number(args.page) || 1,
          pageSize: Number(args.pageSize) || 20,
        }),
      };
    case "sharedDecks.publish":
      return {
        data: await ctx.runMutation(internal.ops.publishSharedDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          deck: args.deck,
        }),
      };
    case "sharedDecks.unpublish":
      return {
        data: await ctx.runMutation(internal.ops.unpublishSharedDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          sharedDeckId: args.sharedDeckId,
        }),
      };
    case "subscriptions.fetchMine":
      return { data: await ctx.runQuery(internal.ops.fetchMySubscriptions, { tokenHash: await sessionHashFromToken(sessionToken) }) };
    case "subscriptions.subscribe":
      return {
        data: await ctx.runMutation(internal.ops.subscribeToSharedDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          sharedDeckId: args.sharedDeckId,
        }),
      };
    case "subscriptions.unsubscribe":
      return {
        data: await ctx.runMutation(internal.ops.unsubscribeFromSharedDeck, {
          tokenHash: await sessionHashFromToken(sessionToken),
          sharedDeckId: args.sharedDeckId,
        }),
      };
    case "answerVotes.summary":
      return {
        data: await ctx.runQuery(internal.ops.fetchAnswerVoteSummary, {
          tokenHash: await optionalSessionHash(sessionToken),
          targetScope: args.targetScope,
          targetDeckId: args.targetDeckId,
          questionIds: args.questionIds || [],
        }),
      };
    case "answerVotes.set":
      return {
        data: await ctx.runMutation(internal.ops.setAnswerVote, {
          tokenHash: await sessionHashFromToken(sessionToken),
          targetScope: args.targetScope,
          targetDeckId: args.targetDeckId,
          questionId: args.questionId,
          answerId: args.answerId,
          vote: Number(args.vote),
        }),
      };
    default:
      throw new Error(`Nieznana operacja Convex: ${operation}`);
  }
}

http.route({
  path: "/api/rpc",
  method: "OPTIONS",
  handler: httpAction(async (_, request) => new Response(null, { status: 204, headers: corsHeaders(request) })),
});

http.route({
  path: "/api/rpc",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const result = await handleRpc(ctx, request);
      return jsonResponse(request, { ...result, error: null });
    } catch (error) {
      return jsonResponse(request, { data: null, error: { message: error?.message || "Błąd Convex." } }, 200);
    }
  }),
});

http.route({
  path: "/api/image",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const assetId = String(requestUrl.searchParams.get("id") || "").trim();
    if (!assetId) {
      return new Response("Missing image id", { status: 400, headers: corsHeaders(request) });
    }
    const asset = await ctx.runQuery(internal.ops.fetchImageAsset, { assetId });
    const parsed = asset ? parseDataUrl(asset.data) : null;
    if (!asset || !parsed) {
      return new Response("Image not found", { status: 404, headers: corsHeaders(request) });
    }
    return new Response(parsed.bytes, {
      status: 200,
      headers: {
        ...corsHeaders(request),
        "Content-Type": asset.content_type || parsed.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

http.route({
  path: "/api/auth/google/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    let redirectTo = "";
    try {
      redirectTo = normalizeRedirectTo(request);
      const { clientId } = getGoogleOAuthConfig();
      const requestUrl = new URL(request.url);
      const redirectUri = `${requestUrl.origin}/api/auth/google/callback`;
      const state = randomBase64Url(32);
      const stateHash = await sha256Base64(state);

      await ctx.runMutation(internal.ops.createOAuthState, {
        stateHash,
        redirectTo,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      googleUrl.searchParams.set("client_id", clientId);
      googleUrl.searchParams.set("redirect_uri", redirectUri);
      googleUrl.searchParams.set("response_type", "code");
      googleUrl.searchParams.set("scope", "openid email profile");
      googleUrl.searchParams.set("state", state);
      googleUrl.searchParams.set("prompt", "select_account");

      return redirectResponse(googleUrl.toString());
    } catch (error) {
      if (redirectTo) {
        return redirectResponse(authRedirectUrl(redirectTo, {
          bazunia_auth_error: error?.message || "Nie udało się rozpocząć logowania Google.",
        }));
      }
      return jsonResponse(request, { data: null, error: { message: error?.message || "Nie udało się rozpocząć logowania Google." } }, 400);
    }
  }),
});

http.route({
  path: "/api/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const state = requestUrl.searchParams.get("state") || "";
    const code = requestUrl.searchParams.get("code") || "";
    const oauthError = requestUrl.searchParams.get("error") || "";

    if (!state) return new Response("Brak parametru state.", { status: 400 });
    const stateHash = await sha256Base64(state);
    const storedState = await ctx.runMutation(internal.ops.consumeOAuthState, { stateHash });
    if (!storedState?.redirectTo) return new Response("Sesja logowania Google wygasła. Spróbuj ponownie.", { status: 400 });

    const fail = (message: string) => redirectResponse(authRedirectUrl(storedState.redirectTo, {
      bazunia_auth_error: message,
    }));

    try {
      if (oauthError) return fail(`Google OAuth: ${oauthError}`);
      if (!code) return fail("Google nie zwrócił kodu autoryzacji.");

      const { clientId, clientSecret } = getGoogleOAuthConfig();
      const redirectUri = `${requestUrl.origin}/api/auth/google/callback`;
      const identity = await fetchGoogleIdentity(code, redirectUri, clientId, clientSecret);
      const created = await ctx.runMutation(internal.ops.findOrCreateOAuthUser, {
        email: identity.email,
        passwordSalt: randomBase64(16),
        passwordHash: randomBase64(32),
        role: roleForNewUser(identity.email),
      });
      const sessionToken = randomBase64(36);
      const tokenHash = await sha256Base64(sessionToken);
      await ctx.runMutation(internal.ops.createSession, {
        userId: created.user.id,
        tokenHash,
      });

      return redirectResponse(authRedirectUrl(storedState.redirectTo, {
        bazunia_auth: "google",
        bazunia_session: sessionToken,
      }));
    } catch (error) {
      return fail(error?.message || "Nie udało się zakończyć logowania Google.");
    }
  }),
});

export default http;
