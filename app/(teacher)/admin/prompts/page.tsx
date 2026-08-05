import { requireRole } from "@/lib/auth/session";
import { listPrompts } from "@/lib/admin/queries";
import PromptsClient from "./Client";

export default async function PromptsPage() {
  await requireRole("teacher", "researcher");
  const rows = await listPrompts();
  return <PromptsClient rows={rows} />;
}
