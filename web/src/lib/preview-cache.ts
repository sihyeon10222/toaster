// "찾을 요소" 고르기의 미리보기 그림. /api/file 로 받아 Cache Storage 에 넣어 두고 다시 쓴다.
// 설정의 "캐시 삭제"가 이 저장소를 비운다. (iOS 앱은 URLCache 와 임시 폴더가 같은 역할)
import { loopForever } from "@/lib/animation";
import { sniffType } from "@/lib/sniff";

const CACHE_NAME = "toaster-previews";

// Cache Storage 는 https 나 localhost 에서만 있다. 없으면 캐시 없이 받기만 한다.
const storage = () => (typeof caches === "undefined" ? null : caches);

/** 미리보기 그림의 blob: 주소. 형식을 바이트로 판별해 붙이므로 SVG 도 그대로 보인다. 못 받으면 null. */
export async function loadPreview(url: string, referer: string, signal?: AbortSignal): Promise<string | null> {
  const key = `/api/file?${new URLSearchParams({ url, referer })}`;
  try {
    const cache = await storage()?.open(CACHE_NAME);
    let res = await cache?.match(key);
    if (!res) {
      res = await fetch(key, { signal, cache: "no-store" });
      if (!res.ok) return null;
      await cache?.put(key, res.clone());
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffType(bytes);
    if (!type || !type.startsWith("image/")) return null;
    return URL.createObjectURL(new Blob([loopForever(bytes, type) as BlobPart], { type }));
  } catch {
    return null;
  }
}

/** 미리보기 캐시 크기 (바이트) */
export async function previewCacheBytes(): Promise<number> {
  const s = storage();
  if (!s || !(await s.has(CACHE_NAME))) return 0;
  const cache = await s.open(CACHE_NAME);
  let total = 0;
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) total += (await res.blob()).size;
  }
  return total;
}

export async function clearPreviewCache() {
  await storage()?.delete(CACHE_NAME);
}
