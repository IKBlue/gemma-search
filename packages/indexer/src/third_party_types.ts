// third_party_types.ts —— 只放类型：给第三方依赖的类型缺口补声明（零运行时导出）
//
// 一、@huggingface/transformers 的 .d.ts 由 JSDoc 生成，缺了本包运行时**确实读写**的字段：
//   · config.audio_config / config.vision_config
//     —— 模型 config.json 里就有；脚本用它们判断"要不要装音频塔 / 有没有视觉塔"
//   · processor.image_seq_length / image_processor.max_soft_tokens / image_processor.config.image_seq_length
//     —— 实测这三处默认都是 280，构建器**必须显式设成 SEQ**，否则向量与索引静默不匹配（G-B 的 seq 生效点）
//   做法：interface + class 的**声明合并**。
//
// 二、bmp-js 不带类型声明 —— 见同目录 bmp-js.d.ts（环境模块声明必须放在非模块的 .d.ts 里）。
//
// ⚠️ 本文件只补类型、不改行为：没有任何值导出，import type 会被完全抹掉（isolatedModules）。

import type { AutoModel, ImageProcessor } from '@huggingface/transformers';

declare module '@huggingface/transformers' {
  interface Processor {
    /** 分辨率 seq 的生效点之一（另两处见 image_processor 与它的 config 副本） */
    image_seq_length: number;
  }
  interface ImageProcessor {
    /** 三处 seq 的第二处（上游默认 280） */
    max_soft_tokens: number;
    image_seq_length: number;
    /** 脚本要按**运行时实际形状**枚举字段（如 probe_proc_shape 的 k in ip 循环） */
    [key: string]: unknown;
  }
  interface PretrainedConfig {
    /** = null 表示不加载音频塔（Python 侧 apply_seq 同款做法） */
    audio_config: unknown;
    /** 只用于日志判断"有没有视觉塔" */
    vision_config: unknown;
  }
}

/** from_pretrained 的选项类型：dtype / device 的合法取值都从这里取，不手抄一份联合 */
export type ModelLoadOptions = NonNullable<Parameters<typeof AutoModel.from_pretrained>[1]>;
export type ModelDtype = NonNullable<ModelLoadOptions['dtype']>;
export type ModelDevice = NonNullable<ModelLoadOptions['device']>;

/**
 * image_processor.config 的视图：上游把 ImageProcessorConfig 写成 **type alias**
 * （不能声明合并），而运行时它带着第三处 image_seq_length。
 */
export type ImageProcessorConfigView = ImageProcessor['config'] & {
  image_seq_length: number;
  [key: string]: unknown;
};

/** 模型 forward 输出里本包用到的张量字段（上游 forward 的返回类型未声明，这里给出可校验的视图） */
export interface TensorView {
  data: ArrayLike<number>;
  dims: number[];
  type?: string;
  length?: number;
}

export interface ModelOutputView {
  sentence_embedding?: TensorView;
  text_embeds?: TensorView;
  last_hidden_state?: TensorView;
  pixel_values?: TensorView;
}
