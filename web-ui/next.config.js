/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    const internalApiUrl = process.env.INTERNAL_API_URL || 'http://api-gateway:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${internalApiUrl}/api/:path*`,
      },
      {
        source: '/stream/:path*',
        destination: `${internalApiUrl}/stream/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
