"use client";

import { useState } from "react";
import { ErrorBox, Field, PasteButton, Segmented, buttonPrimary, inputBox, labelText } from "@/components/ui";
import type { CollectInput, Media } from "@/lib/collect";

const MEDIA_OPTIONS: { value: Media; label: string }[] = [
  { value: "image", label: "이미지" },
  { value: "video", label: "영상" },
  { value: "all", label: "둘 다" },
];

/** 일반 페이지 입력: 주소 + CSS 선택자 */
export function GeneralForm({ onSubmit }: { onSubmit: (input: CollectInput) => void }) {
  const [url, setUrl] = useState("");
  const [selector, setSelector] = useState("img");
  const [media, setMedia] = useState<Media>("image");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ url: url.trim(), selector: selector.trim(), media });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="page-url" className={labelText}>
          페이지 주소
        </label>
        <div className="flex gap-2">
          <input
            id="page-url"
            type="url"
            required
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            className={inputBox}
          />
          <PasteButton
            onPaste={(text) => {
              setUrl(text);
              setError(null);
            }}
            onError={setError}
          />
        </div>
      </div>
      <Field label="찾을 요소" hint="CSS 선택자입니다. 감싸는 요소를 고르면 안쪽 이미지·영상까지 찾습니다.">
        <input
          required
          spellCheck={false}
          placeholder="img.emoticon, div.thumb img"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
          className={`${inputBox} font-mono text-sm`}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className={labelText}>받을 종류</span>
        <Segmented name="media" value={media} options={MEDIA_OPTIONS} onChange={setMedia} />
        {media !== "image" && (
          <span className="text-[13px] leading-relaxed text-muted">
            영상은 직접 링크된 mp4·webm·mov만 받습니다. 스트리밍(m3u8)이나 DRM 영상은 받을 수 없습니다.
          </span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">
        자바스크립트로 그리는 페이지는 웹에서 찾지 못할 수 있습니다. 그런 페이지는 iOS 앱에서 받아 주세요.
      </p>
      {error && <ErrorBox message={error} />}
      <button type="submit" className={`${buttonPrimary} w-full`}>
        가져오기
      </button>
    </form>
  );
}
