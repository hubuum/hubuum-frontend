import { TasksWorkspace } from "@/components/tasks-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function TasksPage() {
	const session = await requireServerSession();

	return <TasksWorkspace currentUsername={session.username ?? null} />;
}
