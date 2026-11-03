import { openJournal } from './journal/api.js';
import { buildChrome } from './panel/chrome.js';
import { paintDocument, paintStage } from '../ui/dress.js';
import { mountPanel } from './panel.js';
import { Stage } from './stage.js';
import { syncStars } from './stars.js';
import { restoreSettings } from './settings.js';
import { dbSnapshotStore, type SnapshotStore } from './journal/store.js';
import { readBuffer } from './world/storage.js';
import {
  flushWorld,
  installWorldStore,
  restoreWorld,
  setWorldTerrainSource,
} from './worldStore.js';
import { prepareWorld } from './worker/worldClient.js';
import { classify } from '../shared/sim/snapshot.js';
import { localDate } from '../shared/dates.js';
import { SimSession } from '../shared/sim/session.js';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('Missing #stage host element');
const parent = host.parentElement!;
paintDocument(document);
paintStage(parent, host);
parent.append(buildChrome(document));
syncStars(document);

const opening = openJournal().catch(() => null);
const backend = opening.then((opened) => opened?.store ?? dbSnapshotStore());
const store: SnapshotStore = {
  readSnapshot: async () => (await backend).readSnapshot(),
  putSnapshot: async (record) => (await backend).putSnapshot(record),
  removeSnapshot: async () => (await backend).removeSnapshot(),
  sweepSnapshots: async (today) => (await backend).sweepSnapshots(today),
};
await restoreSettings();

function hintedSeed(): number {
  const found = classify(readBuffer(), localDate(new Date()));
  if (found.status === 'ok') return found.record.seed;
  return Math.floor(Math.random() * 1_000_000_000);
}

let ready = await prepareWorld(hintedSeed());
const session = new SimSession(ready.seed, ready.terrain);
setWorldTerrainSource(async (seed) => {
  if (seed !== ready.seed) ready = await prepareWorld(seed);
  return ready.terrain;
});
let stage: Stage | undefined;

window.addEventListener('pagehide', () => {
  flushWorld('hide');
  session.cancel();
  stage?.dispose();
});

const note = await restoreWorld(session, new Date(), store);
stage = new Stage(host, session.spider);
stage.placeIsland(ready.island);
stage.setIslandSource(async (seed) => (await prepareWorld(seed)).island);
stage.bind(
  (dt) => session.frame(dt),
  () => session.world,
);
stage.start();
mountPanel(document, session, stage, note, opening);
installWorldStore(session, store);
flushWorld('poke');
