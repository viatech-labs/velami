// Модель Velami в Node через тот же onnxruntime-web (WASM), что и в расширении.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NER = require('../src/ner-core.js');
const dir = process.env.VELAMI_MODEL_DIR ? path.resolve(process.env.VELAMI_MODEL_DIR) : path.join(root, 'models/ner');

export const modelBuilt = () => existsSync(path.join(dir, 'model.onnx'));

export async function loadModel({ threads = 1 } = {}) {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = threads;
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const tokenizer = NER.createTokenizer(JSON.parse(readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')));
  const session = await ort.InferenceSession.create(readFileSync(path.join(dir, 'model.onnx')), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    externalData: [{ path: 'model.data', data: readFileSync(path.join(dir, 'model.data')) }],
  });
  const int64 = (v, d) => new ort.Tensor('int64', BigInt64Array.from(v, BigInt), d);
  async function run(words) {
    const x = NER.buildInputs(tokenizer, words, meta.labels, meta.maxWidth);
    const n = x.ids.length;
    const spans = x.length * x.maxWidth;
    const out = await session.run({
      input_ids: int64(x.ids, [1, n]),
      attention_mask: int64(x.ids.map(() => 1), [1, n]),
      words_mask: int64(x.wordsMask, [1, n]),
      text_lengths: int64([x.length], [1, 1]),
      span_idx: int64(x.spanIdx, [1, spans, 2]),
      span_mask: new ort.Tensor('bool', Uint8Array.from(x.spanMask, Number), [1, spans]),
    });
    return NER.decode(out.logits.data, words, meta.labels, { maxWidth: x.maxWidth, threshold: 0.5 });
  }
  return { meta, tokenizer, recognize: (text) => NER.recognize(text, run) };
}
