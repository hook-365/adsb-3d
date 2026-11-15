import { t } from '../core/i18n';
import { getLoading, subscribeLoading } from '../core/loading';

// "Loading 3D storms, weather radar…" at the top centre while a layer the
// user has on is still fetching its data (core/loading.ts). Weather for a
// place nobody has looked at lately takes the sidecar several seconds to
// crop; without this the toggle just looks broken until the storm appears.
//
// It waits a moment before showing, so a load that is already cached never
// flashes it, and leaves as soon as nothing is pending. It shares the
// emergency toasts' column so the two stack instead of overlapping.

const SHOW_AFTER_MS = 500;

export function mountLoadingToast(): void {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  const spinner = document.createElement('span');
  spinner.className = 'toast-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  el.append(spinner, text);
  host.appendChild(el);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const render = (): void => {
    const what = getLoading();
    if (what.length === 0) {
      clearTimeout(timer);
      timer = undefined;
      el.hidden = true;
      return;
    }
    text.textContent = t('misc.loading_toast', { what: what.join(', ') });
    if (!el.hidden || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (getLoading().length > 0) el.hidden = false;
    }, SHOW_AFTER_MS);
  };
  subscribeLoading(render);
  render();
}
