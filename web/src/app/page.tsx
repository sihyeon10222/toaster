import { ToasterForm } from "@/components/toaster-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">🍞 Toaster</h1>
        <p className="opacity-70">페이지 주소와 HTML 태그를 넣으면 맞는 이미지를 모두 모아 드려요.</p>
      </header>
      <ToasterForm />
    </main>
  );
}
