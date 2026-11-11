"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { ErrorBox, PasteButton, buttonPrimary, hintText, labelText } from "@/components/ui";
import { KAKAO_LINK_PLACEHOLDER, kakaoEmoticonUrl, parseKakaoSlug } from "@/lib/kakao";

/** 카카오 이모티콘 입력: https://e.kakao.com/ 이모티콘샵 링크만 */
export function KakaoForm({ onSubmit }: { onSubmit: (slug: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preview = parseKakaoSlug(input);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = parseKakaoSlug(input);
    if (!slug) {
      setError("https://e.kakao.com/ 으로 시작하는 이모티콘샵 링크만 받을 수 있습니다. 카카오톡 이모티콘샵에서 공유 → 링크 복사한 주소를 넣어 주세요.");
      return;
    }
    setError(null);
    onSubmit(slug);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="kakao-link" className={labelText}>
          이모티콘 링크
        </label>
        <div className="flex gap-2">
          <div className="flex h-12 min-w-0 flex-1 items-stretch overflow-hidden rounded-xl border border-line-strong bg-bg transition focus-within:border-ink/60 focus-within:ring-4 focus-within:ring-accent/50">
            <input
              id="kakao-link"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={KAKAO_LINK_PLACEHOLDER}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-ink outline-none placeholder:text-muted/70"
            />
            {preview && <CheckIcon className="mr-3.5 size-4 shrink-0 self-center text-ok" />}
          </div>
          <PasteButton
            onPaste={(text) => {
              setInput(text);
              setError(parseKakaoSlug(text) ? null : "복사한 내용이 https://e.kakao.com/ 이모티콘 링크가 아닙니다.");
            }}
            onError={setError}
          />
        </div>
        <span className={hintText}>
          {preview ? (
            <>
              <span className="font-mono text-ink">{kakaoEmoticonUrl(preview)}</span> 에서 받습니다.
            </>
          ) : (
            "카카오톡 이모티콘샵에서 공유 → 링크 복사 후 오른쪽 붙여넣기 버튼을 누르세요."
          )}
        </span>
      </div>

      {error && <ErrorBox message={error} />}

      <button type="submit" className={`${buttonPrimary} w-full`}>
        이모티콘 받기
      </button>
    </form>
  );
}
