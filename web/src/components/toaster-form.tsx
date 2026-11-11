"use client";

import { useState } from "react";
import { ErrorBox, JobResult } from "@/components/job-result";
import { useToasterJob } from "@/lib/use-toaster-job";

const inputClass =
  "rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-amber-500 dark:border-white/20";

/** 일반 탭: 아무 페이지 + CSS 선택자 */
export function ToasterForm() {
  const [url, setUrl] = useState("");
  const [selector, setSelector] = useState("img");
  const [render, setRender] = useState(false);
  const { job, error, submitting, running, start } = useToasterJob();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    start({ url: url.trim(), selector: selector.trim(), render });
  };

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">페이지 주소</span>
          <input
            type="url"
            required
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">HTML 태그 / CSS 선택자</span>
          <input
            required
            placeholder="img.emoticon, div.thumb img"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            className={`${inputClass} font-mono text-sm`}
          />
          <span className="text-xs opacity-60">감싸는 요소를 지정하면 안쪽 이미지까지 찾아요.</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={render} onChange={(e) => setRender(e.target.checked)} />
          JS로 그려지는 페이지 (느리지만 더 정확해요)
        </label>
        <button
          type="submit"
          disabled={submitting || running}
          className="rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
        >
          {running ? "굽는 중…" : "이미지 가져오기"}
        </button>
      </form>

      {error && <ErrorBox message={error} />}
      {job && <JobResult job={job} />}
    </div>
  );
}
