"use client";

import { useState } from "react";
import { ElementPicker, usePageScan } from "@/components/element-picker";
import { ErrorBox, PasteButton, Segmented, buttonPrimary, hintText, inputBox, labelText } from "@/components/ui";
import type { CollectInput, Media } from "@/lib/collect";

const MEDIA_OPTIONS: { value: Media; label: string }[] = [
  { value: "image", label: "이미지" },
  { value: "video", label: "영상" },
  { value: "all", label: "둘 다" },
];

const isPageUrl = (value: string) => {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
};

/** 일반 페이지 입력: 주소 → 페이지에 있는 요소 묶음에서 고르기 (또는 CSS 선택자 직접 입력) */
export function GeneralForm({ onSubmit }: { onSubmit: (input: CollectInput) => void }) {
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<Media>("image");
  const [error, setError] = useState<string | null>(null);
  const scan = usePageScan();

  const urlValid = isPageUrl(url);
  const selector = scan.selectorFor(media);
  const ready = urlValid && selector !== "" && (scan.manual || (!scan.needsScan(url) && scan.phase.kind === "loaded"));

  const startScan = (target = url) => {
    setError(null);
    void scan.scan(target, media);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // 주소 칸에서 엔터를 누르면 받기 전에 먼저 페이지를 살펴본다
    if (!scan.manual && urlValid && scan.needsScan(url)) return startScan();
    if (ready) onSubmit({ url: url.trim(), selector, media });
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
            onKeyDown={(e) => {
              // 가져오기 버튼이 꺼져 있으면 엔터로 폼이 제출되지 않아서 여기서 직접 살펴보기를 시작한다
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !scan.manual && urlValid && scan.needsScan(url)) {
                e.preventDefault();
                startScan();
              }
            }}
            className={inputBox}
          />
          <PasteButton
            onPaste={(text) => {
              setUrl(text);
              setError(null);
              if (isPageUrl(text) && !scan.manual && scan.needsScan(text)) startScan(text);
            }}
            onError={setError}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className={labelText}>받을 종류</span>
        <Segmented
          name="media"
          value={media}
          options={MEDIA_OPTIONS}
          onChange={(m) => {
            setMedia(m);
            scan.fit(m);
          }}
        />
        {media !== "image" && (
          <span className={hintText}>
            영상은 직접 링크된 mp4·webm·mov만 받습니다. 스트리밍(m3u8)이나 DRM 영상은 받을 수 없습니다.
          </span>
        )}
      </div>
      <ElementPicker scan={scan} media={media} canScan={urlValid} url={url} onScan={() => startScan()} />
      <p className={hintText}>
        자바스크립트로 그리는 페이지는 웹에서 찾지 못할 수 있습니다. 그런 페이지는 iOS 앱에서 받아 주세요.
      </p>
      {error && <ErrorBox message={error} />}
      <button type="submit" disabled={!ready} className={`${buttonPrimary} w-full`}>
        가져오기
      </button>
    </form>
  );
}
