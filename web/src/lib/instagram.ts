// 인스타그램 게시물·릴스 주소 판별 (브라우저·서버가 같이 쓴다). 실제로 읽는 일은 lib/server/instagram.ts.

/** "찾을 요소" 대신 쓰는 이름표. CSS 에 없는 모양이라 진짜 선택자와 헷갈리지 않는다. */
export const INSTAGRAM_IMAGES = ":instagram-image";
export const INSTAGRAM_VIDEOS = ":instagram-video";

/** 게시물·릴스 주소에서 게시물 코드를 뽑는다. 인스타그램 게시물이 아니면 null. */
export function instagramCode(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?instagram\.com$/i.test(url.hostname)) return null;
  // /p/코드, /reel/코드, /reels/코드, /tv/코드, 앞에 /사용자이름/ 이 붙기도 한다
  const m = url.pathname.match(/^\/(?:[^/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
