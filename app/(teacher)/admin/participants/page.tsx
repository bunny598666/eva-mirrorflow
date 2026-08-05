import { requireRole } from "@/lib/auth/session";
import { listClasses, listParticipants } from "@/lib/admin/queries";
import ParticipantsClient from "./Client";

export default async function ParticipantsPage() {
  const session = await requireRole("teacher", "researcher");
  const [classes, rows] = await Promise.all([
    listClasses(session),
    listParticipants(session),
  ]);
  return <ParticipantsClient classes={classes} rows={rows} />;
}
