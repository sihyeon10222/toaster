// 받은 파일들을 /api/telegram 으로 텔레그램 스티커 규격에 맞게 바꿔 zip 으로 묶는다.
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

/** 파일마다 서버에서 변환한다. 이름은 형식과 상관없이 성공한 것만 페이지 순서대로 1, 2, 3… (1.webm, 2.png) */
export async function convertToStickers(
  files: CollectedFile[],
  referer: string,
  onProgress: (p: StickerProgress) => void,
): Promise<StickerResult> {
  const out: ({ ext: string; blob: Blob } | null)[] = new Array(files.length).fill(null);
  const errors: string[] = [];
  let done = 0;
  let next = 0;
  onProgress({ done, total: files.length });

  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const index = files.indexOf(file);
      try {
        const q = new URLSearchParams({ url: file.source_url, referer });
        const res = await fetch(`/api/telegram?${q}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
        }
        const ext = res.headers.get("X-Sticker-Ext") ?? "webm";
        out[index] = { ext, blob: await res.blob() };
      } catch (e) {
        errors.push(`${file.filename}: ${(e as Error).message}`);
      }
      onProgress({ done: ++done, total: files.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  const converted = out.filter((f) => f !== null);
  return { files: converted.map((f, i) => ({ filename: `${i + 1}.${f.ext}`, blob: f.blob })), errors };
}

export async function zipStickers(files: StickerResult["files"]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.filename] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: "application/zip" });
}
