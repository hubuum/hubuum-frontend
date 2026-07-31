"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";

import { CreateModal } from "@/components/create-modal";
import { ReportQueryBuilder } from "@/components/report-query-builder";
import {
	CLASS_OBJECT_SAMPLES_GC_TIME,
	CLASS_OBJECT_SAMPLES_STALE_TIME,
	classObjectSamplesQueryKey,
	fetchClassObjectSamples,
} from "@/lib/api/class-objects";
import {
	fetchPersonalComputedFields,
	fetchSharedComputedFields,
} from "@/lib/api/computed-fields";
import { fetchExportClasses } from "@/lib/api/export-options";
import { type ReportTemplate, updateReportTemplate } from "@/lib/api/reporting";
import {
	resolveObjectServerFilterComputedFields,
	resolveObjectServerFilterDataFields,
} from "@/lib/object-server-filter-fields";
import { useToast } from "@/lib/toast-context";

type ReportDefaultQueryModalProps = {
	onClose: () => void;
	template: ReportTemplate;
};

type SaveDefaultQueryInput = {
	defaultQuery: string;
	templateId: number;
};

export function ReportDefaultQueryModal({
	onClose,
	template,
}: ReportDefaultQueryModalProps) {
	const queryClient = useQueryClient();
	const { showToast } = useToast();
	const [defaultQuery, setDefaultQuery] = useState(
		template.default_query ?? "",
	);
	const classId = template.class_id ?? null;
	const usesObjectServerFilters = template.scope_kind === "objects_in_class";

	const classesQuery = useQuery({
		queryKey: ["classes", "exports"],
		queryFn: fetchExportClasses,
	});
	const selectedClass = useMemo(
		() =>
			classesQuery.data?.find((classItem) => classItem.id === classId) ?? null,
		[classId, classesQuery.data],
	);
	const objectsQuery = useQuery({
		queryKey: classObjectSamplesQueryKey(classId),
		queryFn: () => fetchClassObjectSamples(classId ?? 0),
		enabled: usesObjectServerFilters && classId !== null,
		staleTime: CLASS_OBJECT_SAMPLES_STALE_TIME,
		gcTime: CLASS_OBJECT_SAMPLES_GC_TIME,
	});
	const sharedComputedQuery = useQuery({
		queryKey: ["computed-fields", "shared", classId],
		queryFn: () => fetchSharedComputedFields(classId ?? 0),
		enabled: usesObjectServerFilters && classId !== null,
	});
	const personalComputedQuery = useQuery({
		queryKey: ["computed-fields", "personal", classId],
		queryFn: () => fetchPersonalComputedFields(classId ?? 0),
		enabled: usesObjectServerFilters && classId !== null,
	});
	const objectSampleData = useMemo(
		() => (objectsQuery.data ?? []).map((objectItem) => objectItem.data),
		[objectsQuery.data],
	);
	const objectDataFields = useMemo(
		() =>
			resolveObjectServerFilterDataFields(
				selectedClass?.json_schema,
				objectSampleData,
			),
		[objectSampleData, selectedClass?.json_schema],
	);
	const objectComputedFields = useMemo(
		() =>
			resolveObjectServerFilterComputedFields(
				sharedComputedQuery.data?.definitions ?? [],
				personalComputedQuery.data ?? [],
			),
		[personalComputedQuery.data, sharedComputedQuery.data?.definitions],
	);

	const updateDefaultQueryMutation = useMutation({
		mutationFn: ({
			defaultQuery: nextQuery,
			templateId,
		}: SaveDefaultQueryInput) =>
			updateReportTemplate(templateId, {
				default_query: nextQuery.trim() || null,
			}),
		onSuccess: async (updatedTemplate) => {
			await queryClient.invalidateQueries({ queryKey: ["export-templates"] });
			showToast(
				`Default query for “${updatedTemplate.name}” saved.`,
				"success",
			);
			onClose();
		},
	});

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		updateDefaultQueryMutation.mutate({
			defaultQuery,
			templateId: template.id,
		});
	}

	const normalizedSavedQuery = template.default_query?.trim() ?? "";
	const isDirty = defaultQuery.trim() !== normalizedSavedQuery;
	const objectFilterHint = (() => {
		if (!usesObjectServerFilters) return undefined;
		if (classId === null) {
			return "This template has no class, so server filters cannot be configured here.";
		}
		if (classesQuery.isLoading || objectsQuery.isLoading) {
			return "Loading the class fields available for server filters…";
		}
		if (classesQuery.isError || objectsQuery.isError) {
			return "Some class fields could not be loaded. Existing and advanced query parameters can still be edited.";
		}
		return "Open Server filters to add or edit filters for this template's class.";
	})();

	return (
		<CreateModal
			open
			title={`Edit default query · ${template.name}`}
			onClose={onClose}
			closeDisabled={updateDefaultQueryMutation.isPending}
		>
			<form className="stack report-default-query-form" onSubmit={handleSubmit}>
				<p className="muted">
					This changes the query used by View and Refresh now. It does not
					change the report target, layout, or content.
				</p>
				<ReportQueryBuilder
					key={template.id}
					idPrefix={`report-card-query-${template.id}`}
					scopeKind={template.scope_kind ?? "collections"}
					value={defaultQuery}
					onChange={setDefaultQuery}
					disabled={updateDefaultQueryMutation.isPending}
					objectDataFields={objectDataFields}
					objectComputedFields={objectComputedFields}
					objectFiltersDisabled={
						usesObjectServerFilters &&
						(classId === null ||
							classesQuery.isLoading ||
							selectedClass === null)
					}
					objectFilterHint={objectFilterHint}
				/>

				{updateDefaultQueryMutation.isError ? (
					<div className="error-banner" role="alert">
						{updateDefaultQueryMutation.error instanceof Error
							? updateDefaultQueryMutation.error.message
							: "Failed to update the default query."}
					</div>
				) : null}

				<div className="form-actions form-actions--end">
					<button
						type="button"
						className="ghost"
						onClick={onClose}
						disabled={updateDefaultQueryMutation.isPending}
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!isDirty || updateDefaultQueryMutation.isPending}
					>
						{updateDefaultQueryMutation.isPending
							? "Saving…"
							: "Save default query"}
					</button>
				</div>
			</form>
		</CreateModal>
	);
}
