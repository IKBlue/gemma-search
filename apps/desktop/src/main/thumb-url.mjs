// apps/desktop/src/main/thumb-url.mjs —— `thumb://` 的形状解析与尺寸白名单
//
// 为什么单独成模块（这是 SPEC-security §8 的 S4–S6）：
// `main/index.mjs` import 了 `electron`，`node:test` 加载不了它 ⇒ 这个协议处理器
// 在写这份文件之前**零自动化覆盖**。而它是渲染进程唯一能"指定读哪个文件"的表面，
// 恰恰最该被测。抽出来的先例是 `main/ports.mjs` 与 `main/library-config.mjs`。
//
// ⚠️ **本模块的安全属性（三条，都必须能测）**：
//   1. **纯函数，不碰文件系统**。它只做"形状 + 白名单"判定。
//      路径是由「注册表 + 索引」反查出来的，**绝不从 URL 取** —— 见 SPEC-security §3。
//      所以 `thumb://../../windows/win.ini` 在**这一层**就被拒，且**没有发生过任何读取**
//      （测试用注入的假 fs 计数器证明，不是靠状态码推断）。
//   2. **尺寸只能来自白名单**（§8 的 S5）。`@999` 直接 400，不进入下游。
//   3. **库必须先被还原成引擎里的写法**（§8 的 S6）。
//      URL 的 host **一律小写**（URL 规范），而引擎的 libId 大小写敏感（`L1`）——
//      这一步不做，`thumb://L1/…` 会变成 `l1`、引擎回 LIB_NOT_FOUND、界面全是"无预览"
//      （实测记录见 `main/index.mjs` 原注释）。未注册的库 ⇒ 无法还原 ⇒ 404。

/** 允许的缩略图边长。**唯一白名单**；不在其中的一律拒。 */
export const ALLOWED_SIZE = new Set([128, 256, 512]);

/** 形状：`/<uid>@<size>`，uid 与引擎 uid 同形（12 位小写 hex） */
const SHAPE_RE = /^\/([0-9a-f]{12})@(\d+)$/;

/**
 * 解析 `thumb://` 请求的**形状**。
 *
 * ⚠️ **`io` 参数能证明什么、不能证明什么（如实写，别夸大）**：
 * 它只能发现"沿着这个参数发生的读取"。测试传入计数假 fs，"零读取"就成了一个**可观测事实**；
 * 而"我这次没调到"本身不是证明。更强的结构性理由是：**本模块不 import `node:fs`**（测试里也钉住了）。
 * 但两者都**挡不住故意的绕过** —— 例如 `process.getBuiltinModule('node:fs')`
 * （独立复核 R3 实测：那样读取时 S4 **仍然全绿**）。所以准确的说法是：
 * **"正常写法下本模块不做 I/O；刻意混淆的写法能绕过这两道检查"**，不是"结构上不可能读取"。
 * 之所以留 `io`：它让"有人真的在这里加了 I/O"在 review 里一眼可见，成本几乎为零。
 *
 * @param {string} rawUrl 请求的完整 URL
 * @param {{readFileSync?:Function, existsSync?:Function, openSync?:Function, [k:string]:any}} [io]
 *   仅用于测试注入；**本函数不会调用其中任何方法**。
 * @returns {{ok:true, rawHost:string, uid:string, size:number}
 *          |{ok:false, status:number, reason:string}}
 */
export function parseThumbUrl(rawUrl, io = null) {
  // 显式声明契约：本函数是纯字符串处理。若将来有人在这里加了读取，`io` 会把它暴露出来。
  void io;
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, status: 400, reason: 'URL 无法解析' };
  }

  // host 小写化是 URL 规范行为；`decodeURIComponent` 防 `%2e%2e` 之类的编码绕过
  // 让 host 里出现意外字符（形状判不过 RE 就直接拒）。
  let rawHost;
  try {
    rawHost = decodeURIComponent(url.host || '');
  } catch {
    return { ok: false, status: 400, reason: 'host 编码非法' };
  }

  const m = SHAPE_RE.exec(url.pathname || '');
  if (!m) return { ok: false, status: 400, reason: '路径形状不对（应为 /<12位hex uid>@<size>）' };

  const size = Number(m[2]);
  if (!ALLOWED_SIZE.has(size)) {
    return { ok: false, status: 400, reason: `尺寸不在白名单：${m[2]}` };
  }

  // rawHost 为空也要拒：没有库 id 就无从反查路径
  if (!rawHost) return { ok: false, status: 400, reason: '缺少库 id' };

  return { ok: true, rawHost, uid: m[1], size };
}

/**
 * 失败时的状态码映射 —— **形状/尺寸/URL 层面的错 ⇒ 400；库无法还原 ⇒ 404**。
 *
 * 为什么把它单独抽成一个纯函数：这个映射就是 §8 的 S4/S5/S6 三条的**可执行契约**
 * （`SPEC-security.md` §3：`libId` 不在注册表 ⇒ 404；`uid`/`size` 形状错 ⇒ 400）。
 *
 * ⚠️ **签名收两个"事实"，而不是"一个状态码 + libId"** —— 旧签名让 400 分支**永远走不到**：
 * 旧写法 `thumbFailureStatus(p.ok ? 400 : p.status, libId)` 里，`p.ok === false` 时
 * `libId` 必然是 `''`（形状都没解析出来，无从还原库）⇒ 一律落到 404。
 * **实测**（`tools/verify_main_wiring.mjs`（**已移除 2026-10-13**） 直接调用真实产物）：`thumb://L1/<uid>@999`
 * 返回的是 **404**，而 §3 要求 **400**。
 * **顺序是契约的一部分：先判形状，再判库。**
 *
 * @param {{shapeOk:boolean, libId:string}} f `shapeOk`=形状/尺寸/URL 是否合法；`libId`=还原后的库 id
 * @returns {number|null} 该返回的状态码；`null` = 两项都正常，可继续
 */
export function thumbFailureStatus({ shapeOk, libId } = {}) {
  if (!shapeOk) return 400;      // 形状/尺寸不对 —— 与"库在不在"无关
  if (!libId) return 404;        // 形状合法但库无法还原
  return null;
}


/**
 * 把 URL 里的 host（已小写）还原成**引擎注册时的 libId 写法**。
 *
 * @param {string} host 已小写化的 host
 * @param {() => Promise<string[]>} listLibIds 取已注册库 id 的注入点（生产传 engine.indexStatus 的投影）
 * @returns {Promise<string>} 还原后的 libId；空串表示"未注册/无法还原" ⇒ 调用方给 404
 *
 * 为什么注入而不是直接拿 engine：这样测试能在**不启动 Electron、不建真索引**的前提下
 * 覆盖 S6（未注册库 ⇒ 404）与"大小写还原"这条**曾经真出过 bug** 的路径。
 */
export async function canonicalLibId(host, listLibIds) {
  const lower = String(host || '').toLowerCase();
  if (!lower) return '';
  const ids = await listLibIds();
  for (const id of ids || []) {
    if (String(id).toLowerCase() === lower) return String(id);
  }
  return '';
}

/**
 * 带缓存的 libId 还原器（生产用）。缓存理由：每个缩略图都查一次 `indexStatus` 太贵。
 *
 * ⚠️ **只缓存"查到了库"的结果；空列表不缓存**。这一条是独立复核抓出来的实缺陷：
 * 初版无条件 `filled = true`，于是**第一次**调用若发生在索引还没就绪（或 `indexStatus` 失败）时，
 * 空映射会被**永久**缓存 ⇒ 之后每一张缩略图都 404，而界面只会显示"无预览"，
 * 没有任何报错线索。（旧的内联实现用 `if (MAP.size === 0)`，反而会重查 —— 抽函数时退化了一步。）
 *
 * @param {{ listLibIds: () => Promise<string[]>, log?: (...a:any)=>void }} deps
 */
export function createLibIdResolver({ listLibIds, log = () => {} }) {
  const cache = new Map();
  return async function resolve(host) {
    const key = String(host || '').toLowerCase();
    if (!key) return '';
    if (!cache.has(key)) {
      // 只在**确实拿到库**时才把这批结果记下来；空结果视为"还没就绪"，下次重查。
      const ids = (await listLibIds()) || [];
      if (ids.length > 0) {
        for (const id of ids) cache.set(String(id).toLowerCase(), String(id));
        log('thumb 库 id 映射', JSON.stringify([...cache.entries()]));
      }
    }
    return cache.get(key) || '';
  };
}
