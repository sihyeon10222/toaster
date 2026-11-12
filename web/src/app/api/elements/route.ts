// 페이지를 받아 그 안의 이미지·영상을 묶음으로 돌려준다 ("찾을 요소" 고르기).
// 선택자를 모르는 사람도 미리보기를 보고 고를 수 있게 한다. (iOS 앱은 기기 안에서 같은 일을 한다)
import { scanElements, type ElementGroup } from "@/lib/server/extract";
import { postEmptyMessage, postGroups, postItems } from "@/lib/server/post";
import { STREAM_TOKEN, isPlaylist, streamUrlsInPage } from "@/lib/hls-urls";
import { loadPage } from "@/lib/server/page";
import { FetchError } from "@/lib/server/safe-fetch";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url) return Response.json({ error: "url 이 필요합니다." }, { status: 400 });

  try {
    const { html, finalUrl, post } = await loadPage(url);
    if (post) {
      // 인스타그램·X·스레드 게시물은 안의 사진·영상을 두 묶음으로 보여 준다
      const { items } = await postItems(post, html);
      if (items.length === 0) return Response.json({ error: postEmptyMessage(post) }, { status: 422 });
      return Response.json({ url: finalUrl, groups: postGroups(post, items) });
    }
    const stream = (count: number, label: string): ElementGroup => ({
      selector: STREAM_TOKEN, isVideo: true, count, previews: [], isEverything: false, label,
    });
    // 붙여 넣은 주소가 .m3u8 재생 목록이면 그 영상 하나
    if (isPlaylist(html.slice(0, 64))) return Response.json({ url: finalUrl, groups: [stream(1, "스트리밍 영상 (m3u8)")] });
    const groups = scanElements(html, finalUrl);
    // 자바스크립트 플레이어가 쓰는 스트리밍 영상(.m3u8) 주소가 페이지에 있으면 따로 한 묶음
    const streams = streamUrlsInPage(html).length;
    if (streams > 0) {
      const everything = groups.filter((g) => g.isEverything).length;
      groups.splice(everything, 0, stream(streams, "페이지 속 스트리밍 영상 (m3u8)"));
    }
    return Response.json({ url: finalUrl, groups });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "페이지를 읽지 못했습니다." }, { status: 500 });
  }
}
