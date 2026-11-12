// 페이지 HTML 을 받는다. 인스타그램·X·스레드 게시물이면 로그인 없이 볼 수 있는 퍼가기 데이터를 대신 읽는다.
import "server-only";
import { detectPost, postBlockedMessage, postSource, postUserAgent } from "@/lib/server/post";
import { FetchError, readLimited, safeFetch } from "@/lib/server/safe-fetch";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export async function loadPage(url: string) {
  const post = detectPost(url);
  const target = post ? postSource(post) : url;
  let res: Response;
  try {
    res = await safeFetch(target, { userAgent: post ? postUserAgent(post) : undefined });
  } catch (e) {
    // 앱에서는 되는데 웹 서버(Vercel)만 막히는 경우: 앱에서 받으라고 알린다
    if (post && e instanceof FetchError && /HTTP (401|403|429)/.test(e.message)) {
      throw new FetchError(postBlockedMessage(post), 422);
    }
    throw e;
  }
  const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE_BYTES));
  return { html, finalUrl: res.url || target, post };
}
