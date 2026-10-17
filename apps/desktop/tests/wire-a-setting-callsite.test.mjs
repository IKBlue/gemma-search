// apps/desktop/tests/wire-a-setting-callsite.test.mjs —— WIRE-A：用户设置**库优先**的调用点
//
// 要证的四件事：
//   W1 **划分是显式的**：引导键（启动早期、app.db 之前）与用户设置（库优先）两份清单互斥且可判定；
//   W2 ⭐ **库优先**：库里有的键，**即使旧 config.json 也有同键**，也以库为准；
//   W3 旧文件是**只读回退**：库里没有 ⇒ 用旧文件；都没有 ⇒ missing（不编默认值）；
//   W4 ⭐ **不回写**：解析之后 config.json **逐字节不变**、库里也不会多出回退键
//      （回写会让用户删掉的键被旧文件复活）；
//   W5 ⭐ **守卫**：把**引导键**当用户设置解析 ⇒ 直接抛（不许把启动链条写成环）；
//   W6 ⭐ **接线**：index.ts 的 device 调用点真的走 resolveUserSetting（改回只读旧文件 ⇒ 本用例必红）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getSetting, listSettings, openAppDb, writeSetting } from '../src/main/app-db.ts';
import {
  BOOTSTRAP_CONFIG_KEYS,
  USER_SETTING_KEYS,
  isBootstrapConfigKey,
  isUserSettingKey,
  resolveUserSetting,
} from '../src/main/library-config.ts';
import { maskComments } from './helpers/source-scan.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INDEX_TS = path.join(ROOT, 'apps', 'desktop', 'src', 'main', 'index.ts');
const TMP = path.join(ROOT, 'data', '_wireA', 'setting-' + process.pid);
const T0 = 1700000000000;

let seq = 0;
function freshUserData(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

// ============================================================ W1 划分

test('W1：引导键与用户设置是**两份显式清单** —— 互斥、可判定、且不许有重叠', () => {
  assert.ok(BOOTSTRAP_CONFIG_KEYS.length >= 1, '引导键清单不许为空');
  assert.ok(USER_SETTING_KEYS.length >= 1, '用户设置清单不许为空');
  const overlap = BOOTSTRAP_CONFIG_KEYS.filter((k) => isUserSettingKey(k));
  assert.deepEqual(overlap, [], '同一个键不能既是引导键又是用户设置（那会让"读库才能读库"）');
  for (const k of BOOTSTRAP_CONFIG_KEYS) {
    assert.equal(isBootstrapConfigKey(k), true);
    assert.equal(isUserSettingKey(k), false);
  }
  for (const k of USER_SETTING_KEYS) {
    assert.equal(isUserSettingKey(k), true);
    assert.equal(isBootstrapConfigKey(k), false);
  }
  // 引导键里必须包含"启动早期就要用"的那几个（库根 / 模型目录类）——写死在这里，防止有人偷偷把它们挪走
  for (const k of ['data_dir', 'library_root', 'onnx_model_dir', 'model_cache']) {
    assert.equal(isBootstrapConfigKey(k), true, k + ' 必须是引导键（app.db 之前就要读）');
  }
});

// ============================================================ W2 库优先

test('W2 ⭐ 库优先：库里有的键，即使旧 config.json 有同键，也以库为准', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('W2'), now: () => T0 });
  try {
    const legacy = { device: 'webgpu' }; // 旧文件说 webgpu
    writeSetting(db, 'device', 'cpu', () => T0 + 1); // 库里说 cpu
    assert.deepEqual(resolveUserSetting(db, 'device', legacy), {
      key: 'device',
      value: 'cpu',
      source: 'db',
    });
  } finally {
    db.close();
  }
});

// ============================================================ W3 只读回退

test('W3：库里没有 ⇒ 旧文件回退；两侧都没有 ⇒ missing（不编默认值）', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('W3'), now: () => T0 });
  try {
    assert.deepEqual(resolveUserSetting(db, 'device', { device: 'cpu' }), {
      key: 'device',
      value: 'cpu',
      source: 'legacy',
    });
    assert.deepEqual(resolveUserSetting(db, 'device', null), {
      key: 'device',
      value: undefined,
      source: 'missing',
    });
    assert.deepEqual(resolveUserSetting(db, 'device', {}), {
      key: 'device',
      value: undefined,
      source: 'missing',
    });
  } finally {
    db.close();
  }
});

// ============================================================ W4 不回写

test('W4 ⭐ 不回写：解析之后 config.json 逐字节不变，库里也不会多出回退键', () => {
  const userData = freshUserData('W4');
  const cfgPath = path.join(userData, 'config.json');
  const cfgText = JSON.stringify({ device: 'webgpu', onnx_model_dir: 'D:/models' }, null, 2) + '\n';
  fs.writeFileSync(cfgPath, cfgText, 'utf8');
  const legacy = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  const { db } = openAppDb({ userDataDir: userData, now: () => T0 });
  try {
    // ① 库里没有 ⇒ 回退旧文件；**回退不许顺手写库**
    assert.equal(resolveUserSetting(db, 'device', legacy).source, 'legacy');
    assert.equal(getSetting(db, 'device'), null, '回退值不许写进库（否则删除会被旧文件复活）');
    assert.deepEqual(listSettings(db), [], '解析是只读的：库里一条都不该多出来');

    // ② 库里**有**（和旧文件不同）⇒ 解析用库，但**绝不回写 config.json**
    writeSetting(db, 'device', 'cpu', () => T0 + 1);
    assert.equal(resolveUserSetting(db, 'device', legacy).value, 'cpu');
    const afterText = fs.readFileSync(cfgPath, 'utf8');
    assert.equal(afterText, cfgText, 'config.json 必须逐字节不变（回写会让用户删掉的键复活）');
    assert.equal(JSON.parse(afterText).device, 'webgpu', '旧文件里的旧值不该被库值覆盖');
  } finally {
    db.close();
  }
});

// ============================================================ W5 引导键守卫

test('W5 ⭐ 把**引导键**当用户设置解析 ⇒ 直接抛（不许把启动链条写成环）', () => {
  const { db } = openAppDb({ userDataDir: freshUserData('W5'), now: () => T0 });
  try {
    for (const bootKey of ['data_dir', 'library_root', 'onnx_model_dir', 'model_cache']) {
      assert.throws(
        () => resolveUserSetting(db, bootKey, { [bootKey]: 'x' }),
        (e) => e instanceof Error && /引导键/.test(e.message) && e.message.includes(bootKey),
        bootKey + ' 是引导键，必须被守卫挡住',
      );
    }
  } finally {
    db.close();
  }
});

// ============================================================ W6 接线（源码扫描）

test('W6 ⭐ 接线：index.ts 的 device 调用点走 resolveUserSetting；引导键**没**被误切', () => {
  const code = maskComments(fs.readFileSync(INDEX_TS, 'utf8'));
  // ① device 必须经 resolveUserSetting 解析（库里优先）
  assert.ok(
    /resolveUserSetting\(\s*appDb,\s*'device'/.test(code),
    "index.ts 必须用 resolveUserSetting(appDb, 'device', …) 解析 device",
  );
  // ② 不许再出现"只读旧文件"的 device 取值（这就是 WIRE-A 要堵的那个回退）
  assert.equal(
    /config\.device\s*\|\|/.test(code),
    false,
    'device 不许再直接取自 config.json（库优先；旧文件只做只读回退）',
  );
  // ③ 来源要可观测（排障时能一眼看出库/旧文件/缺省）
  assert.ok(/\[设置\] device：来源/.test(code), '解析来源必须落一行日志（不静默）');
  // ④ 引导键**仍然**直接读旧文件（没有被误切成库优先）
  assert.ok(/config\.onnx_model_dir/.test(code), 'onnx_model_dir 是引导键：仍应从旧文件读');
  assert.ok(/config\.data_dir/.test(code), 'data_dir 是引导键：仍应从旧文件读');
});
