import { localDate } from '../../shared/dates.js';
import type { Journal } from '../journal/api.js';
import { formatTokens } from '../journal/tokens.js';
import type { UsageSnapshot } from '../journal/usage.js';
import { usageFigure } from './helpers.js';

export function bindUsage(opts: {
  doc: Document;
  menuUsage: HTMLButtonElement;
  usageDialog: HTMLDialogElement;
  usageClose: HTMLButtonElement;
  usageToday: HTMLElement;
  usageTotal: HTMLElement;
  usageDays: HTMLOListElement;
  usageEmpty: HTMLElement;
  setMenu: (shown: boolean) => void;
  getJournal: () => Journal | null;
  journalReady: Promise<Journal | null>;
}): { refresh: () => Promise<void>; dialog: HTMLDialogElement } {
  const {
    doc,
    menuUsage,
    usageDialog,
    usageClose,
    usageToday,
    usageTotal,
    usageDays,
    usageEmpty,
    setMenu,
    getJournal,
    journalReady,
  } = opts;

  const render = (snapshot: UsageSnapshot): void => {
    usageToday.textContent = usageFigure(snapshot.today);
    usageTotal.textContent = usageFigure(snapshot.sum);
    usageDays.replaceChildren();
    for (const day of snapshot.days) {
      const item = doc.createElement('li');
      item.textContent = `${day.date}　${formatTokens(day.total)}`;
      usageDays.append(item);
    }
    usageEmpty.hidden = snapshot.days.length > 0;
  };

  const refresh = async (): Promise<void> => {
    const today = localDate(new Date());
    const opened = getJournal() ?? (await journalReady);
    try {
      if (!opened) throw new Error('no journal');
      render(await opened.readUsage(today));
    } catch {
      render({
        today: { date: today, input: 0, output: 0, total: 0, calls: 0, cacheRead: 0, reasoning: 0 },
        sum: { date: '', input: 0, output: 0, total: 0, calls: 0, cacheRead: 0, reasoning: 0 },
        days: [],
      });
    }
  };

  menuUsage.addEventListener('click', () => {
    setMenu(false);
    usageDialog.showModal();
    void refresh();
  });
  usageClose.addEventListener('click', () => usageDialog.close());

  return { refresh, dialog: usageDialog };
}
