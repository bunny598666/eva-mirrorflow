import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import LogoutButton from "./LogoutButton";

const NAV = [
  { href: "/admin/classes", label: "班級" },
  { href: "/admin/assignments", label: "作業" },
  { href: "/admin/prompts", label: "反思題目" },
  { href: "/admin/participants", label: "參與者代號" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/admin" className="text-lg font-bold">
            歷程之鏡 後台
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-neutral-600 hover:text-neutral-900 hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-neutral-500">
            <span>
              {session?.code}（{roleLabel(session?.app_role)}）
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

function roleLabel(role: string | undefined): string {
  if (role === "teacher") return "教師";
  if (role === "researcher") return "研究者";
  return "未知";
}
