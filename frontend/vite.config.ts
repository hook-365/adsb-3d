import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022'
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // During `vite dev`, forward backend paths to the running container.
      // Override DEV_BACKEND env var if the container isn't on localhost.
      '/data': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/api': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/acars-api': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/tiles': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/photos': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/config.js': { target: process.env.DEV_BACKEND ?? 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: (process.env.DEV_BACKEND ?? 'http://localhost:8080').replace(/^http/, 'ws'), changeOrigin: true, ws: true }
    }
  },
  test: {
    globals: true,
    // Switch to 'jsdom' once a unit test actually needs DOM globals;
    // installing jsdom now is unnecessary weight for Phase 0.
    environment: 'node',
    include: ['tests-unit/**/*.test.ts']
  }
});
