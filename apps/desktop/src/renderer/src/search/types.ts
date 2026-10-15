// search/types.ts —— 检索区组件的**最小 props 形状**（纯类型）
//
// 为什么单独一份（而不是从 store/search.ts import `SearchResult`）：
//   UI 层只该声明「我要用到的字段长什么样」。声明成最小结构类型后，Operation 层传来的
//   真实对象（字段更多）**结构上天然满足**它 —— 不需要断言、不需要转换，也不会形成反向依赖。

/** 结果卡/详情页要用到的一条素材（store 的 `SearchResult` 是它的超集） */
export type SearchItem = {
  uid?: string;
  libId?: string;
  stem?: string;
  relPath?: string;
  folder?: string | null;
  score?: number;
  band?: string;
  vectorSource?: string;
  imageSize?: number | null;
  imageMtime?: number | null;
  /**
   * 同名压缩包（缺包是允许的）。
   * ⚠️ 形状写 `unknown` 是**有意的**，与 `store/search.ts` 的 `SearchResult.archive` 保持一致：
   *    引擎没给包时这里是 `null`；界面只做「有没有包」的存在性判断，
   *    真要用里面的字段时在**组件里**窄化（见 `PhotoCard` 的 `archiveOf`）。
   *    写成具体对象形状会让 store 的数据类型**对不上**（TS2322），那会逼调用点写断言。
   */
  archive?: unknown;
  exists?: { image?: boolean; archive?: boolean } | null;
};

/** 归一化后的错误（Adapter 保证 `userMessage` 非空） */
export type SearchError = { code?: string; userMessage: string };

/** 结果区/详情页的错误可以是 `null`（还没出错） */
export type SearchErrorish = SearchError | null;
