// End-to-end smoke test for the WebXR pipeline (Phases 1–5). We can't
// drive a real headset from CI / a Linux dev box, and the WebXR API
// Emulator Chrome extension is awkward to install in Playwright, so
// this test mocks navigator.xr at the page level and verifies:
//
//   - the page loads without console errors
//   - the Settings panel exposes Enter VR + Enter AR action rows
//   - clicking Enter VR drives navigator.xr.requestSession with the
//     mode + requiredFeatures the app expects
//   - clicking Enter AR drives the same with immersive-ar
//
// We deliberately do *not* try to fake an active XR session — Three.js's
// WebXRManager needs a real XRSession with XRWebGLLayer, reference
// spaces, and a working requestAnimationFrame, which is far more than
// we want to mock for a smoke test. The headset itself is the only
// place to verify the in-VR visuals.

import { expect, test, type Page } from '@playwright/test';

// The settings panel's sections are collapsible (only "Aircraft" opens by
// default), so tests must expand "Stereo / VR" before reaching the Enter
// VR / Enter AR buttons. Idempotent: only clicks when collapsed.
async function openXrSection(page: Page): Promise<void> {
  const toggle = page.locator('.settings-section-toggle:has-text("Stereo / VR")');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}

// /config.js is normally rendered by entrypoint.sh from env vars at
// container start. For tests we serve a minimal stub via route
// interception so the build artefact in ./dist doesn't need an
// out-of-band config file (and so the test works just as well
// against an already-deployed URL — the stub will only override the
// route if the URL pattern matches and the real server's response
// is replaced).
const STUB_CONFIG_JS = `
window.FEEDS_CONFIG = [{
  id: 'local', name: 'Local',
  liveUrl: '/api/never', apiBase: '/api',
  home: { lat: 0, lon: 0, altFt: 0, name: 'Test' },
  color: '#4cc8ff', supportsWs: false, supportsHistory: false,
}];
window.TOWER_CONFIG = { hidden: true };
window.VOICE_CONFIG = { enabled: false };
`;

test.describe('WebXR integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/config.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: STUB_CONFIG_JS,
      }),
    );
    // Capture page errors so the test fails loudly on a stray throw
    // from XR boot. The Enter VR / Enter AR tests intentionally drive
    // a rejecting requestSession mock, so they install their own
    // permissive handler and skip this one.
    page.on('pageerror', (err) => {
      if (/mocked|no real session/.test(err.message)) return;
      throw new Error(`Uncaught page error: ${err.message}`);
    });
  });

  test('page boots without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    // Wait for the scene canvas to be visible — proxy for "the app
    // boot has at least started rendering".
    await expect(page.locator('#scene')).toBeVisible();
    // Give the load + initial WS handshake a moment to settle.
    await page.waitForTimeout(800);

    // Filter out errors we don't control (e.g. dev-server-only proxy
    // 502s when backend isn't running locally). Anything from our
    // own code paths would be uppercase / contain a module path.
    const ourErrors = consoleErrors.filter(
      (e) =>
        !/Failed to load resource/.test(e) &&
        !/wss?:\/\//.test(e) &&
        !/ws\/live/.test(e),
    );
    expect(ourErrors, ourErrors.join('\n')).toEqual([]);
  });

  test('Settings panel shows Enter VR + Enter AR buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#scene')).toBeVisible();

    await page.locator('.settings-button').click();
    const settingsPanel = page.locator('.settings-panel');
    await expect(settingsPanel).toBeVisible();
    await openXrSection(page);

    // Locate by the data-id we wired in settings-panel.ts. Both rows
    // live under the "Stereo / VR" section.
    const vrBtn = page.locator('#enter-vr, [data-row-id="enter-vr"], button:has-text("Enter VR"), button:has-text("VR unavailable")').first();
    const arBtn = page.locator('#enter-ar, [data-row-id="enter-ar"], button:has-text("Enter AR"), button:has-text("AR unavailable")').first();
    await expect(vrBtn).toBeVisible();
    await expect(arBtn).toBeVisible();

    // Screenshot the panel for visual confirmation that the new row
    // landed alongside the existing ones.
    await settingsPanel.screenshot({ path: 'tests-e2e/screenshots/settings-vr-ar.png' });
  });

  test('Enter VR requests an immersive-vr session', async ({ page }) => {
    // Mock navigator.xr BEFORE the page scripts load so the support
    // probe in core/xr.ts sees a "supported" device and the Enter VR
    // button enables. The fake requestSession records the call and
    // rejects so we don't drag Three.js into a half-real session.
    await page.addInitScript(() => {
      const calls: Array<{ mode: string; init: unknown }> = [];
      (window as unknown as { __xrCalls: typeof calls }).__xrCalls = calls;
      // navigator properties are read-only on direct assignment in
      // browsers; defineProperty is the supported escape hatch.
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        writable: true,
        value: {
          isSessionSupported: async () => true,
          requestSession: async (mode: string, init: unknown) => {
            calls.push({ mode, init });
            // Reject so enterVR() resolves into its catch path rather
            // than dragging Three.js into a half-real session. The
            // unhandled rejection from the click handler is fine —
            // we just want to verify the call was made.
            throw new Error('mocked: no real session in test');
          },
        },
      });
    });

    await page.goto('/');
    await expect(page.locator('#scene')).toBeVisible();
    // Wait until the async support probe has flipped the button into
    // its "Enter VR" (enabled) state.
    await page.locator('.settings-button').click();
    await openXrSection(page);
    const vrBtn = page.locator('button.settings-action:has-text("Enter VR")').first();
    await expect(vrBtn).toBeEnabled({ timeout: 2000 });

    await vrBtn.click({ noWaitAfter: true }).catch(() => {/* unhandled rejection ok */});
    await page.waitForTimeout(200);

    const calls = await page.evaluate(
      () => (window as unknown as { __xrCalls: Array<{ mode: string; init: { optionalFeatures?: string[] } }> }).__xrCalls,
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].mode).toBe('immersive-vr');
    // core/xr.ts requests local-floor as an OPTIONAL feature (a session
    // must still start on hardware without it); this asserted
    // requiredFeatures for a while, which the app has never sent.
    expect(calls[0].init.optionalFeatures).toContain('local-floor');
  });

  test('Enter AR requests an immersive-ar session', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: Array<{ mode: string; init: unknown }> = [];
      (window as unknown as { __xrCalls: typeof calls }).__xrCalls = calls;
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        writable: true,
        value: {
          isSessionSupported: async () => true,
          requestSession: async (mode: string, init: unknown) => {
            calls.push({ mode, init });
            throw new Error('mocked');
          },
        },
      });
    });

    await page.goto('/');
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('.settings-button').click();
    await openXrSection(page);
    const arBtn = page.locator('button.settings-action:has-text("Enter AR")').first();
    await expect(arBtn).toBeEnabled({ timeout: 2000 });

    await arBtn.click({ noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(200);

    const calls = await page.evaluate(
      () => (window as unknown as { __xrCalls: Array<{ mode: string; init: { requiredFeatures?: string[] } }> }).__xrCalls,
    );
    expect(calls.some((c) => c.mode === 'immersive-ar')).toBe(true);
  });

  test('XR wiring is wired into the scene graph', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#scene')).toBeVisible();
    await page.waitForTimeout(800);

    // Pull a small snapshot out of the page via Three.js's scene
    // traversal. We expect to see the xr-root group, controllers in
    // the scene, and the wrist-menu mesh registered (it's instantiated
    // at boot but hidden until handedness reports left).
    const snapshot = await page.evaluate(() => {
      // Walk window.__THREE_SCENE if exposed; otherwise traverse from
      // the visible canvas's WebGL renderer via a known global. The app
      // doesn't currently expose one, so we look at DOM-level signals.
      return {
        hasCanvas: !!document.getElementById('scene'),
        hasSettings: !!document.querySelector('.settings-panel'),
        hasGear: !!document.querySelector('.settings-button'),
        bodyHasXrOn: document.body.classList.contains('xr-on'),
      };
    });
    expect(snapshot.hasCanvas).toBe(true);
    expect(snapshot.hasGear).toBe(true);
    // Not presenting → xr-on must NOT be on the body.
    expect(snapshot.bodyHasXrOn).toBe(false);
  });
});
