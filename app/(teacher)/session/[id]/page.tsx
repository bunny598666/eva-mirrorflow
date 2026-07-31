// 教師端單人完整回放（STEP 7）

type Params = { params: Promise<{ id: string }> };

export default async function TeacherSessionPage({ params }: Params) {
  const { id } = await params;
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">歷程回放</h1>
      <p className="mt-2 text-neutral-600">場次 {id}</p>
    </main>
  );
}
