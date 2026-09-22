import { TasksWorkspace } from "@/components/tasks-workspace";
import { getCurrentPrincipalId } from "@/lib/auth/current-principal";
import { requireServerSession } from "@/lib/auth/guards";

export default async function TasksPage() {
	const session = await requireServerSession();

	const currentUserId = await getCurrentPrincipalId(session.token);
	return <TasksWorkspace currentUserId={currentUserId} />;
}
