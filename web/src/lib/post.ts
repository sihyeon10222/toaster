// 붙여 넣은 SNS 게시물 주소 판별: 인스타그램·X·스레드 (브라우저·서버가 같이 쓴다). 실제로 읽는 일은 lib/server/post.ts.
// iOS 앱의 Post.swift 와 같은 규칙이다.
import { instagramCode } from "@/lib/instagram";

export type PostKind = "instagram" | "x" | "threads";

export interface Post {
  kind: PostKind;
  /** 인스타그램·스레드는 게시물 코드, X 는 게시물 번호 */
  id: string;
}

const X_HOSTS = /^(www\.|mobile\.)?(x|twitter)\.com$/i;
const THREADS_HOSTS = /^(www\.)?threads\.(com|net)$/i;

/** X 게시물 주소에서 게시물 번호를 뽑는다. X 게시물이 아니면 null. */
export function xId(address: string): string | null {
  const url = parse(address);
  if (!url || !X_HOSTS.test(url.hostname)) return null;
  // /사용자이름/status/번호, /i/status/번호, /i/web/status/번호 (뒤에 /photo/1 등이 붙기도 한다)
  const m = url.pathname.match(/^\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d{1,25})/);
  return m ? m[1] : null;
}

/** 스레드 게시물 주소에서 게시물 코드를 뽑는다. 스레드 게시물이 아니면 null. */
export function threadsCode(address: string): string | null {
  const url = parse(address);
  if (!url || !THREADS_HOSTS.test(url.hostname)) return null;
  // /@사용자이름/post/코드, /t/코드
  const m = url.pathname.match(/^\/(?:@[^/]+\/post|t)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function detectPost(address: string): Post | null {
  const ig = instagramCode(address);
  if (ig) return { kind: "instagram", id: ig };
  const x = xId(address);
  if (x) return { kind: "x", id: x };
  const th = threadsCode(address);
  if (th) return { kind: "threads", id: th };
  return null;
}

/** "찾을 요소" 대신 쓰는 이름표. CSS 에 없는 모양이라 진짜 선택자와 헷갈리지 않는다. */
export const postImagesToken = (post: Post) => `:${post.kind}-image`;
export const postVideosToken = (post: Post) => `:${post.kind}-video`;

/** 받은 파일을 넣을 이름 (instagram_코드, x_번호, threads_코드) */
export const postFolderName = (post: Post) => `${post.kind}_${post.id}`;

export const POST_NAMES: Record<PostKind, string> = { instagram: "인스타그램", x: "X", threads: "스레드" };

function parse(address: string): URL | null {
  try {
    return new URL(address.trim());
  } catch {
    return null;
  }
}
