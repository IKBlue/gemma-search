// apps/desktop/tests/encoder-call-site.test.mjs —— 编码路径的**接线断言**（2026-10-14 事故回归）
//
// 为什么需要一条"读源码"的断言，而不是跑真编码：
//   真编码需要 ONNX 模型（约 1.7 GB）+ 索引，跑不进 npm test；于是这条路径在单测里**完全没有覆盖**。
//   而它的失败模式恰好是最坏的：**静默**。2026-10-14 就真出过一次 ——
//   W2-MAIN 把 main/encoder.mjs 转 .ts 时，两处
//       const emb = pickEmbedding(await model.forward(inputs));
//   被写成
//       const emb = pickEmbedding(inputs);
//   后果：喂给 pickEmbedding 的是**处理器输出**（input_ids/attention_mask/…）而不是模型输出，
//   于是 encodeText / encodeImage **每次调用都抛**「输出里既无 sentence_embedding 也无 last_hidden_state」。
//   而当时的所有门禁都看不出问题：
//     · npm test —— 不加载 encoder（需要模型）
//     · npm run build —— 只证明能打包
//     · npm run e2e —— 跑的是**模拟模式**（GEMMA_FAKE=1，fixtures 数据），根本不编码
//   是 indexer-migrator 独立复刻护栏时抓到的。这说明"接线正确"必须单独有一条机械断言。
//
// 另一条同源事故：护栏 tools/verify_encoder_path.mjs 里写死了
//   import(... 'apps/desktop/src/main/encoder.mjs')
// 文件改名后**护栏自己先炸**（ERR_MODULE_NOT_FOUND），于是"改编码路径必须重跑护栏"这条纪律
// 在关键时刻失效。这里一并钉住护栏的 import 目标，避免它再次悄悄指向不存在的文件。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ENCODER = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'encoder.ts')
const GUARD = path.join(ROOT, 'tools', 'verify_encoder_path.mjs')

test('E-1 ⭐ 编码路径必须把**模型输出**喂给 pickEmbedding（两处调用点都要）', () => {
  const src = fs.readFileSync(ENCODER, 'utf8')

  // 正常形态：pickEmbedding(await model.forward(inputs))
  const good = [...src.matchAll(/pickEmbedding\(await model\.forward\(inputs\)\)/g)]
  assert.ok(good.length >= 2,
    `encoder.ts 里应有 ≥2 处 pickEmbedding(await model.forward(inputs))（encodeText 与 encodeImage），实得 ${good.length}`)

  // 事故形态：漏掉 await model.forward ⇒ 传进去的是处理器输出
  assert.doesNotMatch(src, /pickEmbedding\(inputs\)/,
    '不许出现 pickEmbedding(inputs)：那会把处理器输出当成模型输出，运行时**每次都抛**（见本文件头注释）')
})

test('E-2 ⭐ 护栏必须指向真实存在的 encoder 源文件（改名后不许悄悄失效）', () => {
  const guard = fs.readFileSync(GUARD, 'utf8')
  const m = guard.match(/main',\s*'(encoder\.[a-z]+)'/)
  assert.ok(m, '护栏里应能找到 encoder 源文件的引用；找不到说明写法变了，这条断言需要同步')
  const target = path.join(ROOT, 'apps', 'desktop', 'src', 'main', m[1])
  assert.ok(fs.existsSync(target),
    `护栏引用的 ${m[1]} 不存在 —— "改编码路径必须重跑护栏"这条纪律会因为护栏自己先炸而失效`)
})
