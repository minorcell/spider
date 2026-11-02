import { closeDialog, showDialog } from '../../ui/dialog/index.js';
import type { Journal } from '../journal/api.js';
import { readPilot } from '../settings.js';
import { explain } from './helpers.js';

export function bindLeave(opts: {
  leave: HTMLDialogElement;
  leaveClose: HTMLButtonElement;
  leaveSummarize: HTMLButtonElement;
  getJournal: () => Journal | null;
  show: (text: string, kind: string) => void;
}): void {
  const { leave, leaveClose, leaveSummarize, getJournal, show } = opts;

  leaveClose.addEventListener('click', () => {
    const journal = getJournal();
    if (journal) journal.dismissed = true;
    closeDialog(leave);
  });
  leaveSummarize.addEventListener('click', () => {
    const journal = getJournal();
    if (!journal) return;
    leaveSummarize.disabled = true;
    void journal
      .digest(readPilot())
      .then(() => {
        show('记下了。这个页面可以关掉了。', 'note');
        closeDialog(leave);
      })
      .catch((error: unknown) => {
        show(explain(error instanceof Error ? error.message : String(error)), 'note');
      })
      .finally(() => {
        leaveSummarize.disabled = false;
      });
  });

  window.addEventListener('beforeunload', (event) => {
    // Vite reloads this page on each save. That is not the user leaving.
    if (import.meta.env.MODE === 'development') return;
    if (!getJournal()?.behind()) return;
    event.preventDefault();
    window.setTimeout(() => {
      showDialog(leave);
    }, 0);
  });
  window.addEventListener('pagehide', () => {
    void getJournal()?.save();
  });
}
