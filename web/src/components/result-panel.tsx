"use client";

import { useState } from "react";
import { CheckIcon, DownloadIcon, ExternalIcon, SendIcon, Spinner } from "@/components/icons";
import { ErrorBox, Segmented, buttonPrimary, buttonSecondaryLg, iconButton } from "@/components/ui";
import type { CollectedFile, JobStatus } from "@/lib/collect";
import { saveBlob } from "@/lib/download";
import type { StickerProgress } from "@/lib/telegram";
import { isRunning, type Entry, type Mode } from "@/lib/use-jobs";

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const extOf = (f: CollectedFile) => f.filename.slice(f.filename.lastIndexOf(".") + 1).toUpperCase();

const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  fetching: { label: "페이지 분석 중", tone: "text-muted" },
  downloading: { label: "받는 중", tone: "text-muted" },
  done: { label: "완료", tone: "text-ok" },
  failed: { label: "실패", tone: "text-danger" },
};

type View = "grid" | "list";
const VIEWS: { value: View; label: string }[] = [
  { value: "grid", label: "썸네일" },
  { value: "list", label: "목록" },
];

const pad = "px-5 sm:px-10";

// ---------------------------------------------------------------- 빈 화면

const STEPS = [
  { n: "1", title: "링크 붙여넣기", body: "이모티콘샵에서 공유한 링크, 또는 아무 페이지 주소" },
  { n: "2", title: "자동으로 수집", body: "페이지에서 이미지와 영상을 모두 찾아 받습니다" },
  { n: "3", title: "한 번에 저장", body: "zip으로 내려받거나 하나씩 골라 저장합니다" },
];

export function EmptyPanel({ mode }: { mode: Mode }) {
  return (
    <div className={`flex min-h-[60vh] flex-col justify-center gap-10 py-14 lg:min-h-dvh ${pad}`}>
      {/* 결과가 들어올 자리를 흐리게 보여 준다 */}
      <div
        aria-hidden="true"
        className="grid grid-cols-4 gap-3 sm:grid-cols-6 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="checker aspect-square rounded-2xl opacity-70" />
        ))}
      </div>
      <div className="flex max-w-xl flex-col gap-2">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.03em] sm:text-[30px]">
          {mode === "kakao" ? "이모티콘 링크를 넣으면 여기에 모입니다" : "페이지 주소를 넣으면 여기에 모입니다"}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          {mode === "kakao"
            ? "받기가 끝나면 미리 보고, 저장 버튼을 눌러 끝주소 이름의 zip 파일로 저장합니다."
            : "찾은 이미지와 영상을 미리 보고 하나씩 또는 zip으로 저장할 수 있습니다."}
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="flex flex-col gap-1.5 rounded-[22px] bg-surface p-5">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">
              {s.n}
            </span>
            <span className="text-[15px] font-semibold">{s.title}</span>
            <span className="text-[13px] leading-relaxed text-muted">{s.body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- 결과

function Stat({ label, value, tone = "" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`text-[22px] font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function SaveButton({ file }: { file: CollectedFile }) {
  return (
    <button
      type="button"
      title="저장"
      aria-label={`${file.filename} 저장`}
      className={iconButton}
      onClick={() => saveBlob(file.blob, file.filename)}
    >
      <DownloadIcon className="size-4" />
    </button>
  );
}

function Tile({ file }: { file: CollectedFile }) {
  return (
    <li className="group animate-fade-in overflow-hidden rounded-2xl bg-surface transition hover:shadow-card">
      <div className="relative">
        {file.kind === "video" ? (
          // 미리보기는 소리 없이 계속 반복 재생한다
          <video src={file.url} autoPlay loop muted playsInline controls className="block aspect-square w-full bg-black object-contain" />
        ) : (
          <a href={file.url} target="_blank" rel="noreferrer" className="checker block aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저가 받은 임의 이미지(blob)라 next/image 대상이 아님 */}
            <img src={file.url} alt={file.filename} loading="lazy" className="h-full w-full object-contain p-3" />
          </a>
        )}
        <div className="glass absolute top-2 right-2 rounded-full p-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <SaveButton file={file} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="truncate font-mono text-xs text-ink">{file.filename}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(file.size)}</span>
      </div>
    </li>
  );
}

function FileTable({ files }: { files: CollectedFile[] }) {
  return (
    <div className="overflow-x-auto rounded-[22px] bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-muted">
            <th className="w-12 py-3 pl-5 font-medium">#</th>
            <th className="py-3 font-medium">파일</th>
            <th className="hidden w-20 py-3 font-medium sm:table-cell">형식</th>
            <th className="w-24 py-3 pr-4 text-right font-medium">크기</th>
            <th className="w-24 py-3 pr-4">
              <span className="sr-only">동작</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => (
            <tr key={f.filename} className="border-b border-line last:border-0">
              <td className="py-2.5 pl-5 text-[13px] text-muted tabular-nums">{i + 1}</td>
              <td className="py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="checker block size-12 shrink-0 overflow-hidden rounded-[10px]">
                    {f.kind === "video" ? (
                      <video src={f.url} autoPlay loop muted playsInline className="h-full w-full bg-black object-contain" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- 브라우저가 받은 임의 이미지(blob)
                      <img src={f.url} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
                    )}
                  </span>
                  <span className="truncate font-mono text-[13px]">{f.filename}</span>
                </div>
              </td>
              <td className="hidden py-2.5 text-[13px] text-muted sm:table-cell">{extOf(f)}</td>
              <td className="py-2.5 pr-4 text-right text-[13px] text-muted tabular-nums">{formatBytes(f.size)}</td>
              <td className="py-2.5 pr-4">
                <div className="flex justify-end gap-0.5">
                  <SaveButton file={f} />
                  <a
                    href={f.source_url}
                    target="_blank"
                    rel="noreferrer"
                    title="원본 주소 열기"
                    aria-label={`${f.filename} 원본 주소 열기`}
                    className={iconButton}
                  >
                    <ExternalIcon className="size-4" />
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultPanel({
  entry,
  saving,
  zipSaved,
  stickersSaved,
  onDownloadZip,
  stickerProgress,
  stickerErrors,
  onDownloadStickers,
}: {
  entry: Entry;
  saving: boolean;
  zipSaved: boolean;
  stickersSaved: boolean;
  onDownloadZip: () => void;
  stickerProgress: StickerProgress | null;
  stickerErrors: string[];
  onDownloadStickers: () => void;
}) {
  const [view, setView] = useState<View>("grid");
  const job = entry.job;
  const files = job?.images ?? [];
  const running = isRunning(entry);
  const videos = files.filter((f) => f.kind === "video").length;
  const status = job ? STATUS[job.status] : STATUS.fetching;

  return (
    <div className="flex flex-col" aria-live="polite">
      {/* 머리: 제목 · 상태 · 숫자 · zip */}
      <header className={`flex flex-col gap-6 pt-8 pb-2 sm:pt-10 ${pad}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className={`inline-flex w-fit items-center gap-1.5 text-[15px] font-semibold ${status.tone}`}>
              {running && <Spinner className="size-3" />}
              {status.label}
            </span>
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.035em] break-all sm:text-[34px]">
              {entry.mode === "kakao" && job?.title ? job.title : entry.title}
            </h1>
            <p className="truncate font-mono text-[13px] text-muted">{job?.url ?? entry.title}</p>
          </div>
          {job?.status === "done" && (
            <div className="flex shrink-0 flex-col gap-2 sm:items-stretch">
              {/* 저장을 마치면 노란 버튼이 투명으로 바뀌어 "됐다"가 보인다 (iOS 앱과 같음) */}
              <button
                type="button"
                onClick={onDownloadZip}
                disabled={saving}
                className={zipSaved ? buttonSecondaryLg : buttonPrimary}
              >
                {saving ? (
                  <Spinner className="size-4" />
                ) : zipSaved ? (
                  <CheckIcon className="size-4 text-ok" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
                {saving ? "저장하는 중…" : zipSaved ? `${entry.zipName} 저장됨` : `${entry.zipName} 저장`}
              </button>
              <button
                type="button"
                onClick={onDownloadStickers}
                disabled={stickerProgress !== null}
                title="512px PNG·WEBP 또는 3초 VP9 WEBM 으로 바꿔 저장합니다"
                className={buttonSecondaryLg}
              >
                {stickerProgress ? (
                  <Spinner className="size-4" />
                ) : stickersSaved ? (
                  <CheckIcon className="size-4 text-ok" />
                ) : (
                  <SendIcon className="size-4" />
                )}
                {stickerProgress
                  ? `스티커로 바꾸는 중 ${stickerProgress.done}/${stickerProgress.total}`
                  : stickersSaved
                    ? "스티커로 저장됨"
                    : "텔레그램 스티커로 저장"}
              </button>
            </div>
          )}
        </div>

        {job && job.status !== "fetching" && !(job.status === "failed" && files.length === 0) && (
          <div className="flex flex-wrap gap-x-10 gap-y-4 rounded-[22px] bg-surface px-5 py-4">
            <Stat label="이미지" value={files.length - videos} />
            <Stat label="영상" value={videos} />
            <Stat label="용량" value={formatBytes(files.reduce((s, f) => s + f.size, 0))} />
            {job.errors.length > 0 && <Stat label="못 받음" value={job.errors.length} tone="text-danger" />}
          </div>
        )}

        {running && (
          <div className="flex items-center gap-3">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              {job && job.total > 0 ? (
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-300"
                  style={{ width: `${(job.processed / job.total) * 100}%` }}
                />
              ) : (
                <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-ink" />
              )}
            </div>
            {job && job.total > 0 && (
              <span className="text-[13px] text-muted tabular-nums">
                {job.processed} / {job.total}
              </span>
            )}
          </div>
        )}
      </header>

      <div className={`flex flex-col gap-5 py-7 ${pad}`}>
        {job?.error && <ErrorBox message={job.error} />}
        {stickerErrors.length > 0 && (
          <details className="rounded-[22px] bg-surface px-5 py-4 text-sm text-danger">
            <summary className="cursor-pointer font-medium">스티커로 바꾸지 못한 파일 {stickerErrors.length}개</summary>
            <ul className="mt-3 flex flex-col gap-1 font-mono text-xs">
              {stickerErrors.map((e) => (
                <li key={e} className="break-all">
                  {e}
                </li>
              ))}
            </ul>
          </details>
        )}

        {files.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[20px] font-bold">파일 {files.length}개</h2>
              <div className="w-44">
                <Segmented name={`view-${entry.key}`} value={view} options={VIEWS} onChange={setView} size="sm" />
              </div>
            </div>
            {view === "grid" ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
                {files.map((f) => (
                  <Tile key={f.filename} file={f} />
                ))}
              </ul>
            ) : (
              <FileTable files={files} />
            )}
          </>
        )}

        {job && job.errors.length > 0 && (
          <details className="rounded-[22px] bg-surface px-5 py-4 text-sm">
            <summary className="cursor-pointer font-medium">받지 못한 파일 {job.errors.length}개</summary>
            <ul className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted">
              {job.errors.map((e) => (
                <li key={e} className="break-all">
                  {e}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
