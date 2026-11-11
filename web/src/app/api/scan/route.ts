// 페이지를 받아 선택자에 맞는 이미지·영상 주소 목록을 돌려준다.
// 브라우저는 다른 사이트(카카오 등)의 HTML 을 직접 읽을 수 없어서(CORS) 여기서 대신 읽는다.
import { SelectorError, extractMedia } from "@/lib/server/extract";
import { INSTAGRAM_IMAGES, INSTAGRAM_VIDEOS, instagramItems, pickInstagram } from "@/lib/server/instagram";
import { loadPage } from "@/lib/server/page";
import { FetchError } from "@/lib/server/safe-fetch";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url")?.trim();
  const selector = params.get("selector")?.trim();
  if (!url || !selector) return Response.json({ error: "url 과 selector 가 필요합니다." }, { status: 400 });

  try {
    const { html, finalUrl, instagram } = await loadPage(url);
    // 인스타그램 게시물에서 "게시물의 사진/영상" 을 골랐으면 퍼가기 페이지의 데이터를 그대로 쓴다
    if (instagram && (selector.includes(INSTAGRAM_IMAGES) || selector.includes(INSTAGRAM_VIDEOS))) {
      const { items, title } = instagramItems(html);
      return Response.json({ url: finalUrl, title, urls: pickInstagram(items, selector) });
    }
    const { urls, title } = extractMedia(html, finalUrl, selector);
    return Response.json({ url: finalUrl, title, urls });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof SelectorError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "페이지를 읽지 못했습니다." }, { status: 500 });
  }
}
