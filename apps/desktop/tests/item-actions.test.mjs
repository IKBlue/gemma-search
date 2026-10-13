// apps/desktop/tests/item-actions.test.mjs —— P3c 的两块领域判断（纯函数，无需 DOM）
//
// 为什么这两块必须能进 `npm test`：
//   `.jsx` 在 `node:test` 里加载不了（本仓库反复栽在这上面）⇒ 把"索引状态怎么判"
//   与"哪些动作要重编码"塞进组件，就等于放弃自动化。抽成纯函数之后它们才是可断言的。
//
// ⚠️ **IA3 是最要紧的一条**：它拿 `shared/ipc.ts` 里 `mutate` 的 op 白名单，
//    去核对界面上的"这个动作有没有后端"。这样"文档说还没做、其实已经做了"（或反过来）
//    这类漂移会被当场拦住 —— 光靠在注释里写一句话是拦不住的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INDEX_STATES, deriveIndexState, needsScanToDecide } from '../src/renderer/src/utils/index-state.js';
import { ACTION_GROUPS, buildItemActions, groupActions, reencodeBadge } from '../src/renderer/src/utils/item-actions.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 一条"正常在盘上、有压缩包"的 item（形状与契约 §2.2 一致） */
const ITEM = Object.freeze({
  libId: 'L1', uid: 'a00000000001', relPath: 'VR\\VR-101.jpg', folder: 'VR', stem: 'VR-101',
  imageExt: '.jpg', imageSize: 41233, imageMtime: 1760000000000, vectorSource: 'native',
  archive: { relPath: 'VR\\VR-101.rar', ext: '.rar', size: 8911028, mtime: 1759900000000 },
  exists: { image: true, archive: true },
});

// ============================================================ 索引状态四档

test('IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale`', () => {
  // 正常
  assert.equal(deriveIndexState(ITEM).key, 'encoded');
  assert.equal(deriveIndexState(ITEM, { changed: [], missing: [], added: [] }).key, 'encoded');

  // 盘上没了 —— 判据是 exists（权威）
  assert.equal(deriveIndexState({ ...ITEM, exists: { image: false, archive: false } }).key, 'removed');
  // 扫描说 missing（即使 exists 没跟上）也是 removed
  assert.equal(deriveIndexState(ITEM, { missing: [ITEM.uid] }).key, 'removed');
  // ⭐ 顺序：既 missing 又 changed 时必须是 removed（"待重编码"对不存在的文件毫无意义）
  assert.equal(deriveIndexState({ ...ITEM, exists: { image: false } }, { missing: [ITEM.uid], changed: [ITEM.uid] }).key,
    'removed', 'removed 必须优先于 stale —— 判定顺序是有意的');

  // 外部改过
  assert.equal(deriveIndexState(ITEM, { changed: [ITEM.uid] }).key, 'stale');
  // 已发现未编码
  assert.equal(deriveIndexState(ITEM, { added: [ITEM.uid] }).key, 'pending');
  // 没有 item
  assert.equal(deriveIndexState(null).key, 'pending');
  assert.equal(deriveIndexState(undefined).key, 'pending');
});

test('IA1b 四档的文案与提示都在唯一的定义处（不许散落到组件里）', () => {
  for (const k of ['encoded', 'pending', 'stale', 'removed']) {
    assert.ok(INDEX_STATES[k], `缺档位 ${k}`);
    assert.ok(INDEX_STATES[k].label && INDEX_STATES[k].hint, `${k} 必须有 label 与 hint`);
    assert.ok(['ok', 'warn', 'err'].includes(INDEX_STATES[k].tone), `${k} 的 tone 越界：${INDEX_STATES[k].tone}`);
  }
  // 「待重编码」与「待编码」必须是**两个**不同的档（合并它们会丢掉"要重编码"这个关键信息）
  assert.notEqual(INDEX_STATES.stale.label, INDEX_STATES.pending.label);
});

test('IA1c `needsScanToDecide`：能当场判定的不该说"要扫"；盘上没了的也不必扫', () => {
  assert.equal(needsScanToDecide(ITEM), true, '在盘上的条目，要判"是否被外部改过"确实需要一次扫描');
  assert.equal(needsScanToDecide({ ...ITEM, exists: { image: false } }), false, '已 removed 的不需要再扫');
  assert.equal(needsScanToDecide(null), false);
});

// ============================================================ 动作四分区

test('IA2 ⭐ 四分区**永远都在**，且分区名与规格逐字一致（UI-REVIEW:236）', () => {
  const groups = groupActions(buildItemActions({ item: ITEM }));
  assert.deepEqual(groups.map((g) => g.title), [
    '取件', '维护（复用向量）', '维护（需重编码，须提示）', '危险区',
  ], '分区名必须与 UI-REVIEW-and-migration.md:236 一致');
  // 即使某个分区没有动作，分区本身也要出现 —— 少一个分区会让人以为"这个应用没有那类操作"
  const empty = groupActions([]);
  assert.equal(empty.length, 4);
  for (const g of empty) assert.deepEqual(g.actions, []);
  assert.equal(ACTION_GROUPS.length, 4);
});

test('IA2b ⭐ 规格要求「把是否需重编码标在按钮上」—— 每个动作都带这个标志与角标', () => {
  const actions = buildItemActions({ item: ITEM, indexState: INDEX_STATES.stale });
  for (const a of actions) {
    assert.equal(typeof a.needsReencode, 'boolean', `${a.id} 缺 needsReencode`);
    assert.match(reencodeBadge(a), /^(需重编码|不重编码)$/);
  }
  // 规格点名的两类：
  assert.equal(actions.find((a) => a.id === 'rename').needsReencode, false, '改 ID 不重编码');
  assert.equal(actions.find((a) => a.id === 'moveFolder').needsReencode, false, '改目录不重编码');
  assert.equal(actions.find((a) => a.id === 'replaceImage').needsReencode, true, '换图**要**重编码');
  assert.equal(actions.find((a) => a.id === 'reencode').needsReencode, true, '重建向量**要**重编码');
});

test('IA2c `disabled` 为真时 `reason` 必须非空（不能有"点不动又不说为什么"的按钮）', () => {
  const cases = [
    { item: ITEM, indexState: INDEX_STATES.encoded },
    { item: { ...ITEM, exists: { image: false, archive: false } }, indexState: INDEX_STATES.removed },
    { item: { ...ITEM, archive: null }, indexState: INDEX_STATES.encoded },
    { item: null, indexState: null },
  ];
  for (const c of cases) {
    for (const a of buildItemActions(c)) {
      if (a.disabled) assert.ok(a.reason && a.reason.length > 0, `${a.id} 被禁用却没写原因`);
    }
  }
});

test('IA2d 「重新编码」：**需要与否**与**能否点**是两件事（我第一版混为一谈）', () => {
  const act = (state) => buildItemActions({ item: ITEM, indexState: state }).find((a) => a.id === 'reencode');

  // ① 需要与否 —— 领域判断，看状态
  assert.match(act(INDEX_STATES.stale).reason, /需要重编码/, '待重编码时必须明说"需要"');
  for (const s of [INDEX_STATES.encoded, INDEX_STATES.pending, INDEX_STATES.removed]) {
    assert.match(act(s).reason, /当前不需要/, `${s.label} ⇒ 应说"当前不需要"`);
  }

  // ② 能否点 —— 后端能力。契约里**没有"只重建一条"的方法**（只有整库 `indexStart`）
  //    ⇒ 无论什么状态都点不动。第一版我给它标了 `op:'indexStart'`，那会让按钮看起来能用、
  //      实际却启动**整库重建** —— 与按钮文案"重新编码这一条"不符，是误导。
  for (const s of Object.values(INDEX_STATES)) {
    assert.equal(act(s).disabled, true, `${s.label} ⇒ 没有后端方法，必须禁用`);
    assert.equal(act(s).op, null, '不许标成 indexStart（那是整库重建）');
    assert.equal(act(s).unavailable, 'contract-no-method');
  }
});

test('IA2e 盘上没了的条目：取件/改 ID/移出库都不可点（理由都是"文件不在盘上"）', () => {
  const gone = buildItemActions({ item: { ...ITEM, exists: { image: false, archive: false } }, indexState: INDEX_STATES.removed });
  for (const id of ['collect', 'rename', 'moveFolder', 'moveOutOfLibrary']) {
    const a = gone.find((x) => x.id === id);
    assert.equal(a.disabled, true, `${id} 不该可点`);
    assert.match(a.reason, /不在盘上/, `${id} 的理由要说清是"文件不在盘上"`);
  }
  assert.equal(gone.find((a) => a.id === 'reattachArchive').disabled, true);
});

// ============================================================ 与契约交叉核对

test('IA3 ⭐⭐ 界面上的"有没有后端"必须与 `ipc.ts` 的白名单**逐条对上**（防漂移）', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/shared/ipc.ts'), 'utf8');

  // 从契约唯一来源里读出 mutate 的 op 白名单
  const m = ipc.match(/mutate:\s*z\.object\(\{[\s\S]*?op:\s*z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(m, '没从 ipc.ts 里解析出 mutate 的 op 白名单 —— 解析器要跟着 schema 改');
  const ops = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(ops.has('rename') && ops.has('moveOutOfLibrary'), `解析出的 op 集合可疑：${[...ops].join(',')}`);

  // 方法白名单（用来核 `indexStart` / `collect` 这类非 mutate 的动作）
  const methods = new Set(
    [...ipc.matchAll(/^  ([a-zA-Z]+):\s*z\./gm)].map((x) => x[1]),
  );
  assert.ok(methods.has('mutate') && methods.has('indexStart'), `方法白名单解析可疑：${[...methods].join(',')}`);

  for (const a of buildItemActions({ item: ITEM, indexState: INDEX_STATES.stale })) {
    if (a.op === null) {
      // 声称"契约里没有"的动作：必须真的不在任何白名单里
      assert.ok(!ops.has(a.id) && !methods.has(a.id),
        `${a.id} 标了 op:null（"契约里还没有"），但白名单里出现了它 —— 该把它接上了`);
      assert.equal(a.disabled, true, `${a.id} 既然没有后端方法，就必须禁用`);
      assert.match(a.reason, /还没|没有|不支持/, `${a.id} 的 reason 要说清是"没做"，不能含糊`);
      continue;
    }
    const [kind, name] = a.op.includes(':') ? a.op.split(':') : ['method', a.op];
    if (kind === 'mutate') {
      assert.ok(ops.has(name), `动作 ${a.id} 声称走 mutate:${name}，但白名单里没有它`);
    } else {
      assert.ok(methods.has(name), `动作 ${a.id} 声称走方法 ${name}，但白名单里没有它`);
    }
  }
});

test('IA3b 反过来：`mutate` 白名单里的每个 op，界面上都要有对应的动作（或有据不显示）', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/shared/ipc.ts'), 'utf8');
  const m = ipc.match(/op:\s*z\.enum\(\[([^\]]+)\]\)/);
  const ops = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((o) => o !== 'undo');

  const covered = new Set(
    buildItemActions({ item: ITEM, indexState: INDEX_STATES.encoded })
      .filter((a) => a.op && a.op.startsWith('mutate:'))
      .map((a) => a.op.slice('mutate:'.length)),
  );
  for (const op of ops) {
    assert.ok(covered.has(op), `契约支持 mutate:${op}，但详情页没有对应动作 —— 用户看不到这个能力`);
  }
});
