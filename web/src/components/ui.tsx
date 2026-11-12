// 화면 전체에서 같이 쓰는 모양 (버튼·입력칸·알림)
import { AlertIcon, ClipboardIcon, XIcon } from "@/components/icons";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export const buttonPrimary =
  "glass-prominent inline-flex h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[17px] font-semibold " +
  `hover:brightness-[.98] ${focusRing} disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none`;

export const buttonSecondary =
  "glass inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 " +
  `text-[15px] font-medium text-ink hover:brightness-[.98] ${focusRing} disabled:opacity-50`;

export const buttonSecondaryLg =
  "glass inline-flex h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[17px] font-semibold " +
  `text-ink hover:brightness-[.98] ${focusRing} disabled:cursor-wait disabled:opacity-70`;

export const iconButton =
  "inline-flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink " +
  `${focusRing} disabled:opacity-40`;

/** 툴바의 둥근 유리 아이콘 버튼 (iOS 내비게이션 막대 버튼) */
export const glassIconButton =
  "glass inline-flex size-11 items-center justify-center rounded-full text-ink " + `${focusRing} disabled:opacity-40`;

export const inputBox =
  "h-[50px] w-full min-w-0 rounded-[14px] bg-surface px-4 text-[17px] text-ink outline-none transition " +
  "placeholder:text-muted/70 focus:ring-4 focus:ring-accent/60";

/** iOS 목록 구역 머리글처럼 작은 회색 글자 */
export const labelText = "px-4 text-[13px] font-normal text-muted";
export const hintText = "px-4 text-[13px] leading-relaxed text-muted";

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
      className={`grid rounded-full bg-surface-2 p-[3px] ${size === "md" ? "h-11" : "h-9"}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer items-center justify-center rounded-full px-3 transition duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
            size === "md" ? "text-[15px]" : "text-[13px]"
          } ${
            value === o.value
              ? "bg-white font-semibold text-black shadow-[0_2px_8px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] dark:bg-[#636366] dark:text-white"
              : "font-medium text-ink/80 hover:text-ink"
          }`}
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

/**
 * 입력칸 오른쪽 버튼. 칸이 비어 있으면 클립보드의 글자를 붙여 넣고, 뭔가 들어 있으면 전부 지운다.
 * 브라우저가 클립보드 읽기를 막으면 onError 로 알린다.
 */
export function PasteButton({
  value,
  onPaste,
  onClear,
  onError,
}: {
  value: string;
  onPaste: (text: string) => void;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  const className = `glass inline-flex size-[50px] shrink-0 items-center justify-center rounded-full text-ink ${focusRing}`;
  if (value !== "") {
    return (
      <button type="button" onClick={onClear} aria-label="모두 지우기" title="모두 지우기" className={className}>
        <XIcon className="size-5" />
      </button>
    );
  }
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
      aria-label="붙여넣기"
      title="붙여넣기"
      className={className}
    >
      <ClipboardIcon className="size-5" />
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
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--ok)]"
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
      className="animate-fade-in flex items-start gap-2.5 rounded-[14px] bg-surface px-4 py-3 text-[15px] text-danger"
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
