import { requireRole } from "@/lib/auth/session";
import { listAssignments } from "@/lib/admin/queries";
import AssignmentsClient from "./Client";

export default async function AssignmentsPage() {
  await requireRole("teacher", "researcher");
  const rows = await listAssignments();
  return <AssignmentsClient rows={rows} />;
}
