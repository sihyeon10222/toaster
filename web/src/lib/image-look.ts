// 그림의 "생김새": 크기와 9x8 흑백으로 줄인 차이 해시(dHash).
// 같은 그림이 크기만 다르게(썸네일·원본, 1x·2x) 여러 번 나오면 가장 큰 것만 남기는 데 쓴다.
// 크기가 같은 그림끼리는 절대 합치지 않는다 (비슷하게 생긴 이모티콘 여러 개를 지우지 않도록).
// iOS 앱의 ImageLook.swift 와 같은 규칙이다.

export interface ImageLook {
  width: number;
  height: number;
  /** 64칸, 옆 칸보다 밝으면 1 */
  bits: Uint8Array;
}

/** 해시가 이만큼까지 달라도 같은 그림으로 본다 (줄일 때 생기는 차이) */
const MAX_DISTANCE = 5;

/** 브라우저가 그릴 수 없는 형식(SVG 등)이면 null */
export async function imageLook(blob: Blob): Promise<ImageLook | null> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const w = 9, h = 8;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // 투명한 곳은 흰 바탕으로 본다
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    };
    const bits = new Uint8Array(64);
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) bits[n++] = gray(x, y) > gray(x + 1, y) ? 1 : 0;
    return { width: bitmap.width, height: bitmap.height, bits };
  } finally {
    bitmap.close();
  }
}

/** 크기만 다른 같은 그림인지: 해시가 거의 같고, 가로세로 비율이 같고, 크기는 다르다 */
function isResized(a: ImageLook, b: ImageLook) {
  if (a.width === b.width && a.height === b.height) return false;
  const ra = a.width / a.height, rb = b.width / b.height;
  if (Math.abs(ra - rb) / Math.max(ra, rb) >= 0.03) return false;
  let distance = 0;
  for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) distance++;
  return distance <= MAX_DISTANCE;
}

/** 같은 그림 무리마다 가장 큰 것 하나만 남기고, 지울 번호들을 돌려준다 */
export function smallerDuplicates(looks: (ImageLook | null)[]): number[] {
  const keep: number[] = [];
  const drop: number[] = [];
  looks.forEach((look, index) => {
    if (!look) return;
    const k = keep.findIndex((i) => isResized(looks[i]!, look));
    if (k < 0) {
      keep.push(index);
      return;
    }
    const kept = keep[k];
    const bigger = look.width * look.height > looks[kept]!.width * looks[kept]!.height;
    if (bigger) {
      drop.push(kept);
      keep[k] = index;
    } else {
      drop.push(index);
    }
  });
  return drop;
}
