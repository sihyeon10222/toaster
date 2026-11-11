"use client";

import { useState } from "react";
import { VideoClipper } from "@/components/video-clipper";
import type { Job } from "@/lib/toaster";

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "대기 중",
  fetching: "페이지 읽는 중",
  downloading: "파일 받는 중",
  done: "완료",
  failed: "실패",
};

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

interface Props {
  job: Job;
  /** zip 버튼 영역을 바꾸고 싶을 때 (예: 이름 붙여 받기). 없으면 서버 zip 링크. */
  zipAction?: React.ReactNode;
}

function summary(job: Job) {
  const videos = job.images.filter((f) => f.kind === "video").length;
  const images = job.images.length - videos;
  if (!videos) return `이미지 ${images}개`;
  if (!images) return `영상 ${videos}개`;
  return `이미지 ${images}개, 영상 ${videos}개`;
}

export function JobResult({ job, zipAction }: Props) {
  const [clipping, setClipping] = useState<string | null>(null);
  const clipFile = job.images.find((f) => f.filename === clipping && f.kind === "video");
  const running = job.status !== "done" && job.status !== "failed";
  const progress = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 10;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold">{STATUS_LABEL[job.status]}</span>
          {job.total > 0 && (
            <span className="opacity-60">
              {" "}
              · {summary(job)} 받음 / 후보 {job.total}개
            </span>
          )}
        </div>
        {job.zip_url &&
          (zipAction ?? (
            <a
              href={job.zip_url}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              전체 zip 다운로드
            </a>
          ))}
      </div>

      {running && (
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {job.error && <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>}

      {clipFile && <VideoClipper key={clipFile.url} file={clipFile} onClose={() => setClipping(null)} />}

      {job.images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {job.images.map((img) => (
            <li key={img.filename} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
              {img.kind === "video" ? (
                <video
                  src={img.url}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="block aspect-square w-full bg-black object-contain"
                />
              ) : (
                <a href={img.url} target="_blank" rel="noreferrer" className="block aspect-square bg-black/5 dark:bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 서버가 주는 임의 이미지라 next/image 최적화 대상이 아님 */}
                  <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-contain" />
                </a>
              )}
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                <a href={img.url} target="_blank" rel="noreferrer" className="truncate font-mono opacity-70 hover:underline">
                  {img.kind === "video" ? "🎬 " : ""}
                  {img.filename}
                </a>
                <span className="shrink-0 opacity-50">{formatBytes(img.size)}</span>
              </div>
              {img.kind === "video" && (
                <button
                  type="button"
                  onClick={() => setClipping(img.filename)}
                  aria-pressed={clipping === img.filename}
                  className={`w-full border-t border-black/10 px-2.5 py-1.5 text-xs font-medium transition dark:border-white/15 ${
                    clipping === img.filename ? "bg-amber-500 text-black" : "hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  ✂️ 구간 자르기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {job.errors.length > 0 && (
        <details className="text-xs opacity-70">
          <summary className="cursor-pointer">받지 못한 파일 {job.errors.length}개</summary>
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
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
