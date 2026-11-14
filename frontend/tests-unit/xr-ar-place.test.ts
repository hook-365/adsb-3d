import { describe, expect, it, vi } from 'vitest';
import { Group, Scene, type WebGLRenderer } from 'three';
import { NO_SURFACE_TIMEOUT_MS, XrArPlace } from '../src/world/xr-ar-place';

// Issue #18: a headset with no surface detection must not leave place
// mode armed forever (it swallows every trigger press while armed).

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(opts: { hitTest?: boolean; granted?: boolean } = {}) {
  const hitTest = opts.hitTest ?? true;
  let nowMs = 0;
  let pose: { transform: { position: { x: number; y: number; z: number } } } | null = null;
  const source = { cancel: vi.fn() };
  const session: Record<string, unknown> = {
    enabledFeatures: opts.granted === false ? ['local-floor'] : ['local-floor', 'hit-test'],
    requestReferenceSpace: () => Promise.resolve({}),
  };
  if (hitTest) session.requestHitTestSource = () => Promise.resolve(source);
  const renderer = {
    xr: { getSession: () => session, getReferenceSpace: () => ({}) },
  } as unknown as WebGLRenderer;
  const xrRoot = new Group();
  const place = new XrArPlace({ renderer, scene: new Scene(), xrRoot, now: () => nowMs });
  const frame = {
    getHitTestResults: () => (pose ? [{ getPose: () => pose }] : []),
  } as unknown as XRFrame;
  return {
    place,
    xrRoot,
    frame,
    advance: (ms: number) => {
      nowMs += ms;
    },
    setPose: (p: typeof pose) => {
      pose = p;
    },
  };
}

describe('XrArPlace without surfaces', () => {
  it('gives up after the timeout and reports no surface', async () => {
    const t = setup();
    const unavailable = vi.fn();
    t.place.onUnavailable(unavailable);
    expect(t.place.isSupported()).toBe(true);

    t.place.toggle();
    await flush();
    t.advance(NO_SURFACE_TIMEOUT_MS - 1);
    t.place.tick(t.frame);
    expect(t.place.isActive()).toBe(true);
    // Armed with nothing under the gaze: the press is swallowed.
    expect(t.place.handleSelect()).toBe(true);

    t.advance(1);
    t.place.tick(t.frame);
    expect(t.place.isActive()).toBe(false);
    expect(t.place.foundNoSurface()).toBe(true);
    expect(t.place.isSupported()).toBe(false);
    expect(unavailable).toHaveBeenCalledTimes(1);
    // Disarmed: triggers go back to picking aircraft.
    expect(t.place.handleSelect()).toBe(false);
  });

  it('arming again retries, and a new session forgets the verdict', async () => {
    const t = setup();
    t.place.toggle();
    await flush();
    t.advance(NO_SURFACE_TIMEOUT_MS);
    t.place.tick(t.frame);
    expect(t.place.foundNoSurface()).toBe(true);

    t.place.toggle();
    expect(t.place.isActive()).toBe(true);
    expect(t.place.foundNoSurface()).toBe(false);

    t.advance(NO_SURFACE_TIMEOUT_MS);
    t.place.tick(t.frame);
    expect(t.place.foundNoSurface()).toBe(true);
    t.place.endSession();
    expect(t.place.foundNoSurface()).toBe(false);
  });

  it('never times out on a headset that does see surfaces', async () => {
    const t = setup();
    t.place.toggle();
    await flush();
    t.setPose({ transform: { position: { x: 1, y: 0.7, z: -2 } } });
    t.advance(1000);
    t.place.tick(t.frame);
    // Looking away for a while after a hit is not "no surface".
    t.setPose(null);
    t.advance(NO_SURFACE_TIMEOUT_MS - 1);
    t.place.tick(t.frame);
    expect(t.place.isActive()).toBe(true);

    t.setPose({ transform: { position: { x: 1, y: 0.7, z: -2 } } });
    t.place.tick(t.frame);
    expect(t.place.handleSelect()).toBe(true);
    expect(t.xrRoot.position.toArray()).toEqual([1, 0.7, -2]);
    expect(t.place.isActive()).toBe(false);
    expect(t.place.foundNoSurface()).toBe(false);
  });

  it('says so at once when the runtime has no hit-test API', () => {
    const t = setup({ hitTest: false, granted: false });
    expect(t.place.isSupported()).toBe(false);
    t.place.toggle();
    expect(t.place.isActive()).toBe(false);
    expect(t.place.foundNoSurface()).toBe(true);
  });
});
