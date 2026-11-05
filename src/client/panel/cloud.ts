import { closeDialog, showDialog } from '../../ui/dialog/index.js';
import { probeEndpoint } from '../cloud/s3.js';
import { cloudComplete, readCloud, writeCloud, type CloudInput } from '../cloud/settings.js';
import {
  chooseCloudLocal,
  chooseCloudRemote,
  cloudPhase,
  noteCloud,
  onCloudPhase,
  takeOverCloud,
  type CloudPhase,
} from '../cloud/sync.js';

export function bindCloud(input: {
  menu: HTMLButtonElement;
  form: HTMLFormElement;
  status: HTMLElement;
  hold: HTMLElement;
  takeover: HTMLButtonElement;
  choice: HTMLDialogElement;
  useLocal: HTMLButtonElement;
  useRemote: HTMLButtonElement;
  showPage(): void;
}): void {
  const { menu, form, status, hold, takeover, choice, useLocal, useRemote, showPage } = input;

  const field = (name: string): HTMLInputElement => {
    const element = form.elements.namedItem(name);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing settings field ${name}`);
    return element;
  };

  const values = (): CloudInput => ({
    endpoint: field('endpoint').value,
    region: field('region').value,
    bucket: field('bucket').value,
    accessKeyId: field('accessKeyId').value,
    secretAccessKey: field('secretAccessKey').value,
  });

  const fill = (): void => {
    const settings = readCloud();
    field('endpoint').value = settings.endpoint;
    field('region').value = settings.region;
    field('bucket').value = settings.bucket;
    field('accessKeyId').value = settings.accessKeyId;
    field('secretAccessKey').value = settings.secretAccessKey;
  };

  const paint = (phase: CloudPhase): void => {
    hold.style.display = phase.kind === 'locked' ? 'flex' : 'none';
    if (phase.kind === 'choose') showDialog(choice);
    else closeDialog(choice);
    if (phase.kind === 'error') status.textContent = phase.message;
    if (phase.kind === 'ready') status.textContent = '云端已接上。';
    if (phase.kind === 'locked') status.textContent = '另一台电脑正在玩这只蜘蛛。';
    if (phase.kind === 'choose') status.textContent = '这台电脑和云端都有进度，选一份继续。';
  };

  menu.addEventListener('click', () => {
    fill();
    showPage();
  });
  form.addEventListener('input', () => {
    writeCloud(values(), false);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = values();
    if (!cloudComplete(next)) {
      status.textContent = '五项都要填';
      return;
    }
    writeCloud(next, false);
    status.textContent = '正在检查端点…';
    void probeEndpoint({ ...next, ready: false }).then((problem) => {
      if (problem) {
        status.textContent = problem;
        return;
      }
      writeCloud(next, true);
      status.textContent = '已启用。这台电脑上的进度会交给云端。';
      noteCloud('poke');
    });
  });
  useLocal.addEventListener('click', () => {
    void chooseCloudLocal();
  });
  useRemote.addEventListener('click', () => {
    void chooseCloudRemote();
  });
  takeover.addEventListener('click', () => {
    void takeOverCloud();
  });

  onCloudPhase(paint);
  fill();
  paint(cloudPhase());
}
