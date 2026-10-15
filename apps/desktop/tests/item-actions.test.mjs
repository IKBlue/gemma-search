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

import {
  INDEX_STATES,
  deriveIndexState,
  needsScanToDecide,
} from '../src/renderer/src/utils/index-state.ts';
import {
  ACTION_GROUPS,
  buildItemActions,
  groupActions,
  reencodeBadge,
} from '../src/renderer/src/utils/item-actions.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 一条"正常在盘上、有压缩包"的 item（形状与契约 §2.2 一致） */
const ITEM = Object.freeze({
  libId: 'L1',
  uid: 'a00000000001',
  relPath: 'VR\\VR-101.jpg',
  folder: 'VR',
  stem: 'VR-101',
  imageExt: '.jpg',
  imageSize: 41233,
  imageMtime: 1760000000000,
  vectorSource: 'native',
  archive: { relPath: 'VR\\VR-101.rar', ext: '.rar', size: 8911028, mtime: 1759900000000 },
  exists: { image: true, archive: true },
});

// ============================================================ 索引状态四档

test('IA1 `deriveIndexState`：四档都能判出来，且 `removed` 优先于 `stale`', () => {
  // 正常
  assert.equal(deriveIndexState(ITEM).key, 'encoded');
  assert.equal(deriveIndexState(ITEM, { changed: [], missing: [], added: [] }).key, 'encoded');

  // 盘上没了 —— 判据是 exists（权威）
  assert.equal(
    deriveIndexState({ ...ITEM, exists: { image: false, archive: false } }).key,
    'removed',
  );
  // 扫描说 missing（即使 exists 没跟上）也是 removed
  assert.equal(deriveIndexState(ITEM, { missing: [ITEM.uid] }).key, 'removed');
  // ⭐ 顺序：既 missing 又 changed 时必须是 removed（"待重编码"对不存在的文件毫无意义）
  assert.equal(
    deriveIndexState(
      { ...ITEM, exists: { image: false } },
      { missing: [ITEM.uid], changed: [ITEM.uid] },
    ).key,
    'removed',
    'removed 必须优先于 stale —— 判定顺序是有意的',
  );

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
    assert.ok(
      ['ok', 'warn', 'err'].includes(INDEX_STATES[k].tone),
      `${k} 的 tone 越界：${INDEX_STATES[k].tone}`,
    );
  }
  // 「待重编码」与「待编码」必须是**两个**不同的档（合并它们会丢掉"要重编码"这个关键信息）
  assert.notEqual(INDEX_STATES.stale.label, INDEX_STATES.pending.label);
});

test('IA1c `needsScanToDecide`：能当场判定的不该说"要扫"；盘上没了的也不必扫', () => {
  assert.equal(needsScanToDecide(ITEM), true, '在盘上的条目，要判"是否被外部改过"确实需要一次扫描');
  assert.equal(
    needsScanToDecide({ ...ITEM, exists: { image: false } }),
    false,
    '已 removed 的不需要再扫',
  );
  assert.equal(needsScanToDecide(null), false);
});

// ============================================================ 动作四分区

test('IA2 ⭐ 四分区**永远都在**，且分区名与规格逐字一致（UI-REVIEW:236）', () => {
  const groups = groupActions(buildItemActions({ item: ITEM }));
  assert.deepEqual(
    groups.map((g) => g.title),
    ['取件', '维护（复用向量）', '维护（需重编码，须提示）', '危险区'],
    '分区名必须与 UI-REVIEW-and-migration.md:236 一致',
  );
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
  assert.equal(
    actions.find((a) => a.id === 'replaceImage').needsReencode,
    true,
    '换图**要**重编码',
  );
  assert.equal(
    actions.find((a) => a.id === 'reencode').needsReencode,
    true,
    '重建向量**要**重编码',
  );
});

test('IA2c `disabled` 为真时 `reason` 必须非空（不能有"点不动又不说为什么"的按钮）', () => {
  const cases = [
    { item: ITEM, indexState: INDEX_STATES.encoded },
    {
      item: { ...ITEM, exists: { image: false, archive: false } },
      indexState: INDEX_STATES.removed,
    },
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
  const act = (state) =>
    buildItemActions({ item: ITEM, indexState: state }).find((a) => a.id === 'reencode');

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

test('IA2e 盘上没了的条目：取件不可点（理由「文件不在盘上」）；改数据那四个一律不可点（理由「等表上线」）', () => {
  // ⚠️ 2026-10-15 · S6：口径变了 —— 原来这四个「改数据」动作是按**领域条件**（盘上在不在、有没有包）决定可点，
  //    因为当时它们背后有 mutate。mutate 已从契约删除 ⇒ 它们现在与盘上状态无关，**永远**不可点，
  //    理由也不该再说是「文件不在盘上」（那是另一回事，会让用户以为：文件回来了就能改）。
  const gone = buildItemActions({
    item: { ...ITEM, exists: { image: false, archive: false } },
    indexState: INDEX_STATES.removed,
  });

  // 取件：仍然由**领域条件**决定（它背后有真方法 collect）
  const collect = gone.find((x) => x.id === 'collect');
  assert.equal(collect.disabled, true, '取件不该可点');
  assert.match(collect.reason, /不在盘上/, '取件的理由要说清是「文件不在盘上」');

  // 改数据那四个：与盘上状态无关，一律「等对应的数据表上线」
  for (const id of ['rename', 'moveFolder', 'reattachArchive', 'moveOutOfLibrary']) {
    const a = gone.find((x) => x.id === id);
    assert.equal(a.disabled, true, `${id} 不该可点`);
    assert.equal(a.op, null, `${id} 不该声称有后端（mutate 已删除）`);
    assert.match(a.reason, /等对应的数据表上线/, `${id} 的理由要指向真实原因（表没建）`);
  }

  // 对照：盘上**在**的条目，取件可点，而改数据那四个仍然不可点（证明不是「一律禁用」蒙对了）
  const here = buildItemActions({ item: ITEM, indexState: INDEX_STATES.encoded });
  assert.equal(here.find((x) => x.id === 'collect').disabled, false);
  for (const id of ['rename', 'moveFolder', 'reattachArchive', 'moveOutOfLibrary']) {
    assert.equal(
      here.find((x) => x.id === id).disabled,
      true,
      `${id} 在盘上也不该可点（没有后端方法）`,
    );
  }
});

// ============================================================ 与契约交叉核对

test('IA3 ⭐⭐ 界面上的「有没有后端」必须与 `ipc.ts` 的白名单**逐条对上**（防漂移）', () => {
  const ipc = fs.readFileSync(path.join(ROOT, 'apps/desktop/src/shared/ipc.ts'), 'utf8');

  // ⚠️ 2026-10-15 · S6：原版从 ipc.ts 解析 **mutate 的 op 白名单** 来核对动作 ——
  //    而 mutate 已按绿地契约 §2.2 **删除**（意图层标注表没建）⇒ 解析器本身失去对象。
  //    改成**通用**核对：动作声称走哪个方法，那个方法就必须在方法白名单里。
  //    （这样比原版更强：契约里任何方法被删掉，只要界面还挂着它，这条就红。）
  // ⚠️ 2026-10-15 · T-09：旧解析器 `/^  (name):\s*z\./` 要求 `z.` 与 `name:` **同行**，
  //    而 Prettier 会把长的 `z.object({...})` 折成
  //        name: z
  //          .object({ ... })
  //    ⇒ 只剩单行条目能匹配（实测 14/20：collect / search / reveal / transactions / libraryAdd … 全丢），
  //      下面的断言随即**误报**（不是契约真的漂移了）。
  //    改成：先切出 `Methods` 对象本身，再取它的**直接属性名** —— 对折行与缩进宽度都不敏感。
  const from = ipc.indexOf('export const Methods');
  const to = ipc.indexOf('export const METHOD_NAMES');
  assert.ok(
    from >= 0 && to > from,
    'ipc.ts 里找不到 Methods / METHOD_NAMES 区段 ⇒ 解析前提变了，本条需要同步',
  );
  const methods = new Set(
    [...ipc.slice(from, to).matchAll(/^ {2}([a-zA-Z]\w*):/gm)].map((x) => x[1]),
  );
  // 解析器自检：真解析到东西才谈得上"逐条对上"（否则下面全是空断言）
  assert.ok(methods.size >= 10, `方法白名单只解析到 ${methods.size} 条，解析器可能已失效`);
  assert.ok(
    methods.has('collect') && methods.has('item'),
    `方法白名单解析可疑：${[...methods].join(',')}`,
  );
  // 已删除的方法**不该**再出现在白名单里（解析器自检，避免它悄悄失效）
  for (const gone of ['mutate', 'indexStart', 'libraryConfig']) {
    assert.ok(!methods.has(gone), `已删除的方法仍被解析到：${gone} —— 解析器或契约有一边不对`);
  }

  for (const a of buildItemActions({ item: ITEM, indexState: INDEX_STATES.stale })) {
    if (a.op === null) {
      // 声称「契约里没有」的动作：必须真的不在方法白名单里
      assert.ok(
        !methods.has(a.id),
        `${a.id} 标了 op:null（契约里还没有），但白名单里出现了它 —— 该把它接上了`,
      );
      assert.equal(a.disabled, true, `${a.id} 既然没有后端方法，就必须禁用`);
      assert.match(
        a.reason,
        /还没|没有|不支持|等对应/,
        `${a.id} 的 reason 要说清是「没做」，不能含糊`,
      );
      continue;
    }
    const [kind, name] = a.op.includes(':') ? a.op.split(':') : ['method', a.op];
    assert.equal(
      kind,
      'method',
      `动作 ${a.id} 还在用 op:${a.op} —— S6 之后动作只该标方法名（mutate 已删除）`,
    );
    assert.ok(methods.has(name), `动作 ${a.id} 声称走方法 ${name}，但白名单里没有它`);
  }
});

test('IA3b ⭐ S6 之后：四个「改数据」动作一律 op:null + 禁用 + 说明（不留假按钮）', () => {
  // 原版 IA3b 是「mutate 白名单里的每个 op 界面都要有入口」—— mutat 被删除后它失去前提。
  // 新口径（Lead 2026-10-15 裁定）：那几个入口改成**诚实态**，而且这条要用断言钉住：
  //   rename / moveFolder / reattachArchive / moveOutOfLibrary 四个动作**不许**再声称有后端。
  const actions = buildItemActions({ item: ITEM, indexState: INDEX_STATES.encoded });
  const byId = Object.fromEntries(actions.map((a) => [a.id, a]));
  for (const id of ['rename', 'moveFolder', 'reattachArchive', 'moveOutOfLibrary']) {
    const a = byId[id];
    assert.ok(a, `动作丢了：${id}（分区与按钮是规格的一部分，不能顺手删）`);
    assert.equal(a.op, null, `${id} 不许再声称有后端方法（mutate 已从契约删除）`);
    assert.equal(a.unavailable, 'contract-no-method', `${id} 要标成「契约里没有」`);
    assert.equal(a.disabled, true, `${id} 必须禁用 —— 假按钮比没有按钮更坏`);
    assert.ok(a.reason && a.reason.length > 0, `${id} 要给一句人话理由`);
  }
  // `collect` 仍有后端（它是保留方法）⇒ 必须**不**被这条误伤
  assert.equal(byId.collect.op, 'collect');
  assert.equal(byId.collect.disabled, false);
});
