import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listAssignmentsWithProgress } from "@/lib/student/queries";
import StudentHome from "./StudentHome";

export default async function HomePage() {
  const session = await getSession();

  if (!session) redirect("/login");
  if (session.app_role === "teacher") redirect("/dashboard");
  if (session.app_role === "researcher") redirect("/trajectory");

  const items = await listAssignmentsWithProgress(session);
  return <StudentHome code={session.code} items={items} />;
}
