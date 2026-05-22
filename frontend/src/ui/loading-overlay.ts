// Center-screen loading indicator for long-running ops the user
// shouldn't miss: initial live connect, historical-window fetch.
//
// Module-level singleton with a tiny show/hide API. Multiple callers
// can push their own loading state; the overlay shows the most recent
// one and stays visible while any caller is active.

interface ActiveJob {
  id: number;
  title: string;
  detail: string;
}

const root = document.getElementById('loading-overlay') as HTMLElement;
const titleEl = document.getElementById('loading-title') as HTMLElement;
const detailEl = document.getElementById('loading-detail') as HTMLElement;

const jobs = new Map<number, ActiveJob>();
let nextId = 1;

function render(): void {
  if (jobs.size === 0) {
    root.hidden = true;
    return;
  }
  // Show the most recently started job — typical case is one job at a
  // time, but if two race we want the user-visible context to track
  // whichever just started.
  let latest: ActiveJob | null = null;
  for (const job of jobs.values()) latest = job;
  if (!latest) return;
  titleEl.textContent = latest.title;
  detailEl.textContent = latest.detail;
  root.hidden = false;
}

export interface LoadingHandle {
  update(detail: string): void;
  done(): void;
}

export function showLoading(title: string, detail = ''): LoadingHandle {
  const id = nextId++;
  jobs.set(id, { id, title, detail });
  render();
  return {
    update(nextDetail: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.detail = nextDetail;
      render();
    },
    done() {
      jobs.delete(id);
      render();
    },
  };
}
