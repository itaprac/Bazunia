// @ts-nocheck
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function sessionHashFromToken(sessionToken?: string) {
  const token = String(sessionToken || "").trim();
  if (!token) throw new Error("Brak aktywnej sesji. Zaloguj się ponownie.");
  return await sha256Base64(token);
}

async function optionalSessionHash(sessionToken?: string) {
  const token = String(sessionToken || "").trim();
  return token ? await sha256Base64(token) : undefined;
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

export default http;
