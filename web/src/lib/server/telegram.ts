// 이미지·GIF·영상을 텔레그램 스티커 규격 파일로 바꾼다. https://core.telegram.org/stickers
//
//   정지 스티커: PNG(또는 WEBP), 투명 배경, 한 변이 정확히 512px(다른 변은 512 이하), 512KB 이하
//   영상 스티커: WEBM(VP9), 한 변이 정확히 512px, 30fps, 3초 이하, 소리 없음, 256KB 이하
//
// 움직이는 GIF·WEBP 와 영상은 모두 영상 스티커(webm)가 된다. 텔레그램은 움직이는 WEBP 스티커를 받지 않는다.
// 3초보다 길면 최대 2배까지 빠르게 돌려 맞추고, 그래도 넘치면 앞 3초만 남긴다.
//
// 팩 썸네일(https://core.telegram.org/bots/api#setstickersetthumbnail):
//   정지: PNG(또는 WEBP), 정확히 100x100, 128KB 이하 / 움직이는 것: WEBM(VP9), 100x100, 32KB 이하
//   비율이 다른 그림은 투명한 여백을 붙여 정사각형으로 만든다.
import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import sharp, { type Metadata } from "sharp";
import { sniffType } from "@/lib/sniff";

export const STICKER_SIDE = 512;
const FPS = 30;
const MAX_SECONDS = 3;
const MAX_SPEEDUP = 2;
const FFMPEG_TIMEOUT_MS = 60_000;

export class StickerError extends Error {}

/** 만들 파일의 규격 */
interface Spec {
  /** 긴 변 길이 */
  side: number;
  /** true 면 투명 여백을 붙여 정확히 side x side 로 만든다 (썸네일) */
  square: boolean;
  staticMaxBytes: number;
  videoMaxBytes: number;
}

const STICKER: Spec = { side: STICKER_SIDE, square: false, staticMaxBytes: 512 * 1024, videoMaxBytes: 256 * 1024 };
const THUMBNAIL: Spec = { side: 100, square: true, staticMaxBytes: 128 * 1024, videoMaxBytes: 32 * 1024 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export interface Sticker {
  bytes: Uint8Array;
  ext: "png" | "webp" | "webm";
  type: string;
}

/** 아무 이미지·영상을 텔레그램 스티커 파일 하나로 바꾼다. */
export function toTelegramSticker(input: Uint8Array): Promise<Sticker> {
  return convert(input, STICKER);
}

/** 스티커 팩 썸네일: 정지 그림은 100x100 PNG, 움직이는 GIF·영상은 100x100 WEBM */
export function toTelegramThumbnail(input: Uint8Array): Promise<Sticker> {
  return convert(input, THUMBNAIL);
}

async function convert(input: Uint8Array, spec: Spec): Promise<Sticker> {
  const type = sniffType(input);
  if (!type) throw new StickerError("이미지나 영상이 아닙니다.");
  if (type.startsWith("video/")) return videoSticker(input, spec);

  const meta = await sharp(input, { animated: true }).metadata().catch(() => null);
  if (!meta) throw new StickerError("이미지를 읽지 못했습니다.");
  if ((meta.pages ?? 1) > 1) return animatedSticker(input, meta, spec);
  return staticSticker(input, type === "image/svg+xml", spec);
}

// ---------------------------------------------------------------- 공통

/** 긴 변을 side 로 맞춘 크기. VP9(yuv420)를 위해 짧은 변은 짝수로 맞춘다. */
function fitSize(width: number, height: number, even: boolean, side: number) {
  const scale = side / Math.max(width, height);
  const round = (n: number) => (even ? Math.max(2, Math.round(n / 2) * 2) : Math.max(1, Math.round(n)));
  return width >= height
    ? { width: side, height: Math.min(side, round(height * scale)) }
    : { width: Math.min(side, round(width * scale)), height: side };
}

/** 원본 길이(초)로 빠르게 돌릴 배율과 결과 길이를 정한다. */
function timing(sourceSeconds: number) {
  const speed = Math.min(Math.max(sourceSeconds / MAX_SECONDS, 1), MAX_SPEEDUP);
  return { speed, seconds: Math.min(sourceSeconds / speed, MAX_SECONDS) };
}

// ---------------------------------------------------------------- 정지 스티커

async function staticSticker(input: Uint8Array, svg: boolean, spec: Spec): Promise<Sticker> {
  // SVG 는 기본 해상도로 그리면 512 로 키울 때 흐려져서 크게 그린다
  const base = sharp(input, svg ? { density: 384 } : {})
    .rotate() // 사진의 EXIF 회전 반영
    .resize(spec.side, spec.side, spec.square ? { fit: "contain", background: TRANSPARENT } : { fit: "inside" })
    .ensureAlpha();
  const max = spec.staticMaxBytes;

  const png = await base.clone().png({ compressionLevel: 9 }).toBuffer();
  if (png.byteLength <= max) return { bytes: png, ext: "png", type: "image/png" };

  // 사진처럼 큰 이미지는 팔레트 PNG → WEBP 순으로 줄인다
  const palette = await base.clone().png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  if (palette.byteLength <= max) return { bytes: palette, ext: "png", type: "image/png" };
  for (const quality of [90, 80, 70, 55, 40]) {
    const webp = await base.clone().webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
    if (webp.byteLength <= max) return { bytes: webp, ext: "webp", type: "image/webp" };
  }
  throw new StickerError(`${max / 1024}KB 이하로 줄이지 못했습니다.`);
}

// ---------------------------------------------------------------- 움직이는 GIF·WEBP

async function animatedSticker(input: Uint8Array, meta: Metadata, spec: Spec): Promise<Sticker> {
  const pages = meta.pages ?? 1;
  const pageHeight = meta.pageHeight ?? meta.height ?? 0;
  const srcWidth = meta.width ?? 0;
  if (!srcWidth || !pageHeight) throw new StickerError("이미지 크기를 알 수 없습니다.");

  // 프레임 시간. 0·10ms 이하는 브라우저처럼 100ms 로 본다.
  const delays = Array.from({ length: pages }, (_, i) => {
    const d = meta.delay?.[i] ?? 100;
    return d <= 10 ? 100 : d;
  });
  const sourceMs = delays.reduce((a, b) => a + b, 0);
  const { speed, seconds } = timing(sourceMs / 1000);
  const frameCount = Math.max(1, Math.round(seconds * FPS));

  // 결과 프레임 i 가 보여 줄 원본 프레임 번호
  const starts: number[] = [];
  delays.reduce((t, d) => (starts.push(t), t + d), 0);
  const pick = (ms: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= ms) i++;
    return i;
  };
  const order = Array.from({ length: frameCount }, (_, i) => pick((i * 1000 * speed) / FPS));
  const needed = Math.max(...order) + 1; // 3초 뒤 프레임은 아예 풀지 않는다

  const size = spec.square ? { width: spec.side, height: spec.side } : fitSize(srcWidth, pageHeight, true, spec.side);
  // 프레임마다 따로 줄여야 썸네일의 투명 여백이 프레임 사이에 생기지 않는다
  const { data } = await sharp(input, { animated: true, pages: needed })
    .resize(size.width, size.height, spec.square ? { fit: "contain", background: TRANSPARENT } : { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const frameBytes = size.width * size.height * 4;
  const frames = order.map((i) => data.subarray(i * frameBytes, (i + 1) * frameBytes));

  return encodeWebm(
    ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${size.width}x${size.height}`, "-r", String(FPS), "-i", "pipe:0"],
    "format=yuva420p",
    frames.length / FPS,
    spec.videoMaxBytes,
    frames,
  );
}

// ---------------------------------------------------------------- 영상

async function videoSticker(input: Uint8Array, spec: Spec): Promise<Sticker> {
  const dir = await mkdtemp(join(tmpdir(), "toaster-tg-"));
  try {
    const src = join(dir, "input");
    await writeFile(src, input);
    const probe = await probeVideo(src);
    const { speed, seconds } = timing(probe.seconds || MAX_SECONDS);
    const size = fitSize(probe.width, probe.height, true, spec.side);
    const filter = [
      speed > 1 ? `setpts=PTS/${speed.toFixed(4)}` : null,
      `fps=${FPS}`,
      `scale=${size.width}:${size.height}:flags=lanczos`,
      "format=yuva420p",
      // 썸네일은 투명 여백을 붙여 정사각형으로
      spec.square ? `pad=${spec.side}:${spec.side}:(ow-iw)/2:(oh-ih)/2:color=black@0` : null,
      "setsar=1",
    ]
      .filter(Boolean)
      .join(",");
    return await encodeWebm(["-i", src], filter, seconds, spec.videoMaxBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** ffmpeg -i 의 안내문에서 길이와 화면 크기를 읽는다 (ffmpeg-static 에는 ffprobe 가 없다) */
async function probeVideo(path: string) {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", path], undefined, true);
  const d = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = stderr.match(/Stream #.*?Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!v) throw new StickerError("영상 화면을 찾지 못했습니다.");
  let width = Number(v[1]);
  let height = Number(v[2]);
  // 세로로 찍은 휴대폰 영상은 회전 정보만 붙어 있다
  const rotation = stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/);
  const deg = Math.abs(Number(rotation?.[1] ?? rotation?.[2] ?? 0)) % 180;
  if (deg === 90) [width, height] = [height, width];
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  return { width, height, seconds };
}

// ---------------------------------------------------------------- VP9 인코딩

/**
 * maxBytes 안에 들어올 때까지 비트레이트를 낮추며 VP9 webm 으로 굽는다.
 * frames 가 있으면 매번 표준 입력으로 다시 흘려 넣는다.
 */
async function encodeWebm(
  input: string[],
  filter: string,
  seconds: number,
  maxBytes: number,
  frames?: Buffer[],
): Promise<Sticker> {
  const dir = await mkdtemp(join(tmpdir(), "toaster-tg-"));
  try {
    const out = join(dir, "out.webm");
    // 컨테이너 몫을 조금 남긴 목표 비트레이트
    let kbps = Math.floor((maxBytes * 8 * 0.92) / Math.max(seconds, 0.5) / 1000);
    for (let attempt = 0; attempt < 8; attempt++) {
      await runFfmpeg(
        [
          "-hide_banner", "-loglevel", "error", "-y",
          ...input,
          "-t", String(MAX_SECONDS),
          "-an", "-sn", "-dn", "-map_metadata", "-1",
          "-vf", filter,
          "-r", String(FPS),
          "-c:v", "libvpx-vp9",
          "-pix_fmt", "yuva420p",
          "-b:v", `${kbps}k`,
          "-maxrate", `${Math.round(kbps * 1.4)}k`,
          "-bufsize", `${kbps * 2}k`,
          "-crf", "32",
          "-auto-alt-ref", "0", // 투명 채널과 같이 쓰면 오류가 난다
          "-deadline", "good", "-cpu-used", "2", "-row-mt", "1",
          "-f", "webm", out,
        ],
        frames,
      );
      const bytes = await readFile(out);
      if (bytes.byteLength <= maxBytes) return { bytes, ext: "webm", type: "video/webm" };
      kbps = Math.max(10, Math.floor(kbps * (maxBytes / bytes.byteLength) * 0.85));
    }
    throw new StickerError(`${maxBytes / 1024}KB 이하로 줄이지 못했습니다.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ffmpegPath = () => {
  const path = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!path) throw new StickerError("이 서버에 ffmpeg 가 없습니다.");
  return path;
};

function runFfmpeg(args: string[], frames?: Buffer[], allowFailure = false): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { stdio: [frames ? "pipe" : "ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => {
      if (stderr.length < 64_000) stderr += c.toString();
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(new StickerError(`ffmpeg 를 실행하지 못했습니다: ${e.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || allowFailure) resolve({ stderr });
      else {
        console.error("ffmpeg failed:", stderr);
        reject(new StickerError("영상 변환에 실패했습니다."));
      }
    });
    const stdin = proc.stdin;
    if (frames && stdin) {
      stdin.on("error", () => {}); // ffmpeg 가 먼저 끝나면 EPIPE 가 난다
      void (async () => {
        for (const f of frames) {
          if (stdin.destroyed) return;
          if (!stdin.write(f)) {
            await new Promise<void>((resolve) => {
              const done = () => {
                stdin.off("drain", done);
                stdin.off("close", done);
                resolve();
              };
              stdin.on("drain", done);
              stdin.on("close", done);
            });
          }
        }
        stdin.end();
      })();
    }
  });
}
