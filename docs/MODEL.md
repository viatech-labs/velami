# Local name and address model

Rules find what has a format: cards, IBANs, tax codes, phone numbers, keys. Names and addresses
have no format, so the extension ships a neural model for them. It runs on the user's computer,
inside the extension, with no network.

## The model

| | |
|---|---|
| Base | GLiNER multi PII v1, `urchade/gliner_multi_pii-v1`, Apache-2.0 |
| ONNX export | `onnx-community/gliner_multi_pii-v1`, revision `2e0397a` |
| Encoder | `microsoft/mdeberta-v3-base`, MIT |
| Labels | `person`, `address` |
| Runtime | onnxruntime-web 1.31.1 (MIT), WASM, SIMD, up to 4 threads |
| Files in the package | `models/ner/model.onnx` 1.7 MB (graph), `model.data` 164 MB (weights), `tokenizer.json` 2.7 MB, `meta.json`, `NOTICE.txt` |

GLiNER scores every span of up to 12 words against every label. This gives exact boundaries for
inflected Russian names and for multi-word addresses.

Changes from the original:

- The vocabulary is cut from 250,101 to 75,095 tokens. Kept are tokens that occur at least three
  times in 600 thousand English, Italian and Russian sentences (Leipzig Corpora Collection, news
  2023 and Wikipedia), plus every single Latin and Cyrillic character and the byte tokens. The
  corpora are used only at build time to count frequencies, no text goes into the package.
- Embeddings are stored as int8 per row. The weights of all 105 matrices are stored in 8 bits in
  blocks of 128 (`MatMulNBits`, symmetric) and stay that way in memory. On the evaluation set the
  result matches the fp32 model error for error.

Licenses and provenance are listed in `models/ner/NOTICE.txt`, the onnxruntime-web license is in
`vendor/onnxruntime-web/LICENSE.txt`. Both folders are part of the package.

## Build

```sh
npm ci && npm run setup          # onnxruntime-web and pdf.js into vendor/
uv venv .venv-model && uv pip install --python .venv-model/bin/python -r tools/model/requirements.txt
npm run model                    # .venv-model/bin/python tools/model/build_model.py
```

Every input is pinned by SHA-256. The result is compared with `tools/model/model.lock.json` and
the build fails on any difference. Two builds in a row give the same bytes. `npm run build` will
not create a package if the model files differ from the lock or `vendor/` is missing. `models/`,
`vendor/`, `.cache/` and `.venv-model/` are not kept in git.

The tokenizer (Unigram, Viterbi, NFKC) is our own, in `src/ner-core.js`. A test compares it with
the Hugging Face tokenizers library on 3,019 words from `test/fixtures/model-tokens.json`.

## How the extension uses it

The model lives in an offscreen document (`offscreen.html`, `src/offscreen.js`). The background
process creates it on the first check. The document closes itself after 5 minutes without work,
and all model memory goes back to the system. It answers only the extension's own background
process.

Threads need cross-origin isolation, so the manifest sets COOP `same-origin` and COEP
`require-corp`. The CSP allows `'wasm-unsafe-eval'` for WebAssembly, and `connect-src` allows only
the extension's own files and `httpbin.org` for the self-test. e2e checks that the offscreen
document cannot reach any other address.

Found values become a temporary dictionary in the memory of the background process. It lives for
30 minutes and is never written to disk. It has lower priority than the rules and the user's
dictionary. The model threshold is 0.5. Findings with a score below 0.8 are shown in yellow in the
panel, marked "the model is not sure, please check". Names of AI services (ChatGPT, Claude and so
on) are dropped by a stop list.

Timeouts:

- the panel waits 250 ms for the model, then shows what the rules found and adds the model's
  findings when they are ready;
- sending waits up to 3 seconds for the model, enough for the first load too;
- the model gets the first 20,000 characters of a message.

If the model is late, fails, or the text is longer than the limit, the message still goes with what
the rules and the dictionary found, and the user sees a warning "names not checked" or "only part
was checked". The model can be turned off in the popup.

## Quality

`npm run eval:model`: the open set `test/model-set.json` of 118 made-up texts with names and
addresses marked. 90 short phrases, 30 per language, and 28 documents: letters, contracts, tables,
chats, forms, and one document with no personal data. Threshold 0.5.

The script prints two tables. The first shows the model alone. The second shows the pipeline, that
is what the extension actually replaces: rules, model findings and variants of found names.

| Slice | Model precision | Model recall | Pipeline precision | Pipeline recall |
|---|---|---|---|---|
| EN | 100% | 96% | 100% | 98% |
| IT | 96% | 98% | 96% | 98% |
| RU | 98% | 82% | 98% | 98% |
| Phrases | 96% | 94% | 96% | 97% |
| Documents | 100% | 89% | 100% | 99% |
| All | 98% | 91% | 98% | 98% |

The model alone is weakest on Russian documents. It misses addresses in the official format
("620014, г. Екатеринбург, ул. Малышева, д. 51, кв. 17"), signatures with initials
("Тихонов М. И.") and a repeated address by first name and patronymic. In a long text it can lose
a full name it finds in a short phrase. So rules work next to the model (`src/detector.js`):

- an address with a street type and a house number in three languages: "ул.", "проспект", "д.",
  "кв.", "Via", "Corso", "Piazza" with a CAP, "Street", "Avenue" with a postcode. The address must
  be on one line, and an Italian street name must start with a normal word, not an abbreviation,
  otherwise "via USB 2" would be an address too;
- a Russian full name by patronymic ("Руслану Тимуровичу", "Елена Петровна") and by initials
  ("Ахмедов Р. Т.", "К. А. Белов"). The word to the left of the name is taken only if it looks like
  a surname or is not at the start of a sentence, so in "Передай Руслану Тимуровичу" the verb stays
  visible;
- every name the model finds gives variants: first name with patronymic, initials with surname,
  "F. Moretti". A surname alone without context is not added, it matches ordinary words too often
  ("Conti", "Testa");
- what the model finds is searched by word stem, so "Ивану Сергеевичу Кузнецову" also catches
  "Иван Сергеевич Кузнецов". The user's dictionary stays in the nominative case.

The rules were checked for false positives on 10 million characters of documentation and
correspondence (781 files): every address and name found was real. The detector spends a few
milliseconds on 100,000 characters.

The set is small and made by us, so the numbers show the order of magnitude, not a guarantee.
There will be errors on real texts. Known ones:

- an address without a street type or in free form: "дома 8 по улице Гагарина в Твери",
  "Большая Дмитровка, 7/5" without "ул.";
- rare surnames without a first name ("Greco") and a first name without a surname in a long
  English text ("Robert");
- extra findings on "самозанятый", "dipendente part-time" and on a city name without an address.

That is why the interface calls the model a helper, not a guarantee. Important names are still
worth adding to the dictionary.

## Speed and memory

Measured on a MacBook (Apple Silicon), Chrome for Testing, `chrome.runtime` from the extension
page. A short message is about 15 words, a long one 126 words. Runs vary up to one and a half
times, the table shows the range over several runs.

| Threads | Short | Long |
|---|---|---|
| 1 | 440 ms | 1.6 s |
| 2 | 250 ms | 0.9 s |
| 4 | 140–245 ms | 0.46–0.8 s |

| | |
|---|---|
| Load on first use | 0.5–0.8 s |
| Offscreen document memory with the model loaded | 253 MB |
| Package size | 186 MB |

The number of threads is one less than the number of cores, at most 4. Almost all of a short check
goes into unpacking the 8-bit weights, which does not depend on text length and is split between
threads. The user rarely sees the delay: the panel updates asynchronously, and on send the result
is usually already in the preview cache. The wait shows only when text is pasted and sent at once.

Memory is measured with `performance.measureUserAgentSpecificMemory()` in the offscreen document.
WebAssembly memory does not shrink after release, so the peak at load matters, not only the size
of the weights. What we tried (WASM memory and time per phrase in Node, one thread):

| Variant | Memory | Time | Result |
|---|---|---|---|
| int8 per channel, expanded to fp32 at load, one file | 1080 MB | 96 ms | first version, 1092 MB in Chrome |
| same, weights in a separate `model.data` | 805 MB | 96 ms | 825 MB in Chrome |
| fp32 ahead of time, separate file | 717 MB | 96 ms | package 445 MB |
| int8 without expansion (DequantizeLinear on every run) | 491 MB | 2× | worse than MatMulNBits |
| ORT format | — | 2× | onnxruntime-web does not optimize it at load |
| **8 bit, block 128, MatMulNBits (current)** | **200 MB** | 450 ms | 253 MB in Chrome, same quality as fp32 |
| 8 bit, block 32 | 247 MB | 450 ms | not faster, more memory |
| 4 bit, block 32 | 175 MB | 470 ms | same quality on the set but scores shift, package 140 MB |
| dynamic int8 quantization of activations | — | — | 9% recall because of activation outliers in DeBERTa |

Memory is taken only while the model is loaded: from the first check until 5 minutes without work.

## Open questions

- On a slow dual-core laptop a short check takes about half a second or more. If real users
  notice, the next step is a model with a smaller encoder, distillation for two labels, or WebGPU
  where available.
- The model ships in the package, the extension never downloads files.
- The evaluation set should grow with texts that are realistic in structure but made up in
  content: letters, contracts, tables.
- The terms of the Leipzig Corpora Collection: no text from it is in the package, but the
  vocabulary frequencies come from it.
