import { requireRole } from "@/lib/auth/session";
import { listClasses } from "@/lib/admin/queries";
import ClassesClient from "./Client";

export default async function ClassesPage() {
  const session = await requireRole("teacher", "researcher");
  const rows = await listClasses(session);
  return <ClassesClient rows={rows} />;
}
