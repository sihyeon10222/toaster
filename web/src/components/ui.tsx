// 화면 전체에서 같이 쓰는 모양 (버튼·입력칸·알림)
import { AlertIcon, ClipboardIcon } from "@/components/icons";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export const buttonPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-ink " +
  `transition hover:brightness-[.97] active:brightness-95 ${focusRing} ` +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondary =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 " +
  `text-sm font-medium text-ink transition hover:bg-surface-2 ${focusRing} disabled:opacity-50`;

export const buttonSecondaryLg =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-5 text-[15px] font-semibold " +
  `text-ink transition hover:bg-surface-2 ${focusRing} disabled:cursor-wait disabled:opacity-70`;

export const iconButton =
  "inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink " +
  `${focusRing} disabled:opacity-40`;

export const inputBox =
  "h-12 w-full min-w-0 rounded-xl border border-line-strong bg-bg px-4 text-[15px] text-ink outline-none transition " +
  "placeholder:text-muted/70 focus:border-ink/60 focus:ring-4 focus:ring-accent/50";

export const labelText = "text-sm font-semibold text-ink";
export const hintText = "text-[13px] leading-relaxed text-muted";

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className={labelText}>{label}</span>
      {children}
      {hint && <span className={hintText}>{hint}</span>}
    </label>
  );
}

/** 세그먼트 버튼 (라디오 묶음) */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  size = "md",
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      className={`grid rounded-xl bg-surface-2 p-1 ${size === "md" ? "h-11" : "h-9"}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer items-center justify-center rounded-lg px-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
            size === "md" ? "text-sm" : "text-[13px]"
          } ${value === o.value ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:text-ink"}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** 클립보드의 글자를 붙여 넣는 버튼. 브라우저가 막으면 onError 로 알린다. */
export function PasteButton({ onPaste, onError }: { onPaste: (text: string) => void; onError: (message: string) => void }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (text) onPaste(text);
          else onError("복사한 링크가 없습니다.");
        } catch {
          onError("브라우저가 클립보드 읽기를 막았습니다. 입력칸에 직접 붙여 넣어 주세요.");
        }
      }}
      className={`inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-surface-2 ${focusRing}`}
    >
      <ClipboardIcon className="size-4" />
      붙여넣기
    </button>
  );
}

/** 체크박스 + 설명 */
export function Checkbox({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--ink)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{children}</span>
        {hint && <span className={hintText}>{hint}</span>}
      </span>
    </label>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="animate-fade-in flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
