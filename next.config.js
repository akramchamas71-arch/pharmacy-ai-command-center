/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Document/photo uploads can be sizable (prescriptions, product images).
  // Tune per actual deployment once the file-storage decision (S3/R2/GCS) is made.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

module.exports = nextConfig;
