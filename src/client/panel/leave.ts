import { closeDialog, showDialog } from '@/src/ui/dialog';
import type { Journal } from '@/src/client/journal/api';
import { readPilot } from '@/src/client/settings';
import { explain } from '@/src/client/panel/helpers';

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
