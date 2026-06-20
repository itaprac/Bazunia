// supabase.js — compatibility facade now backed by Convex

import { CONVEX_SITE_URL, isConvexConfigValid } from './supabase-config.js';

const SESSION_TOKEN_KEY = 'bazunia_convex_session_token';

let answerVoteRpcAvailable = true;
const authListeners = new Set();

export function isSupabaseConfigured() {
  return isConvexConfigValid();
}

export function isAnswerVoteRpcReady() {
  return answerVoteRpcAvailable;
}

function getSessionToken() {
  return localStorage.getItem(SESSION_TOKEN_KEY) || '';
}

function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

function toError(message) {
  return new Error(message || 'Błąd komunikacji z Convex.');
}

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error('Brak konfiguracji Convex. Ustaw BAZUNIA_CONVEX_URL (np. w .env).');
  }
}

async function callConvex(operation, args = {}, options = {}) {
  ensureConfigured();
  const response = await fetch(`${CONVEX_SITE_URL}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation,
      args,
      sessionToken: options.sessionToken ?? getSessionToken(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Convex HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw toError(payload.error.message);
  }
  return payload?.data;
}

function notifyAuthListeners(event, session) {
  for (const callback of authListeners) {
    try {
      callback(event, session);
    } catch (error) {
      console.error('Convex auth listener failed:', error);
    }
  }
}

function authResult(data) {
  return { data, error: null };
}

function authError(error) {
  return { data: null, error };
}

function cleanOAuthHashParams(url, hashParams) {
  const hadOAuthParams = (
    hashParams.has('bazunia_auth') ||
    hashParams.has('bazunia_session') ||
    hashParams.has('bazunia_auth_error')
  );
  if (!hadOAuthParams) return;
  hashParams.delete('bazunia_auth');
  hashParams.delete('bazunia_session');
  hashParams.delete('bazunia_auth_error');
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : '';
  history.replaceState(null, '', url.toString());
}

export function consumeOAuthRedirect() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return { tokenStored: false, errorMessage: '' };

  const params = new URLSearchParams(hash);
  const sessionToken = params.get('bazunia_session') || '';
  const errorMessage = params.get('bazunia_auth_error') || '';
  if (!sessionToken && !errorMessage) return { tokenStored: false, errorMessage: '' };

  const url = new URL(window.location.href);
  cleanOAuthHashParams(url, params);

  if (sessionToken) {
    setSessionToken(sessionToken);
    return { tokenStored: true, errorMessage: '' };
  }

  return { tokenStored: false, errorMessage };
}

function currentOAuthReturnUrl() {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  cleanOAuthHashParams(url, params);
  return url.toString();
}

// --- Auth ---

export async function getCurrentSession() {
  const token = getSessionToken();
  if (!token) return null;
  const data = await callConvex('auth.getSession', {}, { sessionToken: token });
  if (!data?.session) {
    setSessionToken('');
    return null;
  }
  return data.session;
}

export function onAuthStateChange(callback) {
  authListeners.add(callback);
  return {
    unsubscribe() {
      authListeners.delete(callback);
    },
  };
}

export async function signInWithPassword(email, password) {
  try {
    const data = await callConvex('auth.signInWithPassword', { email, password }, { sessionToken: '' });
    const token = data?.session?.access_token || '';
    if (token) setSessionToken(token);
    notifyAuthListeners('SIGNED_IN', data?.session || null);
    return authResult(data);
  } catch (error) {
    return authError(error);
  }
}

export async function signUpWithPassword(email, password) {
  try {
    const data = await callConvex('auth.signUpWithPassword', { email, password }, { sessionToken: '' });
    const token = data?.session?.access_token || '';
    if (token) setSessionToken(token);
    notifyAuthListeners('SIGNED_IN', data?.session || null);
    return authResult(data);
  } catch (error) {
    return authError(error);
  }
}

export async function signInWithGoogle() {
  try {
    ensureConfigured();
    const url = `${CONVEX_SITE_URL}/api/auth/google/start?redirectTo=${encodeURIComponent(currentOAuthReturnUrl())}`;
    window.location.assign(url);
    return authResult({ url });
  } catch (error) {
    return authError(error);
  }
}

export async function signOutUser() {
  try {
    await callConvex('auth.signOut');
    setSessionToken('');
    notifyAuthListeners('SIGNED_OUT', null);
    return authResult({});
  } catch (error) {
    setSessionToken('');
    notifyAuthListeners('SIGNED_OUT', null);
    return authError(error);
  }
}

export async function sendPasswordResetEmail(email) {
  try {
    await callConvex('auth.resetPassword', { email });
    return authResult({});
  } catch (error) {
    return authError(error);
  }
}

// --- Role and admin RPC ---

export async function fetchCurrentUserRole() {
  return await callConvex('role.current');
}

export async function fetchAdminUsers() {
  return await callConvex('admin.users');
}

export async function setUserRole(targetUserId, nextRole) {
  return await callConvex('admin.setRole', { targetUserId, nextRole });
}

// --- Global public decks ---

export async function fetchPublicDecks(options = {}) {
  return await callConvex('publicDecks.fetch', { includeArchived: options.includeArchived === true });
}

export async function upsertPublicDeck(deckPayload) {
  return await callConvex('publicDecks.upsert', { deck: deckPayload });
}

export async function archivePublicDeck(deckId) {
  return await callConvex('publicDecks.archive', { deckId, isArchived: true });
}

export async function restorePublicDeck(deckId) {
  return await callConvex('publicDecks.archive', { deckId, isArchived: false });
}

export async function hidePublicDeck(deckId) {
  return archivePublicDeck(deckId);
}

export async function unhidePublicDeck(deckId) {
  return restorePublicDeck(deckId);
}

export async function fetchPublicDeckVisibility() {
  return await callConvex('publicDeckVisibility.fetch');
}

export async function setPublicDeckVisibility(deckId, isHidden) {
  return await callConvex('publicDeckVisibility.set', { deckId, isHidden });
}

export async function uploadImageAsset(options = {}) {
  const assetId = String(options.assetId || '').trim();
  const contentType = String(options.contentType || '').trim();
  const data = String(options.data || '').trim();
  const byteLength = Math.max(0, Number(options.byteLength) || 0);
  const row = await callConvex('imageAssets.upsert', { assetId, contentType, data, byteLength });
  return {
    ...row,
    url: `${CONVEX_SITE_URL}/api/image?id=${encodeURIComponent(row.id || assetId)}`,
  };
}

// --- User profile (username) ---

export async function fetchMyProfile() {
  return await callConvex('profile.get');
}

export async function updateMyUsername(username) {
  return await callConvex('profile.updateUsername', { username });
}

// --- Shared decks catalog and subscriptions ---

export async function searchSharedDecks(options = {}) {
  return await callConvex('sharedDecks.search', {
    query: String(options.query || ''),
    page: Math.max(1, Number(options.page) || 1),
    pageSize: Math.max(1, Number(options.pageSize) || 20),
  });
}

export async function publishSharedDeck(deckPayload) {
  return await callConvex('sharedDecks.publish', { deck: deckPayload });
}

export async function unpublishSharedDeck(sharedDeckId) {
  return await callConvex('sharedDecks.unpublish', { sharedDeckId });
}

export async function fetchMySubscriptions() {
  return await callConvex('subscriptions.fetchMine');
}

export async function subscribeToSharedDeck(sharedDeckId) {
  return await callConvex('subscriptions.subscribe', { sharedDeckId });
}

export async function unsubscribeFromSharedDeck(sharedDeckId) {
  return await callConvex('subscriptions.unsubscribe', { sharedDeckId });
}

// --- Community answer votes ---

export async function fetchAnswerVoteSummary(options = {}) {
  if (!answerVoteRpcAvailable) {
    throw new Error('Głosowanie w Convex jest niedostępne.');
  }

  const targetScope = String(options.targetScope || '').trim();
  const targetDeckId = String(options.targetDeckId || '').trim();
  const questionIds = Array.isArray(options.questionIds)
    ? options.questionIds.map((id) => String(id || '').trim()).filter((id) => id.length > 0)
    : [];

  if (!targetScope || !targetDeckId || questionIds.length === 0) {
    return [];
  }

  return await callConvex('answerVotes.summary', { targetScope, targetDeckId, questionIds });
}

export async function setAnswerVote(options = {}) {
  if (!answerVoteRpcAvailable) {
    throw new Error('Głosowanie w Convex jest niedostępne.');
  }

  const targetScope = String(options.targetScope || '').trim();
  const targetDeckId = String(options.targetDeckId || '').trim();
  const questionId = String(options.questionId || '').trim();
  const answerId = String(options.answerId || '').trim();
  const vote = Number(options.vote);

  if (!targetScope || !targetDeckId || !questionId || !answerId) {
    throw new Error('Brakuje danych głosu.');
  }
  if (![1, 0, -1].includes(vote)) {
    throw new Error('Nieprawidłowa wartość głosu.');
  }

  await callConvex('answerVotes.set', { targetScope, targetDeckId, questionId, answerId, vote });
}

// --- User storage ---

export async function fetchAllUserStorage(userId) {
  return await callConvex('storage.fetchAll', { userId });
}

export async function upsertUserStorage(userId, key, value) {
  return await callConvex('storage.upsert', { userId, key, value });
}

export async function deleteUserStorageKeys(userId, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return;
  return await callConvex('storage.deleteKeys', { userId, keys });
}
