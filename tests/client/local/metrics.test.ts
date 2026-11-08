import { expect, it } from 'vitest';
import { localMetadata } from '@/src/client/local/metrics';

it('keeps finite timings and ignores malformed or missing response metadata', async () => {
  for (const parsedBody of [null, '', {}, { local_metrics: null }]) {
    expect(await localMetadata.extractMetadata({ parsedBody })).toBeUndefined();
  }
  expect(
    await localMetadata.extractMetadata({
      parsedBody: {
        local_metrics: {
          queueMs: 2,
          generationMs: 30,
          invalid: -1,
          infinite: Infinity,
          text: 'no',
        },
      },
    }),
  ).toEqual({ webllm: { queueMs: 2, generationMs: 30 } });
  const stream = localMetadata.createStreamExtractor();
  expect(stream.buildMetadata()).toBeUndefined();
  stream.processChunk({ local_metrics: { queueMs: 2 } });
  stream.processChunk({ choices: [] });
  expect(stream.buildMetadata()).toEqual({ webllm: { queueMs: 2 } });
});
