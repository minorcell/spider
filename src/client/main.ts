import './styles/sheet.css';
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
  session.stop();
  stage?.dispose();
});

const note = await restoreWorld(session);
stage = new Stage(host, session.spider);
stage.bind(
  (dt) => session.frame(dt),
  () => session.world,
);
stage.start();
mountPanel(document, session, stage, note);
installWorldStore(session);
