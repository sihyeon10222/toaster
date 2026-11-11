"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createJob, getJob, isFinished, type Job } from "@/lib/toaster";

const POLL_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 작업을 만들고 끝날 때까지 상태를 폴링하는 공용 훅. */
export function useToasterJob() {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 새 작업을 시작하거나 언마운트되면 번호가 바뀌어 이전 폴링이 멈춘다
  const runRef = useRef(0);

  useEffect(() => () => void runRef.current++, []);

  const start = useCallback(async (input: { url: string; selector: string; render: boolean }) => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    setError(null);
    setJob(null);
    setSubmitting(true);
    try {
      let current = await createJob(input);
      if (!alive()) return;
      setJob(current);
      setSubmitting(false);
      while (!isFinished(current)) {
        await sleep(POLL_MS);
        if (!alive()) return;
        current = await getJob(current.id);
        if (!alive()) return;
        setJob(current);
      }
    } catch (e) {
      if (alive()) setError((e as Error).message);
    } finally {
      if (alive()) setSubmitting(false);
    }
  }, []);

  const running = job !== null && !isFinished(job);
  return { job, error, submitting, running, start };
}
