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
  /** True between session start and session end. */
  presenting: boolean;
  /**
   * Short reason string explaining why VR isn't available, suitable for a
   * settings-panel tooltip. null when supported.
   */
  unavailableReason: string | null;
}

type XrListener = (state: XrState) => void;

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
  presenting: false,
  unavailableReason: 'Checking WebXR support…',
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
    if (typeof navigator === 'undefined' || !('xr' in navigator)) {
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
    const supported = await xr.isSessionSupported('immersive-vr');
    if (supported) {
      setState({ vrSupported: true, unavailableReason: null });
    } else {
      setState({
        vrSupported: false,
        unavailableReason:
          'This device does not support immersive VR. Connect a headset (Quest, Index, etc.) or use a phone with a Cardboard-style viewer in Chrome.',
      });
    }
  } catch (err) {
    setState({
      vrSupported: false,
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
  if (state.presenting) return;
  if (!renderer) throw new Error('XR renderer not set — call setRenderer first');
  if (!state.vrSupported) {
    throw new Error(state.unavailableReason ?? 'WebXR is not available');
  }
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr!;
  // local-floor: scene origin sits at the player's floor at headset
  // boot. The player's height is reported by the runtime; aircraft
  // appear above their head as expected. local (no -floor) would put
  // the camera at scene origin which is wrong for an air-traffic scope.
  const session = await xr.requestSession('immersive-vr', {
    requiredFeatures: ['local-floor'],
  });
  currentSession = session;
  session.addEventListener('end', () => {
    currentSession = null;
    setState({ presenting: false });
  });
  await renderer.xr.setSession(session);
  setState({ presenting: true });
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
