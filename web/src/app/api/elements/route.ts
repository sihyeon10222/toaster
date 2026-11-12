// 페이지를 받아 그 안의 이미지·영상을 묶음으로 돌려준다 ("찾을 요소" 고르기).
// 선택자를 모르는 사람도 미리보기를 보고 고를 수 있게 한다. (iOS 앱은 기기 안에서 같은 일을 한다)
import { scanElements, type ElementGroup } from "@/lib/server/extract";
import { INSTAGRAM_IMAGES, INSTAGRAM_VIDEOS, instagramItems } from "@/lib/server/instagram";
import { STREAM_TOKEN, isPlaylist, streamUrlsInPage } from "@/lib/hls-urls";
import { loadPage } from "@/lib/server/page";
import { FetchError } from "@/lib/server/safe-fetch";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url) return Response.json({ error: "url 이 필요합니다." }, { status: 400 });

  try {
    const { html, finalUrl, instagram } = await loadPage(url);
    if (instagram) {
      // 인스타그램은 게시물 안의 사진·영상을 두 묶음으로 보여 준다
      const { items } = instagramItems(html);
      if (items.length === 0) {
        return Response.json(
          { error: "인스타그램이 웹 서버에는 이 게시물을 보여 주지 않았습니다. 아이폰·아이패드·맥 앱에서 받아 주세요." },
          { status: 422 },
        );
      }
      const groups: ElementGroup[] = [];
      const photos = items.filter((i) => !i.isVideo);
      const videos = items.filter((i) => i.isVideo);
      if (photos.length > 0) {
        groups.push({
          selector: INSTAGRAM_IMAGES, isVideo: false, count: photos.length, isEverything: true,
          previews: photos.slice(0, 4).map((i) => i.preview), label: "게시물의 사진",
        });
      }
      if (videos.length > 0) {
        groups.push({
          selector: INSTAGRAM_VIDEOS, isVideo: true, count: videos.length, isEverything: true,
          previews: videos.slice(0, 4).map((i) => i.preview).filter(Boolean), label: "게시물의 영상",
        });
      }
      return Response.json({ url: finalUrl, groups });
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
