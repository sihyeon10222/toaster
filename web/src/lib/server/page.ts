// 페이지 HTML 을 받는다. 인스타그램 게시물·릴스면 로그인 없이 볼 수 있는 퍼가기 페이지를 대신 읽는다.
import "server-only";
import { instagramCode, instagramEmbedUrl } from "@/lib/server/instagram";
import { readLimited, safeFetch } from "@/lib/server/safe-fetch";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export async function loadPage(url: string) {
  const code = instagramCode(url);
  const target = code ? instagramEmbedUrl(code) : url;
  const res = await safeFetch(target);
  const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE_BYTES));
  return { html, finalUrl: res.url || target, instagram: code !== null };
}
