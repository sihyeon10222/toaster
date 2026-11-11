// 페이지를 받아 그 안의 이미지·영상을 묶음으로 돌려준다 ("찾을 요소" 고르기).
// 선택자를 모르는 사람도 미리보기를 보고 고를 수 있게 한다. (iOS 앱은 기기 안에서 같은 일을 한다)
import { scanElements } from "@/lib/server/extract";
import { FetchError, readLimited, safeFetch } from "@/lib/server/safe-fetch";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url) return Response.json({ error: "url 이 필요합니다." }, { status: 400 });

  try {
    const res = await safeFetch(url);
    const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE_BYTES));
    const finalUrl = res.url || url;
    return Response.json({ url: finalUrl, groups: scanElements(html, finalUrl) });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "페이지를 읽지 못했습니다." }, { status: 500 });
  }
}
