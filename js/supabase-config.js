// supabase-config.js — compatibility exports for the Convex runtime config

export const CONVEX_URL = window.__BAZUNIA_CONVEX_URL || window.__BAZA_CONVEX_URL || '';
export const CONVEX_SITE_URL = normalizeConvexSiteUrl(CONVEX_URL);
export const SUPABASE_URL = CONVEX_URL;
export const SUPABASE_ANON_KEY = '';
const PUBLIC_DECK_PROVIDER_CONFIG = String(
  window.__BAZUNIA_PUBLIC_DECK_PROVIDER || window.__BAZA_PUBLIC_DECK_PROVIDER || ''
).toLowerCase();
export const PUBLIC_DECK_PROVIDER = CONVEX_SITE_URL
  ? 'convex'
  : (['convex', 'supabase'].includes(PUBLIC_DECK_PROVIDER_CONFIG) ? 'convex' : 'static');

function normalizeConvexSiteUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (raw.endsWith('.convex.site')) return raw;
  if (raw.endsWith('.convex.cloud')) return raw.replace(/\.convex\.cloud$/, '.convex.site');
  return raw;
}

export function isConvexConfigValid() {
  return (
    typeof CONVEX_SITE_URL === 'string' &&
    CONVEX_SITE_URL.length > 0 &&
    !CONVEX_SITE_URL.includes('YOUR_CONVEX_URL')
  );
}

export function isSupabaseConfigValid() {
  return isConvexConfigValid();
}
