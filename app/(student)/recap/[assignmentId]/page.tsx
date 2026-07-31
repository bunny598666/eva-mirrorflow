// ★「上次的你」摘要卡：第 2、3 次作業寫作前強制顯示（STEP 9）
// 第 1 期無上期資料，不顯示本頁。

type Params = { params: { assignmentId: string } };

export default function RecapPage({ params }: Params) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">上次的你</h1>
      <p className="mt-2 text-neutral-600">作業 {params.assignmentId}</p>
    </main>
  );
}
