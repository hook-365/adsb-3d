// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { computeViewInsets, viewOffsetFor } from '../src/world/view-offset';

function dom(opts: {
  style?: string;
  sidebarOpen?: boolean;
  detail?: boolean;
  acars?: boolean;
  bodyClass?: string;
}): Document {
  document.documentElement.dataset.panelStyle = opts.style ?? 'docked';
  document.body.className = opts.bodyClass ?? '';
  document.body.innerHTML = `
    <aside id="aircraft-panel" class="${opts.sidebarOpen === false ? 'collapsed' : ''}"></aside>
    <section id="panel-detail" ${opts.detail ? '' : 'hidden'}></section>
    <section id="acars-panel" ${opts.acars ? '' : 'hidden'}></section>`;
  return document;
}

describe('computeViewInsets', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.panelStyle;
  });

  it('is zero in glass style regardless of panels', () => {
    expect(computeViewInsets(dom({ style: 'glass', detail: true }), 1440)).toEqual({ left: 0, right: 0 });
  });

  it('covers the sidebar when open and the left column when any left panel shows', () => {
    expect(computeViewInsets(dom({}), 1440)).toEqual({ left: 0, right: 320 });
    expect(computeViewInsets(dom({ sidebarOpen: false }), 1440)).toEqual({ left: 0, right: 0 });
    expect(computeViewInsets(dom({ detail: true }), 1440)).toEqual({ left: 340, right: 320 });
    expect(computeViewInsets(dom({ sidebarOpen: false, acars: true }), 1440)).toEqual({ left: 340, right: 0 });
  });

  it('backs off on narrow viewports, in stereo and in XR', () => {
    expect(computeViewInsets(dom({ detail: true }), 390)).toEqual({ left: 0, right: 0 });
    expect(computeViewInsets(dom({ bodyClass: 'stereo-on' }), 1440)).toEqual({ left: 0, right: 0 });
    expect(computeViewInsets(dom({ bodyClass: 'xr-on' }), 1440)).toEqual({ left: 0, right: 0 });
  });
});

describe('viewOffsetFor', () => {
  it('returns null when nothing is covered', () => {
    expect(viewOffsetFor(1440, 900, { left: 0, right: 0 })).toBeNull();
  });

  it('centres the projection in the uncovered strip', () => {
    // Sidebar only: full frame 1760 wide, window starts 320 in, so the
    // frame centre (880) lands at viewport x = 560 = (1440 - 320) / 2.
    const [fullW, , x] = viewOffsetFor(1440, 900, { left: 0, right: 320 })!;
    expect(fullW / 2 - x).toBe((1440 - 320) / 2);
    // Both columns: centre of the gap between 340 and 1120 is 730.
    const [fw2, , x2] = viewOffsetFor(1440, 900, { left: 340, right: 320 })!;
    expect(fw2 / 2 - x2).toBe(340 + (1440 - 340 - 320) / 2);
  });
});
