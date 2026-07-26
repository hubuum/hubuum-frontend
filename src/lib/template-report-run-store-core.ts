export interface TemplateReportRunStore {
	getTaskId(key: string): Promise<number | null>;
	setTaskId(key: string, taskId: number): Promise<void>;
	deleteTaskId(key: string, expectedTaskId: number): Promise<void>;
	tryAcquireLock(
		key: string,
		owner: string,
		ttlMilliseconds: number,
	): Promise<boolean>;
	releaseLock(key: string, owner: string): Promise<void>;
}

export class InMemoryTemplateReportRunStore
	implements TemplateReportRunStore
{
	private readonly taskIds = new Map<string, number>();
	private readonly locks = new Map<
		string,
		{ owner: string; expiresAt: number }
	>();

	async getTaskId(key: string): Promise<number | null> {
		return this.taskIds.get(key) ?? null;
	}

	async setTaskId(key: string, taskId: number): Promise<void> {
		this.taskIds.set(key, taskId);
	}

	async deleteTaskId(key: string, expectedTaskId: number): Promise<void> {
		if (this.taskIds.get(key) === expectedTaskId) {
			this.taskIds.delete(key);
		}
	}

	async tryAcquireLock(
		key: string,
		owner: string,
		ttlMilliseconds: number,
	): Promise<boolean> {
		const now = Date.now();
		const current = this.locks.get(key);
		if (current && current.expiresAt > now) {
			return false;
		}

		this.locks.set(key, {
			owner,
			expiresAt: now + ttlMilliseconds,
		});
		return true;
	}

	async releaseLock(key: string, owner: string): Promise<void> {
		if (this.locks.get(key)?.owner === owner) {
			this.locks.delete(key);
		}
	}
}
