/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // better-sqlite3 is a native addon (only relevant to the local-dev-only
  // SQLite path — see src/server/db/prisma.ts); it's never bundlable and
  // must stay a genuine runtime require even on a machine that has it
  // installed as a devDependency.
  serverExternalPackages: ['pino', 'pg-boss', 'better-sqlite3', '@prisma/adapter-better-sqlite3'],
  // Required for local dev through an HTTPS tunnel (ngrok/Cloudflare Tunnel)
  // when testing the real BigCommerce embed: without this, Next dev mode
  // blocks cross-origin requests for its own JS chunks/HMR from the tunnel
  // host, so the page's HTML renders (via SSR) but never hydrates — the
  // app looks permanently stuck on its initial loading state. Wildcarded
  // since Cloudflare's anonymous "quick tunnel" issues a new random
  // *.trycloudflare.com hostname every time it restarts. Dev-only; has no
  // effect on `next build`/production.
  allowedDevOrigins: ['*.trycloudflare.com', '*.ngrok-free.app'],
};

export default nextConfig;
