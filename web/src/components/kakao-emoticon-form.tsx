"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox, JobResult } from "@/components/job-result";
import { saveFromUrl } from "@/lib/download";
import { KAKAO_EMOTICON_SELECTOR, kakaoEmoticonUrl, parseKakaoSlug } from "@/lib/kakao";
import { useToasterJob } from "@/lib/use-toaster-job";

/** 서버 zip 을 받아 `<slug>.zip` 이름으로 저장. 실패하면 서버 주소로 바로 이동. */
async function saveZip(zipUrl: string, filename: string) {
  try {
    // 서버가 주는 이름(toaster-xxxx.zip) 대신 slug 이름을 쓰기 위해 fallback 이 아닌 고정 이름으로 저장
    await saveFromUrl(zipUrl, filename, { preferFallbackName: true });
  } catch {
    window.location.href = zipUrl;
  }
}

/** 카카오 이모티콘 탭: 링크 끝주소만 넣으면 이모티콘을 모아 zip 으로 저장 */
export function KakaoEmoticonForm() {
  const [input, setInput] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { job, error, submitting, running, start } = useToasterJob();
  const savedFor = useRef<string | null>(null);

  const preview = parseKakaoSlug(input);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseKakaoSlug(input);
    if (!parsed) {
      setInputError("이모티콘 링크나 끝주소를 확인해 주세요. 예) kakao-friends-classic");
      return;
    }
    setInputError(null);
    setSlug(parsed);
    start({ url: kakaoEmoticonUrl(parsed), selector: KAKAO_EMOTICON_SELECTOR, render: true });
  };

  const download = async () => {
    if (!job?.zip_url || !slug) return;
    setSaving(true);
    await saveZip(job.zip_url, `${slug}.zip`);
    setSaving(false);
  };

  // 작업이 끝나면 zip 을 한 번 자동으로 저장
  useEffect(() => {
    if (job?.status === "done" && job.zip_url && slug && savedFor.current !== job.id) {
      savedFor.current = job.id;
      setSaving(true);
      saveZip(job.zip_url, `${slug}.zip`).finally(() => setSaving(false));
    }
  }, [job, slug]);

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">이모티콘 링크 또는 끝주소</span>
          <div className="flex items-center overflow-hidden rounded-lg border border-black/15 focus-within:border-amber-500 dark:border-white/20">
            <span className="hidden shrink-0 bg-black/5 px-3 py-2 font-mono text-sm opacity-60 sm:block dark:bg-white/10">
              e.kakao.com/t/
            </span>
            <input
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="kakao-friends-classic"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setInputError(null);
              }}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm outline-none"
            />
          </div>
          <span className="text-xs opacity-60">
            {preview ? (
              <>
                받을 페이지: <span className="font-mono">{kakaoEmoticonUrl(preview)}</span>
              </>
            ) : (
              "공유 링크를 통째로 붙여 넣어도 돼요."
            )}
          </span>
        </label>
        <button
          type="submit"
          disabled={submitting || running}
          className="rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
        >
          {running ? "이모티콘 굽는 중…" : "이모티콘 zip 받기"}
        </button>
        <p className="text-xs opacity-60">
          이모티콘은 저작권이 있어요. 받은 파일은 개인 소장용으로만 써 주세요.
        </p>
      </form>

      {inputError && <ErrorBox message={inputError} />}
      {error && <ErrorBox message={error} />}
      {job && (
        <JobResult
          job={job}
          zipAction={
            <button
              type="button"
              onClick={download}
              disabled={saving}
              className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
            >
              {saving ? "저장 중…" : `${slug}.zip 다시 받기`}
            </button>
          }
        />
      )}
    </div>
  );
}
