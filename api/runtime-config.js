module.exports = (req, res) => {
  const convexUrl =
    process.env.BAZUNIA_CONVEX_URL ||
    process.env.BAZA_CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    '';
  const publicDeckProviderRaw =
    process.env.BAZUNIA_PUBLIC_DECK_PROVIDER ||
    process.env.BAZA_PUBLIC_DECK_PROVIDER ||
    'static';
  const publicDeckProvider = ['convex', 'supabase'].includes(String(publicDeckProviderRaw).toLowerCase())
    ? 'convex'
    : 'static';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.status(200).send(
    `window.__BAZUNIA_CONVEX_URL=${JSON.stringify(convexUrl)};
window.__BAZUNIA_PUBLIC_DECK_PROVIDER=${JSON.stringify(publicDeckProvider)};`
  );
};
