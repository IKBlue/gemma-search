// apps/desktop/src/main/encoder-device.ts —— 「设备」这件事的**唯一语义来源**（T-31 / U2 核查的修法）
//
// 为什么单独一个模块：U2 核查（**结论就地自述，本轮不引逐轮产物**）证明了两件事 ——
//   ① 旧代码里的 device 字段**同时被读成"请求"和"实际"**（两义）。它其实只是"我们请求的值"：
//      encoder.ts 里 device 是局部变量，只有"我们看得见的回退"才会把它改成 cpu；
//   ② 在 Node/Electron 主进程里 transformers.js 把 IS_WEBGPU_AVAILABLE **恒置为真**
//      （transformers.node.mjs:38）⇒ "它接受了 webgpu"**不携带"这台机器真有 GPU"的信息**。
// 于是把判定收成这一个**纯函数**：输入「请求 + 探测结果」，输出「拿什么去初始化 / 有没有回退 /
// 已验证的 EP（拿不到就是 null）」。纯函数 ⇒ 每种情形都能在 node:test 里钉死。
//
// ⚠️ effectiveProvider 的取值依据（**不许猜**，三条都写清出处）：
//   · 请求 cpu ⇒ 'cpu'：transformers 的 DEVICE_TO_EXECUTION_PROVIDER_MAPPING 里 cpu -> "cpu"
//     （transformers.node.mjs:12537）；且 u2.txt 实测 device=cpu 时 profile 里只有 CPUExecutionProvider。
//   · 请求 webgpu + 探测到适配器 ⇒ 'webgpu'：ORT 的 EP 解析是**全有或全无**
//     （onnxruntime-common/dist/esm/backend-impl.js:119-128：一个后端都拿不到就抛 "no available backend found"），
//     所以"初始化没抛错"本身说明 webgpu 这个 EP 被解析成功；u2.txt 本机 profile 实测一致
//     （请求 webgpu ⇒ WebGpuExecutionProvider × 6192 · CPU × 222 是算子级回落，正常）。
//   · 探测给不出结论（没窗口 / 探测抛错 / 超时）⇒ **null**，绝不按请求值顶上。
//
// ⚠️ 与 T-00 护栏的关系：护栏调 createEncoder 时**不传 gpuProbe** ⇒ 默认 UNPROBED（available = null），
//    于是 decision.device 就是请求值、不产生回退、初始化路径与改动前**逐字一致** ⇒ Top-5 必须逐位不变。

/** 调用方请求的设备（**只有这两个值**，非法值不许在这里悄悄纠正） */
export type RequestedDevice = 'webgpu' | 'cpu';

/**
 * GPU 可用性探测结果。
 * available: true = 探测到可用适配器 · false = 明确不可用 · **null = 拿不到结论**（没窗口/抛错/超时）
 */
export interface GpuProbe {
  available: boolean | null;
  /** 人读依据（进日志与界面文案；null 时说明为什么拿不到） */
  detail: string;
}

/** 没做探测时的取值：**不猜**，只说拿不到 */
export const UNPROBED: GpuProbe = Object.freeze({
  available: null,
  detail: '未做探测（调用方没有提供探测结果）',
});

/** 设备回退的事实（from != to 才存在） */
export interface DeviceFallbackFact {
  from: RequestedDevice;
  to: RequestedDevice;
  /** 为什么回退（探测结论或原始报错，原样带上不加工） */
  reason: string;
}

/** 决策结果：encoder.ts 只按它执行，不再自己判断 */
export interface DeviceDecision {
  /** 请求值（原样保留，供界面/日志区分"请求"与"实际"） */
  requested: RequestedDevice;
  /** **实际拿去初始化**的设备（探测说不可用 ⇒ 已是 cpu，不必先试 webgpu 再失败） */
  device: RequestedDevice;
  /** 回退事实；没回退就是 null */
  fallback: DeviceFallbackFact | null;
  /** **已验证**的执行提供者名；拿不到就是 null（不许猜） */
  effectiveProvider: string | null;
  /** 人读说明（日志/界面直接可用） */
  note: string;
}

/** 请求 cpu ⇒ 一定是 cpu（映射表事实 + u2 实测），不需要任何探测 */
function cpuDecision(requested: RequestedDevice): DeviceDecision {
  return {
    requested,
    device: 'cpu',
    fallback: requested === 'cpu' ? null : { from: requested, to: 'cpu', reason: '按请求使用 CPU' },
    effectiveProvider: 'cpu',
    note: '请求 cpu ⇒ 使用 CPU（transformers 的 cpu -> "cpu" 映射；u2 实测只有 CPUExecutionProvider）',
  };
}

/**
 * 设备决策（**纯函数**，T-31 的全部语义都在这里）。
 *
 * 四种情形：
 *   1. 请求 cpu                                  ⇒ 直接用 cpu，effectiveProvider = 'cpu'
 *   2. 请求 webgpu + 探测说**不可用**            ⇒ 直接用 cpu + 记回退（**不去试**，避免"报 webgpu 再失败"）
 *   3. 请求 webgpu + 探测说**可用**              ⇒ 用 webgpu，effectiveProvider = 'webgpu'
 *   4. 请求 webgpu + **探测没结论**（null）      ⇒ 照旧用 webgpu，但 effectiveProvider = **null**（不许猜）
 */
export function decideDevice(
  requested: RequestedDevice,
  probe: GpuProbe = UNPROBED,
): DeviceDecision {
  // ⚠️ 运行时可能是**契约外的值**（config.device 来自外部 JSON，调用点用的是类型断言）：
  //    那种情况**原样透传**、不做任何"纠正"（绝不把 cuda 这类值悄悄改成 webgpu），
  //    也不假装知道它的 EP（effectiveProvider = null）。这条是改动前既有行为，别顺手改。
  const rawRequested: string = requested;
  if (rawRequested !== 'cpu' && rawRequested !== 'webgpu') {
    return {
      requested,
      device: requested,
      fallback: null,
      effectiveProvider: null,
      note: '请求了契约外的设备值（' + rawRequested + '）⇒ 原样交给编码器，实际 EP 未验证',
    };
  }
  if (requested === 'cpu') return cpuDecision(requested);

  if (probe.available === false) {
    return {
      requested,
      device: 'cpu',
      fallback: { from: 'webgpu', to: 'cpu', reason: '本机 GPU 不可用（' + probe.detail + '）' },
      effectiveProvider: 'cpu',
      note: '探测明确说 GPU 不可用 ⇒ 直接使用 CPU，不把 cpu 说成 webgpu',
    };
  }

  if (probe.available === true) {
    return {
      requested,
      device: 'webgpu',
      fallback: null,
      effectiveProvider: 'webgpu',
      note:
        '探测到可用适配器 ⇒ 请求 webgpu（' +
        probe.detail +
        '）；ORT 的 EP 解析全有或全无，初始化成功即该 EP 被采用',
    };
  }

  return {
    requested,
    device: 'webgpu',
    fallback: null,
    effectiveProvider: null,
    note:
      '请求 webgpu，但**探测没给出结论**（' +
      probe.detail +
      '）⇒ 实际 EP **未验证**，不按请求值充当结论',
  };
}
