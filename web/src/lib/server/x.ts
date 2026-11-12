// X(트위터) 게시물. 게시물 페이지는 로그인 창과 자바스크립트로 그려서 그대로는 사진·영상이 없다.
// 대신 X 공식 퍼가기 위젯(platform.twitter.com/embed)이 읽는 공개 데이터를 같은 방법으로 읽는다.
// iOS 앱의 XPost.swift 와 같은 규칙이다.
//
//   cdn.syndication.twimg.com/tweet-result?id=번호&token=… → JSON
//   mediaDetails[]: type photo → media_url_https (?name=orig 가 원본 크기)
//                   type video / animated_gif → video_info.variants 중 받기 크기 제한 안에 드는 가장 좋은 mp4
import "server-only";
import type { PostItem } from "@/lib/server/post";
import { safeFetch } from "@/lib/server/safe-fetch";

/** /api/file 과 앱의 받기 크기 제한 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** 퍼가기 위젯이 붙이는 token 값: (번호 / 1e15 * π) 를 36진수로 쓰고 0 과 점을 뺀 것 */
export const xToken = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

export const xDataUrl = (id: string) => `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${xToken(id)}`;

type Variant = { url?: string; content_type?: string; bitrate?: number };
type Media = {
  media_url_https?: string;
  video_info?: { variants?: Variant[] };
};
type Tweet = { __typename?: string; id_str?: string; user?: { screen_name?: string }; mediaDetails?: Media[] };

/** pbs.twimg.com 그림 주소에 크기를 붙인다 (orig = 원본, small = 미리보기) */
const sized = (base: string, name: string) => `${base}${base.includes("?") ? "&" : "?"}name=${name}`;

/** 첫 1바이트만 요청해서 Content-Range 의 전체 크기를 읽는다. 알 수 없으면 null. */
async function fileSize(url: string): Promise<number | null> {
  try {
    const res = await safeFetch(url, { range: "bytes=0-0" });
    await res.body?.cancel();
    const total = res.headers.get("content-range")?.split("/").pop();
    if (total && /^\d+$/.test(total)) return Number(total);
    return res.status === 200 ? Number(res.headers.get("content-length")) || null : null;
  } catch {
    return null;
  }
}

/**
 * 가장 좋은 영상. bitrate 가 큰 mp4 부터 실제 파일 크기를 확인해 받기 크기 제한(100MB) 안에 드는 첫 번째를 고른다.
 * (bitrate 값은 화질 이름표에 가까워 실제 크기와 많이 다르다)
 * 모두 너무 크면 스트리밍(m3u8)으로 받는다 (lib/hls.ts 가 가장 큰 화질을 골라 조각으로 받으므로 크기 제한이 더 크다).
 */
export async function bestVariant(variants: Variant[]): Promise<string | null> {
  const mp4 = variants.filter((v) => v.url && v.content_type === "video/mp4").sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  for (const v of mp4) {
    // 크기를 알 수 없으면 일단 받아 본다
    const size = await fileSize(v.url!);
    if (size === null || size <= MAX_FILE_BYTES) return v.url!;
  }
  return variants.find((v) => v.url && v.content_type === "application/x-mpegURL")?.url ?? mp4[0]?.url ?? null;
}

/** 게시물의 사진·영상을 순서대로 모은다. 영상은 화질마다 실제 파일 크기를 확인해서 고른다. */
export async function xItems(json: string): Promise<{ items: PostItem[]; title: string }> {
  let tweet: Tweet;
  try {
    tweet = JSON.parse(json);
  } catch {
    return { items: [], title: "" };
  }
  if (tweet?.__typename !== "Tweet" && !tweet?.id_str) return { items: [], title: "" };
  const found = await Promise.all(
    (tweet.mediaDetails ?? []).map(async (m): Promise<PostItem | null> => {
      const base = m.media_url_https;
      if (!base) return null;
      const preview = sized(base, "small");
      if (m.video_info) {
        const url = await bestVariant(m.video_info.variants ?? []);
        return url ? { url, isVideo: true, preview } : null;
      }
      return { url: sized(base, "orig"), isVideo: false, preview };
    }),
  );
  const user = tweet.user?.screen_name;
  return { items: found.filter((i) => i !== null), title: user ? `@${user}` : "" };
}
