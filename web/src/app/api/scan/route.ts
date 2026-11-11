// 페이지를 받아 선택자에 맞는 이미지·영상 주소 목록을 돌려준다.
// 브라우저는 다른 사이트(카카오 등)의 HTML 을 직접 읽을 수 없어서(CORS) 여기서 대신 읽는다.
import { SelectorError, extractMedia } from "@/lib/server/extract";
import { FetchError, readLimited, safeFetch } from "@/lib/server/safe-fetch";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url")?.trim();
  const selector = params.get("selector")?.trim();
  if (!url || !selector) return Response.json({ error: "url 과 selector 가 필요합니다." }, { status: 400 });

  try {
    const res = await safeFetch(url);
    const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE_BYTES));
    const finalUrl = res.url || url;
    const { urls, title } = extractMedia(html, finalUrl, selector);
    return Response.json({ url: finalUrl, title, urls });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof SelectorError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "페이지를 읽지 못했습니다." }, { status: 500 });
  }
}
