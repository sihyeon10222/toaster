// 이미지·영상 하나를 대신 받아 그대로 흘려보낸다.
// 카카오 이미지 서버는 다른 사이트에서 파일 내용을 읽는 걸 허용하지 않아서(CORS) 브라우저가 직접 zip 으로 묶을 수 없다.
import { FetchError, limitStream, safeFetch } from "@/lib/server/safe-fetch";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const referer = params.get("referer") ?? undefined;
  if (!url) return Response.json({ error: "url 이 필요합니다." }, { status: 400 });

  try {
    const res = await safeFetch(url, { referer });
    if (Number(res.headers.get("content-length")) > MAX_FILE_BYTES) {
      return Response.json({ error: "파일이 너무 큽니다." }, { status: 413 });
    }
    if (!res.body) return new Response(null, { status: 204 });
    return new Response(limitStream(res.body, MAX_FILE_BYTES), {
      headers: {
        // 실제 형식은 브라우저가 바이트로 다시 판별한다 (lib/collect.ts sniffType)
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    if (e instanceof FetchError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "파일을 받지 못했습니다." }, { status: 500 });
  }
}
