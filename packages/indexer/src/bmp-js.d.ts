// bmp-js.d.ts —— bmp-js 是纯 CJS 且不带类型声明（TS7016），这里按它 index.js 的实际导出补一个**环境模块**声明。
//
// ⚠️ 必须是**非模块**的 .d.ts：`declare module` 写在模块文件里会被当成"模块增强"，
//    而模块解析到未类型化的 JS 时不能增强（TS2665）。
declare module 'bmp-js' {
  interface BmpDecodeResult {
    data: Uint8Array;
    width: number;
    height: number;
  }
  interface BmpJs {
    decode(buffer: Buffer | Uint8Array): BmpDecodeResult;
  }
  const bmpjs: BmpJs;
  export default bmpjs;
}
