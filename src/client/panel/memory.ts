import type { MenuSelect } from '../../ui/select/index.js';
import { reflectSwitch } from '../../ui/switch/index.js';
import type { Journal } from '../journal/api.js';
import { readPilot, writePilot } from '../settings.js';

export function bindMemory(opts: {
  menuMemory: HTMLButtonElement;
  memoryForm: HTMLFormElement;
  memoryEmpty: HTMLElement;
  dateSelect: MenuSelect;
  lineInput: HTMLInputElement;
  notedInput: HTMLTextAreaElement;
  summaryInput: HTMLTextAreaElement;
  autoMemoryInput: HTMLInputElement;
  showPage: () => void;
  getJournal: () => Journal | null;
  journalReady: Promise<Journal | null>;
}): void {
  const {
    menuMemory,
    memoryForm,
    memoryEmpty,
    dateSelect,
    lineInput,
    notedInput,
    summaryInput,
    autoMemoryInput,
    showPage,
    getJournal,
    journalReady,
  } = opts;

  const fill = (page: { line: string; noted: string; summary: string }): void => {
    lineInput.value = page.line;
    notedInput.value = page.noted;
    summaryInput.value = page.summary;
  };

  const show = async (): Promise<void> => {
    const opened = getJournal() ?? (await journalReady);
    /* v8 ignore next */
    if (!opened) return;
    const pages = await opened.pages();
    memoryEmpty.hidden = pages.length > 0;
    dateSelect.setChoices(
      pages.map((page) => ({
        value: page.date,
        label: page.description ? `${page.date} ${page.description}` : page.date,
      })),
    );
    const latest = pages[pages.length - 1];
    if (latest) {
      dateSelect.value = latest.date;
      fill({ line: latest.description, noted: latest.noted, summary: latest.summary });
    } else {
      lineInput.value = '';
      notedInput.value = '';
      summaryInput.value = '';
    }
    autoMemoryInput.checked = readPilot().autoMemory;
    reflectSwitch(autoMemoryInput);
    showPage();
  };

  menuMemory.addEventListener('click', () => {
    void show();
  });
  autoMemoryInput.addEventListener('change', () => {
    writePilot({ ...readPilot(), autoMemory: autoMemoryInput.checked });
  });
  dateSelect.addEventListener('change', () => {
    void getJournal()
      ?.read(dateSelect.value)
      .then((page) => {
        if (page) fill(page);
      });
  });
  const save = (): void => {
    const journal = getJournal();
    if (!journal) return;
    const date = dateSelect.value || journal.date;
    void journal.write({
      date,
      line: lineInput.value,
      noted: notedInput.value,
      summary: summaryInput.value,
    });
  };
  memoryForm.addEventListener('input', save);
  memoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
}
