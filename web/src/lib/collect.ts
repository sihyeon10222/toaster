// 브라우저에서 돌아가는 수집 과정: 페이지 분석(/api/scan) → 파일 받기(/api/file) → 형식 판별·중복 제거 → zip.
// 예전에는 따로 띄운 파이썬 서버가 하던 일이다.
import { zipSync } from "fflate";
import { loopForever } from "@/lib/animation";
import { imageLook, smallerDuplicates, type ImageLook } from "@/lib/image-look";
import { EXT_BY_TYPE, sniffType } from "@/lib/sniff";

/** 받을 종류. video 는 직접 링크된 mp4/webm/mov 등만 (스트리밍·DRM 미지원) */
export type Media = "image" | "video" | "all";
export type JobStatus = "fetching" | "downloading" | "done" | "failed";

export interface CollectInput {
  url: string;
  selector: string;
  media: Media;
}

export interface CollectedFile {
  kind: "image" | "video";
  filename: string;
  /** 화면에 보여 줄 blob: 주소 (움직이는 그림은 무한 반복하도록 고친 사본) */
  url: string;
  blob: Blob;
  source_url: string;
  content_type: string;
  size: number;
}

export interface Job {
  url: string;
  title: string;
  status: JobStatus;
  total: number;
  processed: number;
  images: CollectedFile[];
  errors: string[];
  error: string | null;
}

const CONCURRENCY = 6;

const wanted = (type: string, media: Media) => media === "all" || (media === "video") === type.startsWith("video/");

async function errorText(res: Response) {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- 수집

/**
 * 페이지를 분석하고 파일을 모두 받는다. 진행될 때마다 onUpdate 로 현재 상태를 넘긴다.
 * 실패해도 throw 하지 않고 status: "failed" 로 끝난다.
 */
export async function collect(input: CollectInput, onUpdate: (job: Job) => void, signal?: AbortSignal): Promise<Job> {
  let job: Job = {
    url: input.url,
    title: "",
    status: "fetching",
    total: 0,
    processed: 0,
    images: [],
    errors: [],
    error: null,
  };
  const emit = (patch: Partial<Job>) => {
    job = { ...job, ...patch };
    onUpdate(job);
  };
  emit({});

  // 1) 페이지 분석
  let urls: string[];
  let pageUrl = input.url;
  try {
    const q = new URLSearchParams({ url: input.url, selector: input.selector });
    const res = await fetch(`/api/scan?${q}`, { signal });
    if (!res.ok) throw new Error(await errorText(res));
    const data: { url: string; title: string; urls: string[] } = await res.json();
    urls = data.urls;
    pageUrl = data.url;
    emit({ url: data.url, title: data.title });
  } catch (e) {
    emit({ status: "failed", error: signal?.aborted ? "취소했습니다." : (e as Error).message || "서버에 연결하지 못했습니다." });
    return job;
  }
  if (urls.length === 0) {
    emit({ status: "failed", error: "선택자에 맞는 이미지·영상을 찾지 못했습니다." });
    return job;
  }

  // 2) 파일 받기 (병렬). 번호는 페이지 순서대로 매긴다.
  emit({ status: "downloading", total: urls.length });
  const width = Math.max(3, String(urls.length).length);
  const results: (CollectedFile | null)[] = new Array(urls.length).fill(null);
  const looks: (ImageLook | null)[] = new Array(urls.length).fill(null);
  const seen = new Set<string>();
  const errors: string[] = [];
  let processed = 0;
  let next = 0;

  const worker = async () => {
    while (next < urls.length && !signal?.aborted) {
      const index = next++;
      const url = urls[index];
      try {
        const q = new URLSearchParams({ url, referer: pageUrl });
        const res = await fetch(`/api/file?${q}`, { signal, cache: "no-store" });
        if (!res.ok) throw new Error(await errorText(res));
        const bytes = new Uint8Array(await res.arrayBuffer());
        const type = sniffType(bytes);
        if (!type) throw new Error("이미지나 영상이 아닙니다");
        const hash = await sha256(bytes);
        // 고르지 않은 종류이거나, 같은 파일이 다른 주소로 또 나온 경우는 조용히 건너뛴다
        if (wanted(type, input.media) && !seen.has(hash)) {
          seen.add(hash);
          const blob = new Blob([bytes as BlobPart], { type });
          results[index] = {
            kind: type.startsWith("video/") ? "video" : "image",
            filename: `${String(index + 1).padStart(width, "0")}${EXT_BY_TYPE[type]}`,
            url: URL.createObjectURL(new Blob([loopForever(bytes, type) as BlobPart], { type })),
            blob,
            source_url: url,
            content_type: type,
            size: bytes.byteLength,
          };
          if (type.startsWith("image/")) looks[index] = await imageLook(blob);
        }
      } catch (e) {
        if (!signal?.aborted) errors.push(`${url}: ${(e as Error).message}`);
      }
      processed++;
      emit({ processed, images: results.filter((f): f is CollectedFile => f !== null), errors: [...errors] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  // 같은 그림이 크기만 다르게 여러 번 나왔으면 가장 큰 것만 남긴다
  for (const drop of smallerDuplicates(looks)) {
    const file = results[drop];
    if (file) URL.revokeObjectURL(file.url);
    results[drop] = null;
  }
  const images = results.filter((f): f is CollectedFile => f !== null);
  emit({
    status: images.length > 0 ? "done" : "failed",
    images,
    error: images.length > 0 ? null : signal?.aborted ? "취소했습니다." : "받은 파일이 없습니다.",
  });
  return job;
}

/** 받은 파일을 zip 하나로 묶는다 (이미 압축된 형식이라 다시 압축하지 않는다) */
export async function makeZip(files: CollectedFile[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.filename] = new Uint8Array(await f.blob.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: "application/zip" });
}
