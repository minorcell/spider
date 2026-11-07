import type { AppConfig } from '@mlc-ai/web-llm';
import { LOCAL_MODEL } from './types.js';

// Pinned artifacts compatible with @mlc-ai/web-llm 0.2.87.
export const LOCAL_APP_CONFIG: AppConfig = {
  cacheBackend: 'cache',
  model_list: [
    {
      model_id: LOCAL_MODEL,
      model:
        'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/resolve/8c14ce481d4c692769976ad52afea453a102df19/',
      model_lib:
        'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/146ed9cd4b4062e967b017fd2291f7106b50599f/web-llm-models/v0_2_87/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm',
      overrides: { context_window_size: 4096 },
    },
  ],
};
