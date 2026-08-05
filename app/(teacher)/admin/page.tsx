import Link from "next/link";

const CARDS = [
  {
    href: "/admin/classes",
    title: "班級",
    body: "模型、temperature、system prompt 版本。一旦該班有人作答，這三項即凍結。",
  },
  {
    href: "/admin/assignments",
    title: "作業",
    body: "三期作業（order_no 1／2／3）與鷹架按鈕。有人作答後內容即凍結。",
  },
  {
    href: "/admin/prompts",
    title: "反思題目",
    body: "版本化管理。既有版本永遠不可修改，只能新增版本。",
  },
  {
    href: "/admin/participants",
    title: "參與者代號",
    body: "批次產生代號與 PIN，匯出 CSV。PIN 明碼只顯示一次，不落資料庫。",
  },
];

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">後台</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-neutral-200 bg-white p-5 hover:border-neutral-400"
          >
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <p className="mt-2 text-sm text-neutral-600">{card.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
