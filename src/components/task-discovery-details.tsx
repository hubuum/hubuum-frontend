import Link from "next/link";
import type { TaskResponse } from "@/lib/api/generated/models";
import { taskMetadataFields, taskSchemaReportHref } from "@/lib/task-metadata";

export function TaskDiscoveryDetails({ task }: { task: TaskResponse }) {
	const fields = taskMetadataFields(task);
	const reportHref = taskSchemaReportHref(task);
	return (
		<article
			className="card stack panel-card"
			aria-labelledby="task-recorded-details"
		>
			<h3 id="task-recorded-details">Recorded task details</h3>
			<p className="muted">
				Recorded options and outcomes can remain available after the request or
				output expires. Unknown means the server has no visible retained value.
			</p>
			{fields.length ? (
				<dl className="task-details-grid task-metadata">
					{fields.map((field) => (
						<div key={field.label}>
							<dt>{field.label}</dt>
							<dd>
								{field.href ? (
									<Link href={field.href}>{field.value}</Link>
								) : (
									field.value
								)}
							</dd>
						</div>
					))}
				</dl>
			) : (
				<p className="muted">
					Task metadata is unavailable for this task or your access level.
				</p>
			)}
			{task.kind === "schema_validation" && fields.length ? (
				<p className="muted">
					Schema work status describes the recorded run. It does not indicate
					whether its findings still apply to the current schema.
				</p>
			) : null}
			{reportHref ? (
				<a
					className="link-chip"
					href={reportHref}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open schema report (JSON)
				</a>
			) : null}
		</article>
	);
}
