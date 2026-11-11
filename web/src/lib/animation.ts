// 움직이는 그림(GIF·WEBP·APNG)을 다루는 작은 도구들. iOS 앱의 AnimatedImage.swift 와 같은 판단을 한다.
//
// 1) 미리보기를 계속 반복하게: 파일에 "몇 번만 재생" 이 적혀 있으면 브라우저가 그만큼만 돌고 멈춘다.
//    화면에 보여 줄 사본만 "무한 반복" 으로 고친다. 저장하는 원본은 그대로 둔다.
// 2) 움직이는지 판별: 텔레그램 정지 스티커로 그대로 쓸 수 있는지 볼 때 쓴다.

const ascii = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

function indexOf(b: Uint8Array, text: string, from = 0) {
  for (let i = from; i + text.length <= b.length; i++) if (ascii(b, i, text)) return i;
  return -1;
}

/** 여러 장면을 가진 그림인지 (GIF 는 장면 두 개 이상, WEBP 는 ANIM, PNG 는 acTL) */
export function isAnimated(b: Uint8Array, type: string) {
  if (type === "image/gif") return countGifFrames(b) > 1;
  if (type === "image/webp") return indexOf(b, "ANIM", 12) >= 0;
  if (type === "image/png") {
    const idat = indexOf(b, "IDAT", 8);
    const actl = indexOf(b, "acTL", 8);
    return actl >= 0 && (idat < 0 || actl < idat);
  }
  return false;
}

/** 화면에 보여 줄 사본: 반복 횟수를 "무한" 으로 고친다. 고칠 게 없으면 받은 그대로 돌려준다. */
export function loopForever(b: Uint8Array, type: string): Uint8Array {
  try {
    if (type === "image/gif") return gifForever(b);
    if (type === "image/webp") return webpForever(b);
    if (type === "image/png") return apngForever(b);
  } catch {}
  return b;
}

// ---------------------------------------------------------------- GIF

const NETSCAPE = [0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0))];

function gifForever(b: Uint8Array) {
  if (countGifFrames(b) < 2) return b;
  const at = indexOf(b, "NETSCAPE2.0");
  if (at >= 0) {
    // 21 FF 0B "NETSCAPE2.0" 03 01 [반복 횟수 2바이트] 00 → 0 은 무한 반복
    const copy = b.slice();
    copy[at + 13] = 0;
    copy[at + 14] = 0;
    return copy;
  }
  // 반복 정보가 아예 없으면 한 번만 돈다 → 전역 색표 뒤에 무한 반복 블록을 넣는다
  const gct = b[10] & 0x80 ? 3 * 2 ** ((b[10] & 0x07) + 1) : 0;
  const head = 13 + gct;
  const block = new Uint8Array([...NETSCAPE, 0x03, 0x01, 0x00, 0x00, 0x00]);
  const out = new Uint8Array(b.length + block.length);
  out.set(b.subarray(0, head));
  out.set(block, head);
  out.set(b.subarray(head), head + block.length);
  return out;
}

/** GIF 의 장면 수 (블록 구조를 따라가며 센다) */
function countGifFrames(b: Uint8Array) {
  if (!ascii(b, 0, "GIF")) return 0;
  let i = 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 0x07) + 1) : 0);
  let frames = 0;
  const skipSubBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  while (i < b.length) {
    const kind = b[i];
    if (kind === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      const flags = b[i + 9];
      i += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
      i++; // LZW 최소 코드 크기
      skipSubBlocks();
    } else if (kind === 0x21) {
      i += 2;
      skipSubBlocks();
    } else break; // 0x3B 끝 또는 깨진 파일
  }
  return frames;
}

// ---------------------------------------------------------------- WEBP

function webpForever(b: Uint8Array) {
  const at = indexOf(b, "ANIM", 12);
  if (at < 0) return b;
  // "ANIM" [크기 4] [배경색 4] [반복 횟수 2] → 0 은 무한 반복
  const copy = b.slice();
  copy[at + 12] = 0;
  copy[at + 13] = 0;
  return copy;
}

// ---------------------------------------------------------------- APNG

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function apngForever(b: Uint8Array) {
  if (!isAnimated(b, "image/png")) return b;
  const at = indexOf(b, "acTL", 8);
  // [길이 4] "acTL" [장면 수 4] [반복 횟수 4] [CRC 4] → 반복 0 은 무한, CRC 는 다시 계산
  const copy = b.slice();
  copy.fill(0, at + 8, at + 12);
  const crc = crc32(copy.subarray(at, at + 12));
  new DataView(copy.buffer, copy.byteOffset).setUint32(at + 12, crc);
  return copy;
}
