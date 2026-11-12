// mux.js 는 타입 정의를 싣지 않아서 쓰는 부분만 적어 둔다
declare module "mux.js" {
  interface TransmuxedSegment {
    initSegment: Uint8Array;
    data: Uint8Array;
  }
  interface Transmuxer {
    on(event: "data", listener: (segment: TransmuxedSegment) => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
  const muxjs: { mp4: { Transmuxer: new () => Transmuxer } };
  export default muxjs;
}
