// 서버 파일을 받아 원하는 이름으로 저장한다.

function filenameFrom(res: Response): string | null {
  const header = res.headers.get("content-disposition");
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : `HTTP ${res.status}`;
}

/**
 * url 을 받아 파일로 저장. 이름은 서버가 준 이름 → fallbackName 순.
 * 실패하면 서버의 오류 메시지로 Error 를 던진다.
 */
export async function saveFromUrl(
  url: string,
  fallbackName: string,
  { preferFallbackName = false }: { preferFallbackName?: boolean } = {},
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("서버에 연결할 수 없어요.");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  const name = preferFallbackName ? fallbackName : (filenameFrom(res) ?? fallbackName);
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  return name;
}
