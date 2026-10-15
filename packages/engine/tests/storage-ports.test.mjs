// packages/engine/tests/storage-ports.test.mjs —— T-16a：存储端口的两条分支（注入 / 不注入）
//
// 这组用例的判据是**行为等价**：同一份库、同一批请求，
//   · 不注入端口 ⇒ 走旧布局（与改造前逐字一致）
//   · 注入端口   ⇒ 走端口（新布局：`.gs-*` 在库根）
// 两者的可观测结果必须一致；**只有**「新布局才有的如实信息」允许不同（storage 块 / failed=null）。
//
// ⚠️ 端口实现刻意**只用 node 内置**，模拟 main 侧 T-16b 的组装方式（不 import 引擎内部东西也能实现）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, indexPathFor } from '../src/engine.ts';
import { readIndexBin } from '../src/index.ts';
import { ERR, USER_MESSAGE, fail } from '../src/errors.ts';
import { writeIndexFixture, makeLibrary, fakeEncoder } from './helpers/lib-fixture.mjs';

/** 造一个 node 错误（带 code —— 引擎按 code 分类，不按 message） */
function coded(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** 同一份库 + 同一份索引：旧布局放在 `<data>/libraries/L1/`，新布局再拷一份到**库根** */
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-ports-'));
  const libRoot = path.join(tmp, 'lib');
  const made = makeLibrary();
  fs.cpSync(made.root, libRoot, { recursive: true });
  const dataDir = path.join(tmp, 'data');
  const legacyIdxDir = indexPathFor(dataDir, 'L1');
  const fx = writeIndexFixture(legacyIdxDir, 'L1', made.rows, { libRoot });
  // 新布局：同一份字节落**库根**（`.gs-index.bin`）
  fs.writeFileSync(path.join(libRoot, '.gs-index.bin'), fx.indexBuffer);
  const config = {
    libraries: [{ libId: 'L1', root: libRoot, label: '测试库' }],
    data_dir: dataDir,
  };
  return { tmp, libRoot, dataDir, legacyIdxDir, fx, config, rows: made.rows };
}

/** 端口包（模拟 main 侧实现）。spies 用来证明**端口真的被走到** */
function makePorts({ libRoot, items, spies = {}, readIndex = null }) {
  const layout = {
    root: libRoot,
    indexPath: path.join(libRoot, '.gs-index.bin'),
    dbPath: path.join(libRoot, '.gs.db'),
    journalPath: path.join(libRoot, '.gs-journal'),
  };
  return {
    libraries: {
      list() {
        spies.list = (spies.list || 0) + 1;
        return [{ libId: 'L1', label: '测试库', root: libRoot }];
      },
      has: (id) => id === 'L1',
      get(id) {
        if (id !== 'L1') throw fail(ERR.LIB_NOT_FOUND, '库未注册：' + id);
        return { libId: 'L1', label: '测试库', root: libRoot };
      },
      requireExistingRoot(id) {
        // 端口**按契约抛引擎错误** ⇒ 信封里也保得住 code（见 storage-ports.ts 的说明）
        if (id !== 'L1') throw fail(ERR.LIB_NOT_FOUND, '库未注册：' + id);
        if (!fs.existsSync(libRoot)) throw fail(ERR.LIB_ROOT_MISSING, '库根不存在：' + libRoot);
      },
      storageOf: (id) => layout,
    },
    items: {
      listItems(id) {
        spies.listItems = (spies.listItems || 0) + 1;
        return items.filter((i) => i.libId === id);
      },
      getItem(id, uid) {
        spies.getItem = (spies.getItem || 0) + 1;
        return items.find((i) => i.libId === id && i.uid === uid) || null;
      },
    },
    index: {
      readIndex(id) {
        spies.readIndex = (spies.readIndex || 0) + 1;
        if (readIndex) return readIndex(id);
        return readIndexBin(layout.indexPath);
      },
    },
  };
}

const engineLegacy = (s, extra = {}) =>
  createEngine({ config: s.config, encoder: fakeEncoder(), ...extra });
const enginePorts = (s, ports, extra = {}) =>
  createEngine({ config: s.config, encoder: fakeEncoder(), storage: ports, ...extra });

// ─────────────────────────────────────────── 不注入：旧路径（形状与行为逐字不变）

test('T16-P1 ⭐ 不注入端口 ⇒ 走旧布局：正常出结果，且**返回形状里没有 storage 块**（改造前逐字一致）', async () => {
  const s = setup();
  const e = engineLegacy(s);
  const st = await e.indexStatus();
  assert.equal(st.ok, true, JSON.stringify(st.error));
  const row = st.data.libs[0];
  assert.equal(row.indexed, 4);
  assert.equal(row.encoded, 4);
  assert.equal(row.healthy, true, JSON.stringify(row.problems));
  assert.equal(
    Object.prototype.hasOwnProperty.call(row, 'storage'),
    false,
    '旧布局不得多出 storage 块',
  );
  assert.equal(typeof row.failed, 'number', '旧布局的 failed 仍是数字（meta.json 的台账）');
  assert.equal(row.failed, 0);

  const r = await e.search({ mode: 'text', text: '任意', topK: 10 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.results.length, 4);
});

// ─────────────────────────────────────────── 注入：走端口（新布局）

test('T16-P2 ⭐⭐ 注入端口 ⇒ 真的走端口（spies 证明），且检索/条目/扫描结果与旧路径**逐字等价**', async () => {
  const s = setup();
  const spies = {};
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items, spies });
  const legacy = engineLegacy(s);
  const wired = enginePorts(s, ports);

  const a = await legacy.search({ mode: 'text', text: '任意', topK: 10 });
  const b = await wired.search({ mode: 'text', text: '任意', topK: 10 });
  assert.equal(b.ok, true, JSON.stringify(b.error));
  // tookMs 天然不同（真实计时）⇒ 只比可复现的部分
  assert.deepEqual(b.data.results, a.data.results, '检索结果必须逐字等价');
  assert.deepEqual(b.data.libsUsed, a.data.libsUsed);
  assert.deepEqual(b.data.libsSkipped, a.data.libsSkipped);

  const uid = a.data.results[0].uid;
  const ia = await legacy.item({ libId: 'L1', uid });
  const ib = await wired.item({ libId: 'L1', uid });
  assert.deepEqual(ib.data, ia.data, 'item 结果必须逐字等价');
  assert.deepEqual(
    (await wired.itemPaths({ libId: 'L1', uid })).data,
    (await legacy.itemPaths({ libId: 'L1', uid })).data,
  );
  assert.deepEqual(
    (await wired.scan({ libId: 'L1' })).data,
    (await legacy.scan({ libId: 'L1' })).data,
    'scan 结果必须逐字等价',
  );

  assert.ok(spies.readIndex >= 1, '向量索引端口必须被走到');
  assert.ok(spies.listItems >= 1, '条目端口必须被走到');
  assert.ok(spies.getItem >= 1, '按 uid 取条目必须走 getItem 端口');
});

test('T16-P3 ⭐⭐ 新布局如实反映：storage 块给出库根落点与存在性；failed 报 null（未知）而不是 0', async () => {
  const s = setup();
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
  const e = enginePorts(s, ports);
  const st = await e.indexStatus();
  const row = st.data.libs[0];
  assert.ok(row.storage, '注入库解析端口后必须给出 storage 块');
  assert.equal(row.storage.layout, 'library-root');
  assert.equal(row.storage.root, s.libRoot);
  assert.equal(row.storage.indexPath, path.join(s.libRoot, '.gs-index.bin'));
  assert.equal(row.storage.dbPath, path.join(s.libRoot, '.gs.db'));
  assert.equal(row.storage.journalPath, path.join(s.libRoot, '.gs-journal'));
  assert.equal(row.storage.indexExists, true, '我们把索引写进了库根');
  assert.equal(row.storage.dbExists, false, '本夹具没有 .gs.db ⇒ 如实报 false');
  assert.equal(row.failed, null, '新布局没有那份台账 ⇒ 报「未知」，不用 0 假绿');
  assert.equal(row.healthy, true);
  assert.equal(row.indexed, 4);
  assert.equal(row.encoded, 4);
});

test('T16-P4 ⭐⭐ 索引缺失 ⇒ problems 里带 INDEX_MISSING 与具体路径理由，绝不假绿', async () => {
  const s = setup();
  const idxPath = path.join(s.libRoot, '.gs-index.bin');
  const ports = makePorts({
    libRoot: s.libRoot,
    items: s.fx.items,
    readIndex: () => {
      throw fail(ERR.INDEX_MISSING, '索引不存在：' + idxPath);
    },
  });
  const e = enginePorts(s, ports);
  const st = await e.indexStatus();
  const row = st.data.libs[0];
  assert.equal(row.healthy, false, '读不到索引不许报 healthy');
  assert.equal(row.problems.length, 1);
  assert.equal(row.problems[0].code, 'INDEX_MISSING');
  assert.ok(
    row.problems[0].message.includes('.gs-index.bin'),
    '理由里要出现具体落点：' + row.problems[0].message,
  );
  assert.equal(row.indexed, 0);
  assert.equal(
    row.storage.indexExists,
    true,
    'storage 是如实快照（文件确实在），与「端口读不到」是两件事',
  );

  const r = await e.search({ mode: 'text', text: '任意' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INDEX_MISSING', '检索把不可用的库如实报出来');
});

test('T16-P5 条目端口抛错 ⇒ 同样给明确理由（不吞、不假成功）', async () => {
  const s = setup();
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
  ports.items.listItems = () => {
    throw coded('INTERNAL', 'sqlite 打不开：' + path.join(s.libRoot, '.gs.db'));
  };
  const e = enginePorts(s, ports);
  const st = await e.indexStatus();
  const row = st.data.libs[0];
  assert.equal(row.healthy, false);
  assert.equal(row.problems[0].code, 'INTERNAL');
  assert.ok(row.problems[0].message.includes('.gs.db'));
});

test('T16-P6 未知 uid ⇒ UID_NOT_FOUND 信封（端口返回 null 时引擎自己转码）', async () => {
  const s = setup();
  const spies = {};
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items, spies });
  const e = enginePorts(s, ports);
  const r = await e.item({ libId: 'L1', uid: '不存在000000' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UID_NOT_FOUND');
  assert.ok(spies.getItem >= 1, '确实问了端口');
});

test('T16-P7 ⭐⭐ 新布局下 scan 不得把库内产物（.gs-index.bin / .gs.db 家族 / staging）当成新素材', async () => {
  const s = setup();
  // 新布局的真实形态：索引与元数据就躺在**库根**里
  fs.writeFileSync(path.join(s.libRoot, '.gs.db'), 'not-a-real-db');
  fs.mkdirSync(path.join(s.libRoot, '.gs-staging', 'txnX'), { recursive: true });
  fs.writeFileSync(path.join(s.libRoot, '.gs-staging', 'txnX', 'ID-1.jpg'), 'x');
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
  const e = enginePorts(s, ports);
  const r = await e.scan({ libId: 'L1' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const newRels = r.data.new.map((x) => x.relPath.split(path.sep).join('/'));
  // ① 库内产物与隐藏项**一个都不许**出现在 new 里（新布局下 .gs-* 就在库根）
  const dotted = newRels.filter((rel) => rel.split('/').some((seg) => seg.startsWith('.')));
  assert.deepEqual(dotted, [], '库内产物/隐藏项不是素材；实得 ' + JSON.stringify(dotted));
  // ② 如实钉住**既有**行为：items 只登记图 ⇒ 压缩包本来就会出现在 new（改造前如此，T-16a 不改它）
  assert.deepEqual(
    newRels.slice().sort(),
    ['CR/c.zip', 'CR/d.7z', 'VR/a.rar'].sort(),
    '压缩包出现在 new 是既有行为（已上报）；这里把它钉住，免得被当成 T-16a 的产物',
  );
  assert.deepEqual(r.data.changed, []);
  assert.deepEqual(r.data.missing, []);
});

test('T16-P8 库解析端口也管「有哪些库」：未注册的 libId ⇒ 明确错误码', async () => {
  const s = setup();
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
  const e = enginePorts(s, ports);
  const r = await e.scan({ libId: 'L9' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'LIB_NOT_FOUND');
});

// ─────────────────────────────────────────── T-45：导入 / 重建一族（引擎码空间）

/** T-45 新增的一族（顺序与 SPEC §5 的清单一致） */
const IMPORT_CODES = [
  'IMPORT_FAILED',
  'IMPORT_INPUT_INVALID',
  'IMPORT_SOURCE_INVALID',
  'IMPORT_INDEX_UNREADABLE',
  'IMPORT_RECORD_INVALID',
  'IMPORT_DUPLICATE_UID',
  'IMPORT_COUNT_MISMATCH',
];

test('T45-E1 ⭐⭐ 任意 IMPORT_* 经**引擎端口**抛进信封 ⇒ 原样带出，绝不变成 INDEX_CORRUPT', async () => {
  const s = setup();
  for (const code of IMPORT_CODES) {
    assert.equal(ERR[code], code, code + ' 必须在冻结的 ERR 里（SPEC §5：新增=兼容）');
    const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
    ports.items.getItem = () => {
      throw fail(code, '模拟：.gs.db 行不合法');
    };
    ports.items.listItems = () => {
      throw fail(code, '模拟：.gs.db 行不合法');
    };
    const e = enginePorts(s, ports);

    const r = await e.item({ libId: 'L1', uid: s.fx.items[0].uid });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, code, 'item 信封：' + code + ' 必须原样带出，实得 ' + r.error.code);
    assert.notEqual(r.error.code, ERR.INDEX_CORRUPT, code + ' 不许被说成索引损坏（假因果）');
    assert.notEqual(r.error.code, ERR.INTERNAL, code + ' 不许被吞成 INTERNAL');
    assert.ok(
      r.error.userMessage && r.error.userMessage.length > 0,
      code + ' 的 userMessage 必须非空',
    );

    const st = await e.indexStatus();
    assert.equal(
      st.data.libs[0].problems[0].code,
      code,
      'indexStatus 的 problems[].code 也必须如实',
    );
  }
});

test('S7a-E1 ⭐⭐ DB_OPEN_FAILED 经**引擎端口**抛出 ⇒ 原样带出（不依赖 main 的映射表）', async () => {
  const s = setup();
  const ports = makePorts({ libRoot: s.libRoot, items: s.fx.items });
  ports.items.getItem = () => {
    throw fail(ERR.DB_OPEN_FAILED, '模拟：.gs.db 打不开');
  };
  ports.items.listItems = () => {
    throw fail(ERR.DB_OPEN_FAILED, '模拟：.gs.db 打不开');
  };
  const e = enginePorts(s, ports);

  const r = await e.item({ libId: 'L1', uid: s.fx.items[0].uid });
  assert.equal(r.ok, false);
  assert.equal(
    r.error.code,
    'DB_OPEN_FAILED',
    'item 信封必须原样带出 DB_OPEN_FAILED，实得 ' + r.error.code,
  );
  assert.notEqual(
    r.error.code,
    ERR.INDEX_CORRUPT,
    '库坏 ≠ 索引坏（SPEC §5.2：不得归成 INDEX_CORRUPT）',
  );
  assert.notEqual(r.error.code, ERR.INTERNAL, '不许被吞成 INTERNAL');
  assert.ok(r.error.userMessage && r.error.userMessage.length > 0, 'userMessage 必须非空');
  assert.notEqual(
    r.error.userMessage,
    USER_MESSAGE[ERR.INDEX_CORRUPT],
    '文案也不许说成"索引文件已损坏"',
  );

  const st = await e.indexStatus();
  assert.equal(
    st.data.libs[0].problems[0].code,
    'DB_OPEN_FAILED',
    'indexStatus 的 problems[].code 也必须如实',
  );
});
test('T45-E2 每个 IMPORT_* 都有**自己的**用户文案（不冒充"索引损坏"、不含绝对路径）', () => {
  const corruptMsg = USER_MESSAGE[ERR.INDEX_CORRUPT];
  for (const code of IMPORT_CODES) {
    const msg = USER_MESSAGE[code];
    assert.ok(typeof msg === 'string' && msg.length > 0, code + ' 缺 userMessage');
    assert.notEqual(msg, corruptMsg, code + ' 的文案不许等于 INDEX_CORRUPT 的文案');
    assert.ok(!msg.includes('索引文件已损坏'), code + ' 的文案不许说"索引文件已损坏"');
    assert.ok(!/[A-Za-z]:\\/.test(msg), code + ' 的文案含绝对路径');
  }
});
