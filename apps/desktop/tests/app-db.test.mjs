// apps/desktop/tests/app-db.test.mjs —— S6：应用级 app.db 的 3 张表 + **每张表唯一写入口**
//
// 依据：设计基线 §1.1（字段/约束）· §2.3（每张表的唯一写入口）· schema-layers.ts（落点）。
// 这个文件只碰应用级；库级 3 张表（asset/asset_file/asset_index_state）由 S2 的测试覆盖。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appDbPath,
  deleteCollectDir,
  deleteLibrary,
  getLibrary,
  insertCollectDir,
  insertLibrary,
  listCollectDirs,
  listLibraries,
  openAppDb,
  readAppMeta,
  setDefaultCollectDir,
  updateLibraryEnabled,
  updateLibrarySortOrder,
} from '../src/main/app-db.ts';
import { APP_TABLES, APP_TARGET_SCHEMA_VERSION, openNodeSqlite } from '../src/main/db/index.ts';

/**
 * **模拟 `readBigInts`**：在**真实驱动**的结果上把指定列转成 bigint（值不变、类型变）。
 *
 * 为什么不直接 monkey-patch node:sqlite：那会污染同进程其它测试；而驱动注入本来就是
 * openAppDb / items-ipc 的既有接缝（生产不传）。这样测的是**真实 SQL、真实 DDL、真实行**，
 * 只有"类型"这一项被换掉 —— 正是 DF-2 要覆盖的那个变量。
 */
function bigintColumnsDriver(columns) {
  return (filename, options) => {
    const db = openNodeSqlite(filename, options);
    const conv = (row) => {
      if (!row) return row;
      const out = { ...row };
      for (const c of columns) if (typeof out[c] === 'number') out[c] = BigInt(out[c]);
      return out;
    };
    return {
      exec: (sql) => db.exec(sql),
      close: () => db.close(),
      get isOpen() {
        return db.isOpen;
      },
      prepare: (sql) => {
        const st = db.prepare(sql);
        return {
          run: (...p) => st.run(...p),
          get: (...p) => conv(st.get(...p)),
          all: (...p) => st.all(...p).map(conv),
        };
      },
    };
  };
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = path.join(ROOT, 'data', '_t58', 'app-db-test-' + process.pid);
const NOW = () => 1700000000000;

let app = null;
before(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  app = openAppDb({ userDataDir: TMP, now: NOW });
});
after(() => {
  try {
    if (app) app.close();
  } catch {
    /* 已关 */
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

test('D1 ⭐ 打开即建库：app.db 在 <userData>/app.db，应用级表齐全（清单派生），账本推到目标版本', () => {
  assert.equal(app.dbPath, appDbPath(TMP));
  assert.ok(fs.existsSync(app.dbPath), 'app.db 应当被建出来');
  assert.equal(app.migration.toVersion, APP_TARGET_SCHEMA_VERSION);
  const names = app.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r['name']);
  for (const t of APP_TABLES)
    assert.ok(names.includes(t), '缺表：' + t + '（实得 ' + names.join(',') + '）');
  // B2-6 起多了 app_setting（**只列名字、不写数量**）
  assert.deepEqual([...APP_TABLES].sort(), [
    'app_meta',
    'app_setting',
    'collect_dir',
    'library_registry',
  ]);
  // app_meta 单行 + 版本
  const meta = readAppMeta(app.db);
  assert.equal(meta.schemaVersion, APP_TARGET_SCHEMA_VERSION);
});

test('D2 ⭐ library_registry：登记 → 规范化 root → 重复 root 被 UNIQUE 拦住 → 停用/排序/删除', () => {
  const row = insertLibrary(app.db, { libId: 'L1', root: TMP, displayName: '主库', now: NOW });
  assert.equal(row.libId, 'L1');
  assert.equal(row.root, TMP.replace(/[\\/]+$/, ''), 'root 落库前必须规范化（去尾分隔符等）');
  assert.equal(row.enabled, true, '默认启用');
  assert.equal(row.sortOrder, 0);

  // 同一个 root 再登记一次（换个 libId）⇒ UNIQUE 冲突要**如实抛**
  assert.throws(() =>
    insertLibrary(app.db, { libId: 'L2', root: TMP + path.sep, displayName: '别名', now: NOW }),
  );
  // 同一个 libId 再插 ⇒ PRIMARY KEY 冲突
  assert.throws(() =>
    insertLibrary(app.db, { libId: 'L1', root: path.join(TMP, 'x'), displayName: 'x', now: NOW }),
  );

  assert.equal(updateLibraryEnabled(app.db, 'L1', false, NOW).enabled, false);
  assert.equal(getLibrary(app.db, 'L1').enabled, false, '停用要落库');
  assert.equal(updateLibrarySortOrder(app.db, 'L1', 7, NOW).sortOrder, 7);
  assert.deepEqual(
    listLibraries(app.db).map((l) => l.libId),
    ['L1'],
  );
  assert.equal(deleteLibrary(app.db, 'L1'), true);
  assert.equal(deleteLibrary(app.db, 'L1'), false, '删第二次 = 0 行（不撒谎说删到了）');
  assert.equal(listLibraries(app.db).length, 0);
});

test('D3 ⭐ collect_dir：默认项**只能有一个**（数据库约束，不靠 UI 自觉）', () => {
  const a = insertCollectDir(app.db, {
    absPath: path.join(TMP, 'out-a'),
    label: '待用A',
    makeDefault: true,
    now: NOW,
  });
  assert.equal(a.isDefault, true);
  const b = insertCollectDir(app.db, {
    absPath: path.join(TMP, 'out-b'),
    label: '待用B',
    now: NOW,
  });
  assert.equal(b.isDefault, false);
  assert.equal(listCollectDirs(app.db).filter((d) => d.isDefault).length, 1);
  assert.equal(listCollectDirs(app.db)[0].dirId, a.dirId, '默认项排在最前');

  // 切默认：旧的那条必须被清掉（单事务）
  const c = setDefaultCollectDir(app.db, b.dirId);
  assert.equal(c.dirId, b.dirId);
  const defaults = listCollectDirs(app.db).filter((d) => d.isDefault);
  assert.equal(defaults.length, 1, '永远只有一个默认项');
  assert.equal(defaults[0].dirId, b.dirId);

  // ⚠️ 约束是**数据库级**的：绕过本模块的写入口硬插第二条 default 必须失败
  assert.throws(
    () =>
      app.db
        .prepare(
          'INSERT INTO collect_dir (dir_id, label, abs_path, is_default, created_at_ms) VALUES (?, ?, ?, 1, ?)',
        )
        .run('d-forced', '强行第二条', path.join(TMP, 'out-c'), NOW()),
    /UNIQUE|constraint/i,
    'unique index uniq_collect_default 必须真的在库上（不是靠写入方自觉）',
  );

  assert.equal(
    setDefaultCollectDir(app.db, 'd-不存在'),
    null,
    '不存在的 id ⇒ null（不改动任何行）',
  );
  assert.equal(deleteCollectDir(app.db, b.dirId), true);
  assert.equal(listCollectDirs(app.db).length, 1);
});

test('D4 ⭐⭐ 唯一写入口（静态）：应用级 3 张表只被 app-db.ts / 迁移写', () => {
  const mainDir = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(mainDir);

  /** 谁在这个文件里**字面**写了某张表（DDL 里的 CREATE 不算写数据） */
  const writersOf = (table) =>
    files
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return new RegExp(
          '(INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+' +
            table +
            '\\b)|(UPDATE\\s+' +
            table +
            '\\b)|(DELETE\\s+FROM\\s+' +
            table +
            '\\b)',
          'i',
        ).test(src);
      })
      .map((f) => path.basename(f))
      .sort();

  assert.deepEqual(
    writersOf('library_registry'),
    ['app-db.ts'],
    'library_registry 的写入口只能有 app-db.ts（§2.3：每张表一个写入口）',
  );
  assert.deepEqual(writersOf('collect_dir'), ['app-db.ts'], 'collect_dir 的写入口只能有 app-db.ts');
  // B2-6：设置的写入也收敛在 app-db.ts（§2.3 每张表一个写入口）
  assert.deepEqual(writersOf('app_setting'), ['app-db.ts'], 'app_setting 的写入口只能有 app-db.ts');
  // app_meta 的写入口**只有迁移**（§2.3）—— 迁移账本的读写就在 app-migrations.ts 里，
  // 它是"迁移"这一件事的实现，不算第二个业务写入口（业务侧一律只读：readAppMeta）。
  assert.deepEqual(
    writersOf('app_meta'),
    ['app-migrations.ts'],
    'app_meta 只许迁移写（业务侧只读）',
  );

  // 只读入口也收敛：谁 SELECT 这两张表
  const readers = files
    .filter((f) =>
      /SELECT[\s\S]{0,80}FROM\s+(library_registry|collect_dir|app_setting)/i.test(
        fs.readFileSync(f, 'utf8'),
      ),
    )
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(readers, ['app-db.ts'], '读也只该走 app-db.ts（避免第二份列名/形状定义）');
});

// ============================================================ DF-2：bigint 不许静默变 0

/**
 * 把一个**已打开的连接**包一层：命中的列在 get/all 结果里被换成另一种类型。
 * 用来模拟两件真实可能发生的事：① node:sqlite 开 readBigInts（整数变 bigint）；
 * ② 列类型与 schema 漂移（TEXT 列读回数字）。下层 SQL 与数据都是真的。
 */
function withColumnTypes(db, map) {
  const conv = (row) => {
    if (!row) return row;
    const out = { ...row };
    for (const [col, f] of Object.entries(map)) if (Object.hasOwn(out, col)) out[col] = f(out[col]);
    return out;
  };
  return {
    exec: (s) => db.exec(s),
    close: () => db.close(),
    get isOpen() {
      return db.isOpen;
    },
    prepare: (s) => {
      const st = db.prepare(s);
      return {
        run: (...p) => st.run(...p),
        get: (...p) => conv(st.get(...p)),
        all: (...p) => st.all(...p).map(conv),
      };
    },
  };
}

test('D5 ⭐⭐ readBigInts 模拟：业务列读成 bigint 也**必须正确**（不许变 0）', () => {
  const dir = path.join(TMP, 'bigint');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // 真实库 + 真实 SQL，只把「整数列的类型」换成 bigint（模拟 readBigInts）
  const big = openAppDb({
    userDataDir: dir,
    now: NOW,
    driver: bigintColumnsDriver([
      'enabled',
      'sort_order',
      'registered_at_ms',
      'updated_at_ms',
      'is_default',
    ]),
  });
  try {
    insertLibrary(big.db, { libId: 'L1', root: dir, displayName: '主库', now: NOW });
    assert.equal(
      getLibrary(big.db, 'L1').enabled,
      true,
      'enabled=1 读成 bigint 时要如实 true（旧写法恒 false）',
    );
    assert.equal(getLibrary(big.db, 'L1').sortOrder, 0);
    updateLibraryEnabled(big.db, 'L1', false, NOW);
    assert.equal(getLibrary(big.db, 'L1').enabled, false, 'enabled=0 要如实 false');
    updateLibrarySortOrder(big.db, 'L1', 7, NOW);
    assert.equal(getLibrary(big.db, 'L1').sortOrder, 7, 'sort_order=7 读成 bigint 时不许静默变 0');
    assert.equal(getLibrary(big.db, 'L1').registeredAtMs, NOW(), '时间戳同理');

    // collect_dir 的 is_default 同一类（bigint ⇒ 旧写法静默变 false ⇒ 默认项凭空消失）
    const d1 = insertCollectDir(big.db, {
      absPath: path.join(dir, 'out'),
      label: '待用',
      makeDefault: true,
      now: NOW,
    });
    assert.equal(d1.isDefault, true, 'is_default 读成 bigint 时不许静默变 false');
    assert.equal(setDefaultCollectDir(big.db, d1.dirId).isDefault, true);
    assert.equal(listCollectDirs(big.db).filter((d) => d.isDefault).length, 1);
    // 删除路径：changes 在适配层声明的类型就是 number|bigint ⇒ 必须真的判成「删到了」
    assert.equal(deleteCollectDir(big.db, d1.dirId), true);
    assert.equal(deleteLibrary(big.db, 'L1'), true);
  } finally {
    big.close();
  }
});

test('D5b ⭐⭐ schema_version：业务读**必须正确**；迁移账本遇到 bigint **响亮抛**（两条都不是静默变 0）', () => {
  const dir = path.join(TMP, 'meta');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const app1 = openAppDb({ userDataDir: dir, now: NOW });
  try {
    // (a) 业务读（appMeta IPC 用的就是它）：bigint 下必须读出真版本，**不许变 0**
    const wrapped = withColumnTypes(app1.db, { schema_version: (v) => BigInt(v) });
    const meta = readAppMeta(wrapped);
    assert.equal(
      meta.schemaVersion,
      APP_TARGET_SCHEMA_VERSION,
      'schema_version 读成 bigint 时不许静默变 0',
    );
    assert.equal(meta.createdAtMs, NOW());
  } finally {
    app1.close();
  }

  // (b) 迁移账本（readVersionRow）本来就不接受 bigint ⇒ **抛 META_ROW_MISSING**（响亮，不当成 0）；
  //     这条与 (a) 一起说明：两条路都不会静默把版本读成 0，只是处理方式一个收窄、一个报错。
  const dir2 = path.join(TMP, 'meta2');
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.mkdirSync(dir2, { recursive: true });
  assert.throws(
    () =>
      openAppDb({ userDataDir: dir2, now: NOW, driver: bigintColumnsDriver(['schema_version']) }),
    /META_ROW_MISSING|版本行/,
    '账本读到 bigint 必须响亮抛，而不是当成 0（否则会误判库版本）',
  );
});

test('D7 ⭐ 适配层钉住：openNodeSqlite 读出的 INTEGER 是 **number**（DF-2：readBigInts 显式关闭）', () => {
  const dir = path.join(TMP, 'types');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const a = openAppDb({ userDataDir: dir, now: NOW });
  try {
    insertLibrary(a.db, { libId: 'L1', root: dir, displayName: 'x', now: NOW });
    const raw = a.db
      .prepare('SELECT enabled, sort_order FROM library_registry WHERE lib_id = ?')
      .get('L1');
    assert.equal(
      typeof raw.enabled,
      'number',
      'DF-2：适配层显式 readBigInts:false ⇒ INTEGER 必须读成 number（不是 bigint）',
    );
    assert.equal(typeof raw.sort_order, 'number');
    const run = a.db
      .prepare('UPDATE library_registry SET sort_order = 1 WHERE lib_id = ?')
      .run('L1');
    assert.equal(
      typeof run.changes,
      'number',
      'changes 也要是 number（SqlRunResult 的 number|bigint 只是照抄上游类型）',
    );
    assert.equal(raw.enabled, 1, '对照：值本身没被改');
  } finally {
    a.close();
  }
});
test('D6 ⭐⭐ 类型不对 / 越界 / flag 越界 ⇒ **抛**（不猜、不静默给 0）', () => {
  const dir = path.join(TMP, 'bad');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const bad = openAppDb({ userDataDir: dir, now: NOW });
  try {
    insertLibrary(bad.db, { libId: 'L1', root: dir, displayName: 'x', now: NOW });

    // ① flag 越界：enabled=7（DDL 有 CHECK，只有外部工具改过才会出现）⇒ 抛，不许静默 false
    bad.db.exec('PRAGMA ignore_check_constraints = ON'); // 绕过 DDL 的 CHECK，制造脏数据
    bad.db.prepare('UPDATE library_registry SET enabled = 7 WHERE lib_id = ?').run('L1');
    assert.throws(
      () => listLibraries(bad.db),
      /0\/1|UNEXPECTED_SQL_VALUE/,
      'enabled=7 必须抛（静默 false = 库被悄悄停用）',
    );
    bad.db.prepare('UPDATE library_registry SET enabled = 1 WHERE lib_id = ?').run('L1');
    assert.equal(listLibraries(bad.db).length, 1, '修回 0/1 后必须能读（证明上面那条不是恒真）');

    // ② TEXT 列读回整数 ⇒ 抛（不许静默变空串）
    assert.throws(
      () => listLibraries(withColumnTypes(bad.db, { display_name: () => 42 })),
      /string|UNEXPECTED_SQL_VALUE/,
      'TEXT 列读出整数必须抛',
    );
    assert.equal(listLibraries(bad.db).length, 1, '不换类型时必须正常（对照）');

    // ③ 超安全整数的 bigint（例如被写成 2^63）⇒ 抛，不许截断成错的数
    assert.throws(
      () => listLibraries(withColumnTypes(bad.db, { sort_order: () => 2n ** 63n })),
      /安全整数|UNEXPECTED_SQL_VALUE/,
      '2^63 的 bigint 必须抛，不许截断',
    );
  } finally {
    bad.close();
  }
});
