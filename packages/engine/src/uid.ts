// packages/engine/src/uid.ts —— 素材稳定标识（`SPEC.md` §1.2（asset.uid），已冻结）
//
//   uid = sha1( lib_id + "|" + rel_dir + "|" + stem ).slice(0, 12)
//
// ⚠️ 这里**只能有一份实现**（P1）。曾经把种子换成"图像内容 sha1"，被 SPEC.md §1.1（数据模型总览）明确否决：
//    内容相同的两张图会拿到同一个 uid ⇒ rowByUid 把两条折成一行 ⇒ **条目数与索引行数不等**。
//    实测库里真有 5 组内容完全相同的图，所以那不是理论风险。
//
// 现存实现位置：engine/src/uid.ts（本文件，引擎侧唯一一份）·
//   packages/indexer/src/build_index_onnx.ts（构建器内的同名公式，属索引线，未在本任务改动）。
//   两边由 tests/uid.test.mjs 的**黄金向量**钉住同一公式；构建器那份的收敛已在交付说明里上报。
import crypto from 'node:crypto';
import path from 'node:path';

/**
 * 目录相对路径的**规范形**：库根 ⇒ 空串（uid 公式里 rel_dir 的口径）。
 * ⚠️ 别拿它去处理"文件 relPath"—— 文件的目录要先 `path.dirname`；这正是本文件把两件事
 *    分开写的原因：曾经把 `relDirOf(某个目录路径)` 当成"目录规范化"用，dirname 把最后一段目录名
 *    也吃掉了 ⇒ 所有条目 rel_dir 都变成空串 ⇒ **VR/A 与 CR/A 算出同一个 uid**（主键碰撞，
 *    实测被 scanner.test.mjs 的"整树 uid 唯一"断言当场抓住）。
 */
export function normRelDir(relDir: string): string {
  return relDir === '.' || relDir === '' ? '' : relDir;
}

/** 文件 relPath 的目录部分（根目录下返回空串，**不是** '.'） */
export function relDirOf(relPath: string): string {
  return normRelDir(path.dirname(relPath));
}

/**
 * `SPEC.md` §1.2（asset.uid） 的冻结公式。
 * relDir 传 '.' / null / undefined 都按空串处理 —— 与既有实现（引擎测试里的两处副本、构建器）逐字一致。
 */
export function uidOf(libId: string, relDir: string | null | undefined, stem: string): string {
  const dir = relDir == null ? '' : normRelDir(String(relDir));
  return crypto
    .createHash('sha1')
    .update(`${libId}|${dir}|${stem}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
}
