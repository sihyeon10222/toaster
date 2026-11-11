// toaster-server API 클라이언트. 서버 응답 모델(app.py의 JobOut)과 맞춰 둔다.

export const API_URL = (process.env.NEXT_PUBLIC_TOASTER_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type JobStatus = "pending" | "fetching" | "downloading" | "done" | "failed";

export interface ToasterImage {
  filename: string;
  url: string;
  source_url: string;
  content_type: string;
  size: number;
}

export interface Job {
  id: string;
  url: string;
  selector: string;
  render: boolean;
  status: JobStatus;
  total: number;
  processed: number;
  images: ToasterImage[];
  errors: string[];
  error: string | null;
  zip_url: string | null;
  created_at: number;
  finished_at: number | null;
}

export const isFinished = (job: Job) => job.status === "done" || job.status === "failed";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(`서버에 연결할 수 없어요 (${API_URL})`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join(", ")
          : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function createJob(input: { url: string; selector: string; render: boolean }) {
  return request<Job>("/jobs", { method: "POST", body: JSON.stringify(input) });
}

export function getJob(id: string) {
  return request<Job>(`/jobs/${id}`);
}
