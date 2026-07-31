// 雙欄寫作頁（左 Chat／右 Tiptap）—— 版面 STEP 3、Chat STEP 4、事件記錄 STEP 5

type Params = { params: { sessionId: string } };

export default function WritePage({ params }: Params) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">寫作</h1>
      <p className="mt-2 text-neutral-600">場次 {params.sessionId}</p>
    </main>
  );
}
