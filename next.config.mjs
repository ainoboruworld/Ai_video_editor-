/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Remotion sources are compiled by the Remotion bundler in the render worker,
  // never by Next — keep them out of the Next build graph.
  outputFileTracingExcludes: {
    '**': ['remotion/**', 'node_modules/@remotion/**', 'node_modules/remotion/**'],
  },
  // Transformers.js is loaded dynamically in the browser only; keeping it out of
  // the server bundle avoids pulling ONNX runtime binaries into functions.
  serverExternalPackages: ['@huggingface/transformers'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pexels.com' },
      { protocol: 'https', hostname: 'cdn.pixabay.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  eslint: {
    dirs: ['src', 'scripts'],
  },
};

export default nextConfig;
