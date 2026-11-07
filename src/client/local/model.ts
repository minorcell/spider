import type { AppConfig } from '@mlc-ai/web-llm';
import { LOCAL_CONTEXT_TOKENS, LOCAL_MODEL } from './types.js';

// Pinned artifacts compatible with @mlc-ai/web-llm 0.2.87.
export const LOCAL_APP_CONFIG: AppConfig = {
  cacheBackend: 'cache',
  model_list: [
    {
      model_id: LOCAL_MODEL,
      model:
        'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q0f16-MLC/resolve/2c52165f529227534c21d83f140293d86f4eaaa3/',
      model_lib:
        'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/146ed9cd4b4062e967b017fd2291f7106b50599f/web-llm-models/v0_2_87/base/Llama-3.2-1B-Instruct-q0f16_cs1k-webgpu.wasm',
      overrides: { context_window_size: LOCAL_CONTEXT_TOKENS },
      required_features: ['shader-f16'],
    },
  ],
};
