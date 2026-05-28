import { defineConfig } from '@playwright/test';

// Minimal Playwright config for the WebXR integration smoke test.
//
// Default: spawn a Python http.server against ./dist on port 5175,
// requiring a prior `npm run build` to populate dist/. Set
// E2E_BASE_URL to point at a different host (e.g. the deployed site)
// to skip the local server.
//
// Single project, single worker — these tests poke at WebGL state and
// don't parallelise meaningfully.

const localServerUrl = 'http://localhost:5175';
const useLocalServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? localServerUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Trace on failure helps when the WebGL pipeline silently barfs.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: useLocalServer
    ? {
        command: 'python3 -m http.server 5175 --directory dist',
        url: localServerUrl,
        reuseExistingServer: true,
        timeout: 10_000,
      }
    : undefined,
});
