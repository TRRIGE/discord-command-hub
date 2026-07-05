/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to this project (a stray lockfile in $HOME would
  // otherwise confuse Next's workspace-root inference on some machines).
  outputFileTracingRoot: __dirname,
  // `after()` (used to run mirror/AI work after the Discord response is flushed
  // while staying inside Discord's ~3s window) is stable in Next 15 — no flag needed.
};

module.exports = nextConfig;
