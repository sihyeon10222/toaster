// 카카오 이모티콘샵 프리셋.
// 페이지가 JS로 그려지므로 서버의 render 옵션(Chromium)이 필요하다.

export const KAKAO_EMOTICON_BASE = "https://e.kakao.com/t/";
// 이모티콘 상세 페이지의 이모티콘 목록. 카카오가 페이지를 개편하면 바꿔야 한다.
export const KAKAO_EMOTICON_SELECTOR = "ul.grid li button img";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * 사용자가 넣은 값에서 이모티콘 주소 끝부분(slug)을 뽑는다.
 *   kakao-friends-classic
 *   https://e.kakao.com/t/kakao-friends-classic
 *   https://e.kakao.com/app/t/kakao-friends-classic?t_ch=shared_item
 *   e.kakao.com/t/kakao-friends-classic/
 * 형식이 맞지 않으면 null.
 */
export function parseKakaoSlug(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (SLUG_RE.test(value)) return value.toLowerCase();

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.hostname !== "e.kakao.com") return null;
  const match = url.pathname.match(/^\/(?:app\/)?t\/([^/]+)\/?$/);
  const slug = match ? decodeURIComponent(match[1]) : null;
  return slug && SLUG_RE.test(slug) ? slug.toLowerCase() : null;
}

export function kakaoEmoticonUrl(slug: string) {
  return KAKAO_EMOTICON_BASE + encodeURIComponent(slug);
}
