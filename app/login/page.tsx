import LoginForm from "./LoginForm";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  // 只接受站內相對路徑，避免被塞成開放轉址。
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 p-6">
      <div>
        <h1 className="text-3xl font-bold">歷程之鏡</h1>
        <p className="mt-2 text-neutral-600">用老師給你的代號和密碼登入。</p>
      </div>
      <LoginForm next={safeNext} />
    </main>
  );
}
