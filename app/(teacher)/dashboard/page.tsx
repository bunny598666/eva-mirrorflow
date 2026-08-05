import Link from "next/link";
import { getSession } from "@/lib/auth/session";

// 班級總覽的資料視圖於 STEP 8 接上（三色條碼總覽）；本步先做導向。
export default async function TeacherDashboardPage() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">班級總覽</h1>
        <p className="mt-2 text-neutral-600">
          {session?.code}，你好。學生進度與條碼總覽於 STEP 8 接上。
        </p>
      </div>
      <Link
        href="/admin"
        className="self-start rounded bg-neutral-900 px-4 py-2 text-white"
      >
        前往後台
      </Link>
    </main>
  );
}
