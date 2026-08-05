import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getSession();

  if (!session) redirect("/login");
  if (session.app_role === "teacher") redirect("/dashboard");
  if (session.app_role === "researcher") redirect("/trajectory");

  // 學生首頁：作業列表與寫作入口於 STEP 3 起接上。
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold">歷程之鏡</h1>
        <p className="mt-2 text-neutral-600">{session.code}，你好。</p>
      </div>
      <p className="rounded-lg bg-neutral-100 px-4 py-3 text-neutral-700">
        作業還沒開始，等老師說開始再進來。
      </p>
      <Link href="/login" className="text-sm text-neutral-500 underline">
        換一個帳號
      </Link>
    </main>
  );
}
