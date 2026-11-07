import { getSettings, subscribeSettings, updateSettings, type CameraMode } from '../core/settings';
import { t } from '../core/i18n';

// Footer camera-mode switch: two segments, both always visible, the active
// one lit. Icons carry the meaning (a word like "orbit" reads as the
// motion, not the control scheme): a camera circling a globe for orbit,
// a camera with XYZ axes for free flight. Tapping a segment sets
// Settings.cameraMode; main.ts does the actual hand-over between
// OrbitControls and the free camera.

const ORBIT_ICON = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <circle cx="10" cy="10" r="4.2"/>
  <path d="M6.2 8.4c1.1-.5 2.4-.7 3.8-.7s2.7.2 3.8.7M6.2 11.6c1.1.5 2.4.7 3.8.7s2.7-.2 3.8-.7"/>
  <path d="M3.3 13.4a8.8 8.8 0 0 0 13.4 0" stroke-dasharray="1.5 2.2"/>
  <path d="M3.3 13.4 2 12.2M3.3 13.4l1.4-.6"/>
  <circle cx="16.7" cy="13.4" r="1.5" fill="currentColor" stroke="none"/>
</svg>`;

const FREE_ICON = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 16V7M4 16h9M4 16l5-5"/>
  <path d="M4 7l-1.6 1.6M4 7l1.6 1.6M13 16l-1.6-1.6M13 16l-1.6 1.6M9 11l-.2-2.2M9 11l2.2.2"/>
  <rect x="11" y="3.5" width="6" height="4.2" rx="1"/>
  <path d="M11 5.6l-2 1.2V4.4l2 1.2"/>
</svg>`;

export function mountCameraModeSwitch(): void {
  const root = document.getElementById('camera-mode');
  if (!root) return;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', t('settings.camera_mode'));

  const orbit = segment('orbit', ORBIT_ICON, t('static.camera_orbit'), t('static.camera_orbit_title'));
  const free = segment('free', FREE_ICON, t('static.camera_free'), t('static.camera_free_title'));
  root.replaceChildren(orbit, free);

  const sync = (): void => {
    const mode = getSettings().cameraMode;
    orbit.classList.toggle('active', mode === 'orbit');
    free.classList.toggle('active', mode === 'free');
    orbit.setAttribute('aria-pressed', String(mode === 'orbit'));
    free.setAttribute('aria-pressed', String(mode === 'free'));
  };
  subscribeSettings(sync);
  sync();
}

function segment(mode: CameraMode, icon: string, label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'status-btn cam-seg';
  b.title = title;
  b.innerHTML = icon;
  const text = document.createElement('span');
  text.textContent = label;
  b.appendChild(text);
  b.addEventListener('click', () => {
    if (getSettings().cameraMode !== mode) updateSettings({ cameraMode: mode });
  });
  return b;
}
