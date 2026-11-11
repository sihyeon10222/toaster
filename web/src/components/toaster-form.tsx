"use client";

import { useEffect, useRef, useState } from "react";
import { createJob, getJob, isFinished, type Job } from "@/lib/toaster";

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "대기 중",
  fetching: "페이지 읽는 중",
  downloading: "이미지 받는 중",
  done: "완료",
  failed: "실패",
};

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ToasterForm() {
  const [url, setUrl] = useState("");
  const [selector, setSelector] = useState("img");
  const [render, setRender] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const poll = (id: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const next = await getJob(id);
        setJob(next);
        if (!isFinished(next)) poll(id);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 800);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pollRef.current) clearTimeout(pollRef.current);
    setError(null);
    setJob(null);
    setSubmitting(true);
    try {
      const created = await createJob({ url: url.trim(), selector: selector.trim(), render });
      setJob(created);
      poll(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const running = job !== null && !isFinished(job);
  const progress = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

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
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-amber-500 dark:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">HTML 태그 / CSS 선택자</span>
          <input
            required
            placeholder="img.emoticon, div.thumb img"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-amber-500 dark:border-white/20"
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

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {job && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">{STATUS_LABEL[job.status]}</span>
              {job.total > 0 && (
                <span className="opacity-60">
                  {" "}
                  · {job.images.length}장 받음 / 후보 {job.total}개
                </span>
              )}
            </div>
            {job.zip_url && (
              <a
                href={job.zip_url}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                전체 zip 다운로드
              </a>
            )}
          </div>

          {running && (
            <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${job.total ? progress : 10}%` }} />
            </div>
          )}

          {job.error && <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>}

          {job.images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {job.images.map((img) => (
                <li key={img.filename} className="group overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                  <a href={img.url} target="_blank" rel="noreferrer" className="block aspect-square bg-black/5 dark:bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 서버가 주는 임의 이미지라 next/image 최적화 대상이 아님 */}
                    <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-contain" />
                  </a>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <span className="truncate font-mono opacity-70">{img.filename}</span>
                    <span className="shrink-0 opacity-50">{formatBytes(img.size)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {job.errors.length > 0 && (
            <details className="text-xs opacity-70">
              <summary className="cursor-pointer">받지 못한 이미지 {job.errors.length}개</summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono">
                {job.errors.map((e) => (
                  <li key={e} className="break-all">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
