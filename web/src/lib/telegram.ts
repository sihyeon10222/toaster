// 받은 파일들을 /api/telegram 으로 텔레그램 스티커 규격에 맞게 바꿔 zip 으로 묶는다.
// 팩 썸네일도 같이 만든다: 첫 번째 이미지(GIF 포함, 없으면 첫 파일) → thumbnail.png 또는 움직이면 thumbnail.webm
import { zipSync } from "fflate";
import type { CollectedFile } from "@/lib/collect";

const CONCURRENCY = 3;

export interface StickerProgress {
  done: number;
  total: number;
}

export interface StickerResult {
  files: { filename: string; blob: Blob }[];
  errors: string[];
}

async function convertOne(file: CollectedFile, referer: string, thumb: boolean) {
  const q = new URLSearchParams({ url: file.source_url, referer });
  if (thumb) q.set("thumb", "1");
  const res = await fetch(`/api/telegram?${q}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return { ext: res.headers.get("X-Sticker-Ext") ?? "webm", blob: await res.blob() };
}

/**
 * 파일마다 서버에서 변환한다. 이름은 형식과 상관없이 성공한 것만 페이지 순서대로 1, 2, 3… (1.webm, 2.png)
 * 마지막에 팩 썸네일 thumbnail.png / thumbnail.webm 을 붙인다.
 */
export async function convertToStickers(
  files: CollectedFile[],
  referer: string,
  onProgress: (p: StickerProgress) => void,
): Promise<StickerResult> {
  const out: ({ ext: string; blob: Blob } | null)[] = new Array(files.length).fill(null);
  const errors: string[] = [];
  const total = files.length + 1; // 썸네일 하나 더
  let done = 0;
  let next = 0;
  onProgress({ done, total });

  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const index = files.indexOf(file);
      try {
        out[index] = await convertOne(file, referer, false);
      } catch (e) {
        errors.push(`${file.filename}: ${(e as Error).message}`);
      }
      onProgress({ done: ++done, total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  const converted = out.filter((f) => f !== null);
  const result = converted.map((f, i) => ({ filename: `${i + 1}.${f.ext}`, blob: f.blob }));

  // 썸네일: 스티커로 바뀐 것 중 첫 번째 이미지(GIF 포함). 이미지가 하나도 없으면 첫 파일(영상)
  const usable = files.filter((_, i) => out[i] !== null);
  const source = usable.find((f) => f.kind === "image") ?? usable[0];
  if (source) {
    try {
      const thumb = await convertOne(source, referer, true);
      result.push({ filename: `thumbnail.${thumb.ext}`, blob: thumb.blob });
    } catch (e) {
      errors.push(`썸네일(${source.filename}): ${(e as Error).message}`);
    }
  }
  onProgress({ done: total, total });
  return { files: result, errors };
}

export async function zipStickers(files: StickerResult["files"]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.filename] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: "application/zip" });
}
