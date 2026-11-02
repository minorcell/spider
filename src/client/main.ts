import './styles/sheet.css';
import { openJournal } from './journal/api.js';
import { mountPanel } from './panel.js';
import { Stage } from './stage.js';
import { flushWorld, installWorldStore, restoreWorld } from './worldStore.js';
import { SimSession } from '../shared/sim/session.js';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('Missing #stage host element');

const session = new SimSession();
let stage: Stage | undefined;

window.addEventListener('pagehide', () => {
  flushWorld('hide');
  session.cancel();
  stage?.dispose();
});

// The worker opens while the first frame is drawn. Until it is ready the
// snapshot preview uses the direct store; the first write then switches over.
const opening = openJournal().catch(() => null);
const note = await restoreWorld(session);
stage = new Stage(host, session.spider);
stage.bind(
  (dt) => session.frame(dt),
  () => session.world,
);
stage.start();
mountPanel(document, session, stage, note, opening);
installWorldStore(session);
void opening.then((opened) => {
  if (opened) installWorldStore(session, opened.store);
});
