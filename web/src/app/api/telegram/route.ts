// 이미지·GIF·영상 하나를 받아 텔레그램 스티커 규격(PNG/WEBP 512px 또는 VP9 WEBM 3초·256KB)으로 바꿔 돌려준다.
// 변환에 ffmpeg 와 sharp 가 필요해서 브라우저가 아니라 여기서 한다. 원본은 브라우저가 올리지 않고 주소로 다시 받는다
// (Vercel 함수는 요청 본문이 4.5MB 로 제한돼 큰 영상을 올릴 수 없다).
import { FetchError, readLimited, safeFetch } from "@/lib/server/safe-fetch";
import { StickerError, toTelegramSticker } from "@/lib/server/telegram";

export const maxDuration = 120;

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const referer = params.get("referer") ?? undefined;
  if (!url) return Response.json({ error: "url 이 필요합니다." }, { status: 400 });

  try {
    const source = await readLimited(await safeFetch(url, { referer }), MAX_SOURCE_BYTES);
    const sticker = await toTelegramSticker(source);
    return new Response(sticker.bytes as BodyInit, {
      headers: {
        "Content-Type": sticker.type,
        "X-Sticker-Ext": sticker.ext,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof StickerError) return Response.json({ error: e.message }, { status: 422 });
    console.error(e);
    return Response.json({ error: "스티커로 바꾸지 못했습니다." }, { status: 500 });
  }
}
