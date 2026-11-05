import changelog from '../../../CHANGELOG.md?raw';
import { t } from '../core/i18n';
import { baseVersion } from '../core/update-check';

// "What's new" — shown once per version, the first time a browser loads a
// build whose version differs from the one it last saw. The notes are the
// matching section of CHANGELOG.md, bundled at build time (Dockerfile
// copies it beside frontend/). A browser that has never seen any version
// records the current one silently: a first visit is not an upgrade.
// English only on purpose — release notes are not translated.

const SEEN_KEY = 'adsb3d_seen_version';
const CHANGELOG_URL = 'https://github.com/hook-365/adsb-3d/blob/master/CHANGELOG.md';

/** Pure: the Markdown body of `## [version]` in a Keep-a-Changelog file, or null. */
export function notesForVersion(md: string, version: string): string | null {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^## \\[${esc}\\][^\\n]*\\n`, 'm');
  const m = head.exec(md);
  if (!m) return null;
  const rest = md.slice(m.index + m[0].length);
  const next = /^(## \[|---\s*$)/m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  return body.length > 0 ? body : null;
}

/** Inline Markdown subset → DOM nodes: **bold**, `code`, [text](https://…). */
function inline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const b = document.createElement('strong');
      b.textContent = m[1];
      frag.append(b);
    } else if (m[2] !== undefined) {
      const c = document.createElement('code');
      c.textContent = m[2];
      frag.append(c);
    } else {
      const a = document.createElement('a');
      a.textContent = m[3]!;
      a.href = m[4]!;
      a.target = '_blank';
      a.rel = 'noopener';
      frag.append(a);
    }
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** Block Markdown subset → element: ### headings and "- " bullets (wrapped lines joined). */
export function renderNotes(md: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'whats-new-body';
  let list: HTMLUListElement | null = null;
  let bullet: string[] | null = null;
  const flushBullet = (): void => {
    if (!bullet || !list) return;
    const li = document.createElement('li');
    li.append(inline(bullet.join(' ')));
    list.append(li);
    bullet = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,6} /.test(line)) {
      flushBullet();
      list = null;
      const h = document.createElement('h4');
      h.textContent = line.replace(/^#+ /, '');
      root.append(h);
    } else if (/^- /.test(line)) {
      flushBullet();
      if (!list) {
        list = document.createElement('ul');
        root.append(list);
      }
      bullet = [line.slice(2)];
    } else if (line.trim() === '') {
      flushBullet();
    } else if (bullet) {
      bullet.push(line.trim());
    } else {
      const p = document.createElement('p');
      p.append(inline(line.trim()));
      root.append(p);
    }
  }
  flushBullet();
  return root;
}

/** Pure decision: should the dialog show, and what should be recorded. */
export function whatsNewDecision(
  appVersion: string | undefined,
  seen: string | null,
): { show: boolean; record: string | null } {
  const cur = appVersion ? baseVersion(appVersion) : null;
  if (!cur) return { show: false, record: null };
  if (seen === cur) return { show: false, record: null };
  return { show: seen !== null, record: cur };
}

export function mountWhatsNew(): void {
  let seen: string | null = null;
  try {
    seen = window.localStorage.getItem(SEEN_KEY);
  } catch {
    return; // no storage: no way to show it only once, so never show it
  }
  const { show, record } = whatsNewDecision(window.APP_VERSION, seen);
  if (record) {
    try {
      window.localStorage.setItem(SEEN_KEY, record);
    } catch {
      // ignore
    }
  }
  if (!show || !record) return;
  const notes = notesForVersion(changelog, record);
  if (!notes) return;

  const dialog = document.createElement('section');
  dialog.className = 'whats-new';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', t('misc.whats_new_title', { version: record }));
  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = t('misc.whats_new_title', { version: record });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'whats-new-close';
  close.setAttribute('aria-label', t('misc.whats_new_close'));
  close.textContent = '×';
  close.addEventListener('click', () => dialog.remove());
  header.append(title, close);
  const footer = document.createElement('footer');
  const link = document.createElement('a');
  link.href = CHANGELOG_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = t('misc.whats_new_full');
  footer.append(link);
  dialog.append(header, renderNotes(notes), footer);
  document.body.appendChild(dialog);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dialog.remove();
  });
}
