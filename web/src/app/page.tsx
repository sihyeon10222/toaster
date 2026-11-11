import { ToasterTabs } from "@/components/toaster-tabs";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">🍞 Toaster</h1>
        <p className="opacity-70">카카오 이모티콘 링크나 페이지 주소를 넣으면 이미지와 영상을 모두 모아 드려요.</p>
      </header>
      <ToasterTabs />
    </main>
  );
}
