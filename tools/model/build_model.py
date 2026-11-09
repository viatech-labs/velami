"""Сборка локальной модели распознавания имён и адресов для Velami.

Источник: GLiNER multi PII v1 (urchade/gliner_multi_pii-v1, Apache-2.0) в ONNX-экспорте
onnx-community. Из 250 тысяч токенов словаря mDeBERTa оставляем те, что встречаются в 600 тысячах
предложений на английском, итальянском и русском (Leipzig Corpora Collection), плюс все одиночные
символы латиницы и кириллицы. Веса матриц хранятся в 8 битах блоками по 128 (MatMulNBits) и
остаются такими в памяти, эмбеддинги в int8 построчно. Граф лежит в model.onnx, веса в model.data.
Все входы закреплены по SHA-256, результат сверяется с tools/model/model.lock.json.
Подробности и замеры: docs/MODEL.md.

    uv venv .venv-model && . .venv-model/bin/activate && uv pip install -r tools/model/requirements.txt
    python tools/model/build_model.py            # собрать и сверить с lock
    python tools/model/build_model.py --update   # записать новые хеши в lock
"""
import collections, hashlib, json, os, re, shutil, sys, tarfile, urllib.request
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache' / 'model-build'
OUT = ROOT / 'models' / 'ner'
LOCK = Path(__file__).with_name('model.lock.json')

HF = 'https://huggingface.co/onnx-community/gliner_multi_pii-v1/resolve/2e0397a7e8a250d76c37122232b3cbde42c8d629/'
SOURCES = {
    'model.onnx': (HF + 'onnx/model.onnx', '7704865e414f24591da6aee08716a25677855bc8a84af81396d90e40df1e68d2'),
    'tokenizer.json': (HF + 'tokenizer.json', '914bd3c8fb7b525af9e23b60d0ec7b1248ddb2b99014efd9c02ebeb022f8cab7'),
}
LEIPZIG = 'https://downloads.wortschatz-leipzig.de/corpora/'
CORPORA = {
    'eng_news_2023_100K': '8e65ed5b9c96687d293374335c14dfb9db4c150877bcc208a21bcb2f86b43484',
    'eng_wikipedia_2016_100K': '04aa301072a612e0368f1a0abe5f6b011ab03df84961c29b80bd126883a5a6f0',
    'ita_news_2023_100K': '5db4079d208b80a1cab4fed9f2995bbc1433c32edad99d00d5b0e79d006e6869',
    'ita_wikipedia_2021_100K': '4fc8d1cf4133a5325020a3ba1c0b9211543719ad967eba6da5ce6a9ad4ce5ad6',
    'rus_news_2023_100K': '2c69a5561d86954cd9c582e837a0482611161da16ec2944e5fd856facd3ad040',
    'rus_wikipedia_2021_100K': '7a67e6b3c756c19fde530847d6b6cc77c235f1ccd883776fe4c06fd37ba78297',
}
MIN_FREQ = 3
EMB = 'token_rep_layer.bert_layer.model.embeddings.word_embeddings.weight'
LABELS = ['person', 'address']


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(name, url, digest):
    path = CACHE / name
    if not path.exists() or sha256(path) != digest:
        print('download', url)
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + '.part')
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, path)
    if sha256(path) != digest:
        sys.exit(f'SHA-256 mismatch for {name}')
    return path


def sentences():
    out = []
    for name, digest in sorted(CORPORA.items()):
        tgz = fetch(name + '.tar.gz', LEIPZIG + name + '.tar.gz', digest)
        with tarfile.open(tgz) as tar:
            member = next(m for m in tar.getmembers() if m.name.endswith('-sentences.txt'))
            for line in tar.extractfile(member).read().decode('utf-8').splitlines():
                out.append(line.split('\t', 1)[1].strip())
    return out


def allowed_char(ch):
    o = ord(ch)
    return (o < 0x250 or 0x1E00 <= o <= 0x1EFF or 0x400 <= o <= 0x52F or 0x2000 <= o <= 0x206F
            or 0x20A0 <= o <= 0x20CF or 0x2100 <= o <= 0x214F or ch == '\u2581')


def keep_ids(tok_path, vocab):
    tok = Tokenizer.from_file(str(tok_path))
    freq = collections.Counter()
    lines = sentences()
    for i in range(0, len(lines), 5000):
        for e in tok.encode_batch(lines[i:i + 5000], add_special_tokens=False):
            freq.update(e.ids)
    keep = []
    for i, (piece, _) in enumerate(vocab):
        core = piece.replace('\u2581', '')
        if i < 4 or piece.startswith('<0x') or freq.get(i, 0) >= MIN_FREQ:
            keep.append(i)
        elif len(core) <= 1 and all(allowed_char(c) for c in piece):
            keep.append(i)
    return keep, len(lines)


def build():
    src_model = fetch('model.onnx', *SOURCES['model.onnx'])
    src_tok = fetch('tokenizer.json', *SOURCES['tokenizer.json'])
    tok = json.loads(src_tok.read_text(encoding='utf-8'))
    vocab = tok['model']['vocab']
    keep, n_sent = keep_ids(src_tok, vocab)
    added = [a for a in tok['added_tokens'] if a['id'] >= len(vocab)]
    keep_all = keep + [a['id'] for a in added]
    remap = {old: new for new, old in enumerate(keep_all)}
    ent_old = next(a['id'] for a in added if a['content'] == '<<ENT>>')
    print(f'vocab {len(vocab)} -> {len(keep)} (+{len(added)} added), {n_sent} sentences')

    tok['model']['vocab'] = [vocab[i] for i in keep]
    tok['model']['unk_id'] = remap[tok['model']['unk_id']]
    for a in tok['added_tokens']:
        a['id'] = remap[a['id']]
    for st in tok['post_processor']['special_tokens'].values():
        st['ids'] = [remap[i] for i in st['ids']]

    m = onnx.load(str(src_model), load_external_data=True)
    g = m.graph
    init = {t.name: t for t in g.initializer}

    patched = 0
    for n in g.node:
        if n.op_type != 'Constant':
            continue
        for a in n.attribute:
            if a.name == 'value' and a.t.data_type in (TensorProto.INT64, TensorProto.INT32) and len(a.t.dims) <= 1:
                v = numpy_helper.to_array(a.t)
                if v.size == 1 and int(v.reshape(-1)[0]) == ent_old:
                    a.t.CopyFrom(numpy_helper.from_array(np.full(v.shape, remap[ent_old], dtype=v.dtype), a.t.name))
                    patched += 1
    assert patched == 1, f'class token constant: {patched}'

    W = numpy_helper.to_array(init[EMB])[keep_all]
    g.initializer.remove(init[EMB])
    scale = (np.abs(W).max(axis=1, keepdims=True) / 127.0).astype(np.float32)
    scale[scale == 0] = 1.0
    q = np.clip(np.round(W / scale), -127, 127).astype(np.int8)
    g.initializer.extend([numpy_helper.from_array(q, EMB + '.q'), numpy_helper.from_array(scale, EMB + '.scale')])
    gather = next(n for n in g.node if n.op_type == 'Gather' and n.input[0] == EMB)
    ids, out_name = gather.input[1], gather.output[0]
    at = list(g.node).index(gather)
    g.node.remove(gather)
    for k, n in enumerate([
        helper.make_node('Gather', [EMB + '.q', ids], ['emb_q'], axis=0, name='emb_gather_q'),
        helper.make_node('Cast', ['emb_q'], ['emb_qf'], to=TensorProto.FLOAT, name='emb_cast'),
        helper.make_node('Gather', [EMB + '.scale', ids], ['emb_s'], axis=0, name='emb_gather_s'),
        helper.make_node('Mul', ['emb_qf', 'emb_s'], [out_name], name='emb_dequant'),
    ]):
        g.node.insert(at + k, n)

    init_names = {t.name for t in g.initializer}
    outputs = {o.name for o in g.output}
    alias = {n.output[0]: n.input[0] for n in g.node if n.op_type == 'Identity' and n.input[0] in init_names and n.output[0] not in outputs}
    for n in list(g.node):
        if n.op_type == 'Identity' and n.output[0] in alias:
            g.node.remove(n)
        else:
            for k, i in enumerate(n.input):
                if i in alias:
                    n.input[k] = alias[i]

    # Matrix weights stay 8-bit in memory (MatMulNBits, blocks of 128). Unpacking them to fp32 at
    # load would be faster on one thread but costs about 825 MB instead of 270 MB (docs/MODEL.md).
    qz = MatMulNBitsQuantizer(m, bits=8, block_size=128, is_symmetric=True, accuracy_level=4)
    qz.process()
    m = qz.model.model
    quantized = sum(n.op_type == 'MatMulNBits' for n in m.graph.node)
    assert not any(n.op_type == 'MatMul' and n.input[1] in {t.name for t in m.graph.initializer} for n in m.graph.node)
    print('8-bit matmul weights', quantized)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    # Weights go to a separate file: onnxruntime-web then copies them straight into tensors and
    # never holds a second copy of the whole model in WASM memory, which never shrinks.
    onnx.save_model(m, str(OUT / 'model.onnx'), save_as_external_data=True,
                    all_tensors_to_one_file=True, location='model.data', size_threshold=4096)
    os.chmod(OUT / 'model.data', 0o644)
    (OUT / 'tokenizer.json').write_text(json.dumps(tok, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    meta = {
        'name': 'GLiNER multi PII v1, EN/IT/RU vocabulary, 8-bit weights',
        'base': 'urchade/gliner_multi_pii-v1 (Apache-2.0), ONNX export onnx-community/gliner_multi_pii-v1@2e0397a',
        'labels': LABELS, 'maxWidth': 12, 'vocab': len(keep_all),
    }
    (OUT / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'NOTICE.txt').write_text(
        'Velami name and address model\n\n'
        'Derived from GLiNER multi PII v1 by Urchade Zaratiana and contributors,\n'
        'https://huggingface.co/urchade/gliner_multi_pii-v1, Apache License 2.0,\n'
        'https://www.apache.org/licenses/LICENSE-2.0\n'
        'ONNX export: https://huggingface.co/onnx-community/gliner_multi_pii-v1 (revision 2e0397a)\n'
        'Encoder: microsoft/mdeberta-v3-base, MIT License.\n\n'
        'Changes: vocabulary reduced to tokens seen in English, Italian and Russian text\n'
        '(Leipzig Corpora Collection, token counts only, no text is included), embedding\n'
        'stored as int8 per row, matrix weights as 8-bit blocks (MatMulNBits).\n'
        'Built by tools/model/build_model.py.\n', encoding='utf-8')
    return {f.name: sha256(f) for f in sorted(OUT.iterdir())}


FIXTURE = ROOT / 'test' / 'fixtures' / 'model-tokens.json'
FIXTURE_EXTRA = ['<<ENT>>', '<<SEP>>', 'person', 'address', 'O\u2019Connor', '\ufb01le', '\u2163', '\u65e5\u672c',
                 'x\u0301', 'Ковалёва', 'Ёжиков', 'perché', 'Città', 'naïve', '221B', '№', '—', '«', 'São']


def write_fixture():
    """Эталон для test/ner-core.test.js: как токенизатор Hugging Face режет слова урезанным словарём."""
    import random
    tok = Tokenizer.from_file(str(OUT / 'tokenizer.json'))
    words = set()
    split = re.compile(r'\w+(?:[-_]\w+)*|\S')
    for line in sentences()[::40]:
        words.update(split.findall(line))
    sample = random.Random(7).sample(sorted(words), 3000) + FIXTURE_EXTRA
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps([[w, tok.encode(w, add_special_tokens=False).ids] for w in sample],
                                  ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def main():
    hashes = build()
    write_fixture()
    for k, v in hashes.items():
        print(f'{v}  models/ner/{k}  {os.path.getsize(OUT / k) / 1e6:.1f} MB')
    if '--update' in sys.argv:
        LOCK.write_text(json.dumps(hashes, indent=2) + '\n')
        print('lock updated')
        return
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    if lock != hashes:
        sys.exit('result differs from tools/model/model.lock.json')
    print('matches tools/model/model.lock.json')


if __name__ == '__main__':
    main()
