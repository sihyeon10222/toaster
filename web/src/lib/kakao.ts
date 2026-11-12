// 카카오 이모티콘샵 프리셋.
// 이모티콘 목록은 페이지 HTML 에 그대로 들어 있어 브라우저로 렌더링할 필요가 없다.

export const KAKAO_EMOTICON_BASE = "https://e.kakao.com/t/";
// 이모티콘 상세 페이지의 이모티콘 목록. 카카오가 페이지를 개편하면 바꿔야 한다.
export const KAKAO_EMOTICON_SELECTOR = "ul.grid li button img";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** 입력칸에 미리 보여 줄 링크 모양 */
export const KAKAO_LINK_PLACEHOLDER = "https://e.kakao.com/t/…";

/**
 * 이모티콘샵 링크에서 이모티콘 주소 끝부분(slug)을 뽑는다. https://e.kakao.com/ 링크만 받는다.
 *   https://e.kakao.com/t/kakao-friends-classic
 *   https://e.kakao.com/app/t/kakao-friends-classic?t_ch=shared_item
 * 끝주소만 넣거나 다른 주소면 null.
 */
export function parseKakaoSlug(input: string): string | null {
  const value = input.trim();
  if (!/^https?:\/\/e\.kakao\.com\//i.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== "e.kakao.com") return null;
  const match = url.pathname.match(/^\/(?:app\/)?t\/([^/]+)\/?$/);
  let slug: string | null = null;
  try {
    slug = match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null; // %E0%A4 처럼 깨진 주소
  }
  return slug && SLUG_RE.test(slug) ? slug.toLowerCase() : null;
}

export function kakaoEmoticonUrl(slug: string) {
  return KAKAO_EMOTICON_BASE + encodeURIComponent(slug);
}
