// WebXR session manager. Subscribe-singleton matching core/settings.ts /
// core/theme.ts: detects WebXR support once at boot, owns the
// immersive-vr session lifecycle, fans out state via a Set<listener>.
//
// Phase 1 of WebXR support — VR rendering only, no controllers / no
// in-VR UI yet. Renderer wiring lives in world/scene.ts (sets
// renderer.xr.enabled) and main.ts (setAnimationLoop branches on
// renderer.xr.isPresenting).
//
// To enter VR the user clicks an "Enter VR" button in the settings
// panel; clicking again (or hitting the system menu / removing the
// headset) exits. The session-end handler fires for both paths so
// state stays consistent.

/** A snapshot of XR availability + presenting state. */
export interface XrState {
  /**
   * True if the browser exposes navigator.xr AND the device reports
   * immersive-vr support. Decided once at boot — WebXR's
   * isSessionSupported() is async and racey to re-poll on every render.
   * If the user plugs in a headset mid-session a page reload is needed.
   */
  vrSupported: boolean;
  /**
   * True if the device additionally supports immersive-ar (passthrough).
   * Quest 3 / Vision Pro yes; Quest 2 / Index / Cardboard no. Probed in
   * parallel with vrSupported at boot.
   */
  arSupported: boolean;
  /** True between session start and session end. */
  presenting: boolean;
  /** Which mode the active session is in. null when not presenting. */
  presentingMode: 'vr' | 'ar' | null;
  /**
   * Short reason string explaining why VR isn't available, suitable for a
   * settings-panel tooltip. null when supported.
   */
  unavailableReason: string | null;
  /**
   * The error message from the most recent failed enterVR()/enterAR()
   * attempt, or null. Surfaced in the settings panel so a session that
   * silently fails to start (common on headsets the dev can't test on)
   * leaves a visible, actionable trail instead of vanishing.
   */
  lastError: string | null;
}

type XrListener = (state: XrState) => void;

// Verbose, prefixed logging for the whole XR lifecycle. WebXR failures are
// almost always device-specific and the dev may have no headset to test on,
// so every step logs to the console — visible via remote-inspecting the
// headset browser (chrome://inspect). Cheap; only fires on probe + the
// handful of session start/stop events, never per-frame.
const TAG = '[xr]';
function xrLog(...args: unknown[]): void {
  console.info(TAG, ...args);
}
function xrWarn(...args: unknown[]): void {
  console.warn(TAG, ...args);
}
function xrError(...args: unknown[]): void {
  console.error(TAG, ...args);
}

// Three.js's renderer.xr accepts a session and drives the rest. We don't
// import Three.js here — the renderer is injected via setRenderer() so
// core/ stays free of three deps (mirrors the other core/* singletons).
interface XrRenderer {
  xr: {
    enabled: boolean;
    isPresenting: boolean;
    setSession(session: XRSession | null): Promise<void>;
  };
}

let renderer: XrRenderer | null = null;
let state: XrState = {
  vrSupported: false,
  arSupported: false,
  presenting: false,
  presentingMode: null,
  unavailableReason: 'Checking WebXR support…',
  lastError: null,
};
const listeners = new Set<XrListener>();
let currentSession: XRSession | null = null;

function emit(): void {
  for (const fn of listeners) fn(state);
}

function setState(patch: Partial<XrState>): void {
  state = { ...state, ...patch };
  emit();
}

// Initial support probe. Runs once on module load; sets `vrSupported`
// (true) or `unavailableReason` (the failure mode the user can fix or
// at least understand). Wrapped in try/catch — some browsers throw
// when navigator.xr is undefined rather than just returning undefined.
async function probeSupport(): Promise<void> {
  try {
    xrLog('probing WebXR support', {
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : 'no-window',
      hasNavigatorXr: typeof navigator !== 'undefined' && 'xr' in navigator,
      origin: typeof location !== 'undefined' ? location.origin : 'no-location',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'no-navigator',
    });
    // WebXR is gated on a secure context. Over plain HTTP (e.g. reaching
    // the app at http://<lan-ip>:port instead of through an HTTPS proxy)
    // the headset browser refuses to start a session and navigator.xr is
    // often absent entirely — so call this out specifically rather than
    // blaming the browser, which sends people debugging the wrong thing.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      xrWarn('insecure context — WebXR will not start over plain HTTP');
      setState({
        vrSupported: false,
        unavailableReason:
          'WebXR requires a secure (HTTPS) connection. This page is loaded over an insecure origin, so no headset browser will start a session. Serve the app over HTTPS (or use localhost) and reload.',
      });
      return;
    }
    if (typeof navigator === 'undefined' || !('xr' in navigator)) {
      xrWarn('navigator.xr absent — browser has no WebXR implementation');
      setState({
        vrSupported: false,
        unavailableReason:
          'WebXR is not available in this browser. Try Chrome on Android with a Cardboard headset, or the Meta Quest browser.',
      });
      return;
    }
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      setState({ vrSupported: false, unavailableReason: 'WebXR is unavailable.' });
      return;
    }
    // Probe both modes in parallel — Quest 3 / Vision Pro return true
    // for both; Quest 2 returns true only for vr; a Cardboard browser
    // typically returns false for both (no headset attached yet).
    const [vrOk, arOk] = await Promise.all([
      xr.isSessionSupported('immersive-vr').catch((e) => {
        xrWarn('isSessionSupported(immersive-vr) threw', e);
        return false;
      }),
      xr.isSessionSupported('immersive-ar').catch((e) => {
        xrWarn('isSessionSupported(immersive-ar) threw', e);
        return false;
      }),
    ]);
    xrLog('isSessionSupported result', { 'immersive-vr': vrOk, 'immersive-ar': arOk });
    if (vrOk) {
      setState({ vrSupported: true, arSupported: arOk, unavailableReason: null });
    } else {
      setState({
        vrSupported: false,
        arSupported: arOk,
        unavailableReason:
          'This device does not support immersive VR. Connect a headset (Quest, Index, etc.) or use a phone with a Cardboard-style viewer in Chrome.',
      });
    }
  } catch (err) {
    xrError('probe failed', err);
    setState({
      vrSupported: false,
      arSupported: false,
      unavailableReason: `WebXR probe failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

void probeSupport();

/**
 * Inject the Three.js renderer. Called from world/scene.ts once the
 * renderer exists so this module can drive renderer.xr.setSession()
 * without importing three at the top level.
 */
export function setRenderer(r: XrRenderer): void {
  renderer = r;
  renderer.xr.enabled = true;
}

export function getXrState(): Readonly<XrState> {
  return state;
}

export function subscribeXr(fn: XrListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Request an immersive-vr session and hand it to the renderer. Safe to
 * call when already presenting (no-op) or unsupported (rejects with the
 * stored reason).
 */
export async function enterVR(): Promise<void> {
  return enterSession('vr');
}

/**
 * Request an immersive-ar (passthrough) session. Only meaningful on
 * Quest 3 / Vision Pro and similar — see arSupported. The world will
 * render with a transparent background so the headset's camera feed
 * shows through; main.ts wires world.setPassthrough() to this mode.
 */
export async function enterAR(): Promise<void> {
  return enterSession('ar');
}

async function enterSession(mode: 'vr' | 'ar'): Promise<void> {
  xrLog(`enterSession(${mode}) requested`, {
    presenting: state.presenting,
    hasRenderer: !!renderer,
    vrSupported: state.vrSupported,
    arSupported: state.arSupported,
  });
  if (state.presenting) {
    xrLog('already presenting — ignoring');
    return;
  }
  if (!renderer) throw new Error('XR renderer not set — call setRenderer first');
  if (mode === 'vr' && !state.vrSupported) {
    throw new Error(state.unavailableReason ?? 'WebXR is not available');
  }
  if (mode === 'ar' && !state.arSupported) {
    throw new Error('Immersive AR is not available on this device');
  }
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr!;
  // local-floor: scene origin sits at the player's floor at headset
  // boot. The player's height is reported by the runtime; aircraft
  // appear above their head as expected. local (no -floor) would put
  // the camera at scene origin which is wrong for an air-traffic scope.
  //
  // It's an OPTIONAL feature, not a required one: making it required means
  // any runtime that won't grant local-floor rejects the whole session
  // outright (a silent dead end on headsets we can't test). As optional,
  // the session still starts and three.js falls back to a 'local' space.
  const sessionMode = mode === 'vr' ? 'immersive-vr' : 'immersive-ar';
  try {
    xrLog(`requestSession(${sessionMode}) with optionalFeatures: ['local-floor']`);
    const session = await xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor'],
    });
    xrLog('requestSession resolved — session granted', {
      // Logs which features the runtime actually granted, so a missing
      // local-floor (the reason aircraft could float at the wrong height)
      // is visible without guessing.
      grantedFeatures: (session as XRSession & { enabledFeatures?: readonly string[] })
        .enabledFeatures,
    });
    currentSession = session;
    session.addEventListener('end', () => {
      xrLog('session ended');
      currentSession = null;
      setState({ presenting: false, presentingMode: null });
    });
    xrLog('handing session to renderer.xr.setSession()');
    await renderer.xr.setSession(session);
    xrLog(`setSession resolved — ${mode.toUpperCase()} session is live`);
    setState({ presenting: true, presentingMode: mode, lastError: null });
  } catch (err) {
    // Surface the failure instead of letting it vanish — the settings
    // panel renders lastError so the actual runtime message is visible
    // (the only way to diagnose headset-specific failures remotely).
    xrError(`enterSession(${mode}) failed`, err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    setState({ lastError: `Could not start ${mode.toUpperCase()} session — ${message}` });
    throw err;
  }
}

/**
 * Politely end the active session. The session-end handler will also
 * fire if the user removes the headset or uses the system menu, so
 * this is just one of several exit paths.
 */
export async function exitVR(): Promise<void> {
  if (!currentSession) return;
  await currentSession.end();
}
