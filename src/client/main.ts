import { openJournal } from '@/src/client/journal/api';
import { buildChrome } from '@/src/client/panel/chrome';
import { paintDocument, paintStage } from '@/src/ui/dress';
import { mountPanel } from '@/src/client/panel';
import { startThemeClock } from '@/src/client/themeClock';
import { Stage } from '@/src/client/stage';
import { syncStars } from '@/src/client/stars';
import { restoreSettings } from '@/src/client/settings';
import { dbSnapshotStore, type SnapshotStore } from '@/src/client/journal/store';
import { readBuffer } from '@/src/client/world/storage';
import { cloudHolds, keepaliveCloud, startCloud } from '@/src/client/cloud/sync';
import {
  flushWorld,
  installWorldStore,
  restoreWorld,
  setWorldTerrainSource,
} from '@/src/client/worldStore';
import { prepareWorld } from '@/src/client/worker/worldClient';
import { classify } from '@/src/shared/sim/snapshot';
import { localDate } from '@/src/shared/dates';
import { SimSession } from '@/src/shared/sim/session';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('Missing #stage host element');
const parent = host.parentElement!;
paintDocument(document);
const stopThemeClock = startThemeClock(document);
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
  stopThemeClock();
  flushWorld('hide');
  keepaliveCloud();
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
await startCloud({
  hold: (on) => stage.hold(on),
  retile: () => stage.retile(),
});
if (!cloudHolds()) flushWorld('poke');
