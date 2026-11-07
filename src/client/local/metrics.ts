import type { MetadataExtractor } from '@ai-sdk/openai-compatible';

function metadata(value: unknown) {
  if (!value || typeof value !== 'object' || !('local_metrics' in value)) return undefined;
  const metrics = value.local_metrics;
  if (!metrics || typeof metrics !== 'object') return undefined;
  return {
    webllm: Object.fromEntries(
      Object.entries(metrics).filter(
        ([, metric]) => typeof metric === 'number' && Number.isFinite(metric) && metric >= 0,
      ),
    ),
  };
}

export const localMetadata: MetadataExtractor = {
  extractMetadata: async ({ parsedBody }) => metadata(parsedBody),
  createStreamExtractor() {
    let result: ReturnType<typeof metadata>;
    return {
      processChunk(chunk) {
        result = metadata(chunk) ?? result;
      },
      buildMetadata() {
        return result;
      },
    };
  },
};
