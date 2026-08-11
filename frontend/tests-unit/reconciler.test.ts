// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Group, Mesh, PerspectiveCamera } from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { AircraftReconciler } from '../src/aircraft/reconciler';
import { AircraftStore } from '../src/aircraft/store';
import { setFilter, setSearchQuery } from '../src/core/filter';
import { setHome } from '../src/core/config';
import type { Aircraft } from '../src/core/types';

// Coordinates near HOME so aircraft land close to the scene origin.
const HOME_LAT = 45;
const HOME_LON = -90;

function ac(hex: string, over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex,
    callsign: null,
    registration: null,
    typeCode: null,
    description: null,
    category: null,
    operator: null,
    lat: HOME_LAT,
    lon: HOME_LON,
    altFt: 10000,
    altFtKnown: true,
    onGround: false,
    groundSpeedKt: null,
    trackDeg: null,
    verticalRateFpm: null,
    military: false,
    specialInterest: false,
    privacyIcao: false,
    ladd: false,
    squawk: null,
    emergency: null,
    apAltMcpFt: null,
    apAltFmsFt: null,
    apHeadingDeg: null,
    apQnhHpa: null,
    apModes: null,
    lastSeenMs: 1_000,
    lastUpdateMs: 1_000,
    ...over,
  };
}

function setup() {
  const store = new AircraftStore();
  const root = new Group();
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 100, 100);
  camera.updateMatrixWorld();
  const reconciler = new AircraftReconciler(store, root, camera);
  return { store, root, camera, reconciler };
}

// Traverse root's children to find the aircraft-root Group for a hex.
function findAircraftGroup(root: Group, hex: string): Group | undefined {
  return root.children.find(
    (o) => (o.userData as { kind?: string; hex?: string }).kind === 'aircraft-root' && o.userData.hex === hex,
  ) as Group | undefined;
}

function findByKind(group: Group, kind: string): Mesh | undefined {
  return group.children.find((o) => (o.userData as { kind?: string }).kind === kind) as Mesh | undefined;
}

function findLabel(group: Group): CSS2DObject | undefined {
  const cone = findByKind(group, 'aircraft');
  if (!cone) return undefined;
  return cone.children.find((o) => o instanceof CSS2DObject) as CSS2DObject | undefined;
}

// jsdom doesn't implement the Blob URL registry or canvas 2d context;
// shapes.ts's texture rasterization touches both on the way to building an
// aircraft's ground icon. Stub just enough to make buildEntry's synchronous
// path not throw — the actual raster (async, via Image.onload) never fires
// under jsdom, which is fine since none of these tests assert on pixels.
beforeEach(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:mock';
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => {};
  }
  setHome({ lat: HOME_LAT, lon: HOME_LON, altFt: 0, name: 'Test' });
  setFilter('all');
  setSearchQuery('');
});

afterEach(() => {
  setFilter('all');
  setSearchQuery('');
});

describe('entry lifecycle', () => {
  it('sync builds a group, adds it to root, and bumps count', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('abc')]);
    reconciler.syncFrame();
    expect(reconciler.count).toBe(1);
    expect(findAircraftGroup(root, 'abc')).toBeDefined();
  });

  it('removal drops the group from root, detaches the CSS label, and clears count', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('abc')]);
    reconciler.syncFrame();
    const group = findAircraftGroup(root, 'abc')!;
    const label = findLabel(group)!;
    expect(label.parent).toBe(findByKind(group, 'aircraft'));

    store.syncFromFeed([]);
    reconciler.syncFrame();

    expect(reconciler.count).toBe(0);
    expect(findAircraftGroup(root, 'abc')).toBeUndefined();
    expect(label.parent).toBeNull();
  });

  it('re-add after removal builds a fresh entry', () => {
    const { store, reconciler } = setup();
    store.syncFromFeed([ac('abc', { callsign: 'AAL1' })]);
    reconciler.syncFrame();
    store.syncFromFeed([]);
    reconciler.syncFrame();
    store.syncFromFeed([ac('abc', { callsign: 'DAL2' })]);
    reconciler.syncFrame();
    expect(reconciler.count).toBe(1);
  });
});

describe('rev-gating', () => {
  it('lastSeenMs-only refresh does not touch the label text', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('abc', { callsign: 'AAL1', lastUpdateMs: 1000 })]);
    reconciler.syncFrame();
    const group = findAircraftGroup(root, 'abc')!;
    const label = findLabel(group)!;
    expect(label.element.textContent).toBe('AAL1');

    // Only lastSeenMs advances — excluded from the rev comparison, so no
    // refresh should occur. Mutate the element to a sentinel value and
    // confirm syncFrame doesn't touch it.
    label.element.textContent = 'SENTINEL';
    store.syncFromFeed([ac('abc', { callsign: 'AAL1', lastSeenMs: 5000, lastUpdateMs: 5000 })]);
    reconciler.syncFrame();
    expect(label.element.textContent).toBe('SENTINEL');
  });

  it('a callsign change bumps rev and updates the label', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('abc', { callsign: 'AAL1' })]);
    reconciler.syncFrame();
    const group = findAircraftGroup(root, 'abc')!;
    const label = findLabel(group)!;
    expect(label.element.textContent).toBe('AAL1');

    store.syncFromFeed([ac('abc', { callsign: 'UAL2', lastUpdateMs: 2000 })]);
    reconciler.syncFrame();
    expect(label.element.textContent).toBe('UAL2');
  });
});

describe('emergency ring', () => {
  it('becomes visible when emergency is set and hides when cleared', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('abc', { emergency: null })]);
    reconciler.syncFrame();
    const group = findAircraftGroup(root, 'abc')!;
    const ring = findByKind(group, 'emergency-ring')!;
    expect(ring.visible).toBe(false);

    store.syncFromFeed([ac('abc', { emergency: 'emergency (7700)', squawk: '7700', lastUpdateMs: 2000 })]);
    reconciler.syncFrame();
    expect(ring.visible).toBe(true);

    store.syncFromFeed([ac('abc', { emergency: null, lastUpdateMs: 3000 })]);
    reconciler.syncFrame();
    expect(ring.visible).toBe(false);
  });
});

describe('selection handoff', () => {
  it('moves the selection ring from a to b to none', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('a'), ac('b')]);
    reconciler.syncFrame();
    const ringA = findByKind(findAircraftGroup(root, 'a')!, 'selection-ring')!;
    const ringB = findByKind(findAircraftGroup(root, 'b')!, 'selection-ring')!;
    expect(ringA.visible).toBe(false);
    expect(ringB.visible).toBe(false);

    reconciler.setSelected('a');
    expect(ringA.visible).toBe(true);
    expect(ringB.visible).toBe(false);

    reconciler.setSelected('b');
    expect(ringA.visible).toBe(false);
    expect(ringB.visible).toBe(true);

    reconciler.setSelected(null);
    expect(ringA.visible).toBe(false);
    expect(ringB.visible).toBe(false);
  });

  it('selecting before the aircraft exists applies selection once it is built', () => {
    const { store, root, reconciler } = setup();
    reconciler.setSelected('c');
    store.syncFromFeed([ac('c')]);
    reconciler.syncFrame();
    const ringC = findByKind(findAircraftGroup(root, 'c')!, 'selection-ring')!;
    expect(ringC.visible).toBe(true);
  });

  it('a removed selected aircraft keeps the selection mirror and re-applies it on re-add', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('a')]);
    reconciler.syncFrame();
    reconciler.setSelected('a');
    reconciler.syncFrame();
    expect(findByKind(findAircraftGroup(root, 'a')!, 'selection-ring')!.visible).toBe(true);

    // Aircraft drops out of coverage. The reconciler must NOT clear its own
    // selectedHex mirror here (selection ownership belongs to main.ts) —
    // otherwise the re-entry branch below would never fire.
    store.syncFromFeed([]);
    reconciler.syncFrame();
    expect(findAircraftGroup(root, 'a')).toBeUndefined();

    // Aircraft re-appears: syncFrame's re-entry branch
    // (`if (a.hex === this.selectedHex) this.applySelection(entry, true)`)
    // must re-apply selection to the freshly-built entry.
    store.syncFromFeed([ac('a')]);
    reconciler.syncFrame();
    const ringAgain = findByKind(findAircraftGroup(root, 'a')!, 'selection-ring')!;
    expect(ringAgain.visible).toBe(true);
  });
});

describe('filter visibility', () => {
  it('military-only filter hides civilians and shows military traffic', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('civ', { military: false }), ac('mil', { military: true })]);
    reconciler.syncFrame();
    setFilter('mil');
    reconciler.syncFrame();
    expect(findAircraftGroup(root, 'civ')!.visible).toBe(false);
    expect(findAircraftGroup(root, 'mil')!.visible).toBe(true);
  });

  it('a selected aircraft is exempt from the active filter', () => {
    const { store, root, reconciler } = setup();
    store.syncFromFeed([ac('civ', { military: false })]);
    reconciler.syncFrame();
    reconciler.setSelected('civ');
    setFilter('mil');
    reconciler.syncFrame();
    expect(findAircraftGroup(root, 'civ')!.visible).toBe(true);
  });
});

describe('positionOf', () => {
  it('returns a cloned position for a rendered aircraft', () => {
    const { store, reconciler } = setup();
    store.syncFromFeed([ac('abc')]);
    reconciler.syncFrame();
    const pos = reconciler.positionOf('abc');
    expect(pos).not.toBeNull();
  });

  it('returns null for an aircraft not currently rendered', () => {
    const { reconciler } = setup();
    expect(reconciler.positionOf('ghost')).toBeNull();
  });
});
