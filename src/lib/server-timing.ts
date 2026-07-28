import "server-only";

const METRIC_DESCRIPTIONS = {
	cache: "Report cache",
	output: "Output TTFB",
	revision: "Template revision",
	session: "Session",
	submit: "Task submission",
	total: "Total to headers",
	validation: "Task validation",
} as const;

export type ServerTimingMetric = keyof typeof METRIC_DESCRIPTIONS;

type Clock = () => number;

export class ServerTiming {
	private readonly durations = new Map<ServerTimingMetric, number>();

	constructor(private readonly now: Clock = () => performance.now()) {}

	add(metric: ServerTimingMetric, durationMilliseconds: number): void {
		if (
			!Number.isFinite(durationMilliseconds) ||
			durationMilliseconds < 0
		) {
			return;
		}

		this.durations.set(
			metric,
			(this.durations.get(metric) ?? 0) + durationMilliseconds,
		);
	}

	start(metric: ServerTimingMetric): () => void {
		const startedAt = this.now();
		let finished = false;

		return () => {
			if (finished) {
				return;
			}
			finished = true;
			this.add(metric, this.now() - startedAt);
		};
	}

	async measure<T>(
		metric: ServerTimingMetric,
		operation: () => Promise<T>,
	): Promise<T> {
		const finish = this.start(metric);
		try {
			return await operation();
		} finally {
			finish();
		}
	}

	toHeaderValue(): string {
		return Object.entries(METRIC_DESCRIPTIONS)
			.flatMap(([metric, description]) => {
				const duration = this.durations.get(metric as ServerTimingMetric);
				if (duration === undefined) {
					return [];
				}
				return [
					`${metric};dur=${duration.toFixed(1)};desc="${description}"`,
				];
			})
			.join(", ");
	}

	attach(response: Response): Response {
		const value = this.toHeaderValue();
		if (value) {
			response.headers.set("Server-Timing", value);
		}
		return response;
	}
}
