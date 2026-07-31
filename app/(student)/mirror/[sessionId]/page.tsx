// ★鏡子頁：學生版 DNA 條碼 → 簡化回放 → 反思表單（STEP 9）
// 順序不可調換；兩者皆瀏覽（viewed_dna_at / viewed_replay_at）後才可進入反思。

type Params = { params: Promise<{ sessionId: string }> };

export default async function MirrorPage({ params }: Params) {
  const { sessionId } = await params;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">我的歷程</h1>
      <p className="mt-2 text-neutral-600">場次 {sessionId}</p>
    </main>
  );
}
