import { describe, expect, it } from "vitest";

import type { ReportTemplate } from "@/lib/api/reporting";
import {
	buildExportTemplateSavePayload,
	createExportTemplateDraft,
	duplicateExportTemplateDraft,
	filterClassesForCollection,
	getEditorTabForErrors,
	parseStoredTemplateBody,
	parsePositiveInteger,
	reportTemplateToExportTemplateDraft,
	serializeTemplateBody,
	type ExportTemplateDraft,
	validateExportTemplateDraft,
	validateExportTemplateIdentity,
	validateExportTemplateRelated,
	validateExportTemplateRules,
	validateExportTemplateTarget,
} from "@/lib/export-template-editor";

const validDraft: ExportTemplateDraft = {
	mode: "create",
	templateId: null,
	collectionId: "7",
	name: "Server inventory",
	description: "CSV for operations",
	contentType: "text/csv",
	htmlDocumentMode: "standard",
	templateBody: "{% for item in items %}{{ item.name }}{% endfor %}",
	kind: "export",
	scopeKind: "objects_in_class",
	classId: "42",
	defaultQuery: "sort=name.asc",
	includeRows: [],
	depth: "",
	missingDataPolicy: "strict",
	maxItems: "100",
	maxOutputBytes: "262144",
};

describe("validateExportTemplateDraft", () => {
	it("creates independent empty drafts", () => {
		const first = createExportTemplateDraft();
		const second = createExportTemplateDraft();

		expect(first).toMatchObject({
			mode: "create",
			contentType: "text/plain",
			kind: "export",
		});
		expect(createExportTemplateDraft(41)).toMatchObject({
			mode: "edit",
			templateId: 41,
		});
		expect(first.includeRows).not.toBe(second.includeRows);
	});

	it("duplicates an existing definition as a separately named unsaved draft", () => {
		expect(
			duplicateExportTemplateDraft({
				...validDraft,
				mode: "edit",
				templateId: 41,
			}),
		).toMatchObject({
			mode: "create",
			name: "Server inventory copy",
			templateId: null,
		});
	});

	it("builds contract-safe create and update payloads", () => {
		const createPayload = buildExportTemplateSavePayload(validDraft);
		expect(createPayload).toMatchObject({
			mode: "create",
			payload: {
				collection_id: 7,
				content_type: "text/csv",
				scope_kind: "objects_in_class",
				class_id: 42,
				default_limits: {
					max_items: 100,
					max_output_bytes: 262_144,
				},
			},
		});

		const updatePayload = buildExportTemplateSavePayload({
			...validDraft,
			mode: "edit",
			templateId: 41,
		});
		expect(updatePayload.mode).toBe("edit");
		expect(updatePayload.payload).not.toHaveProperty("content_type");
	});

	it("maps stored templates into editable drafts", () => {
		let nextId = 0;
		const template = {
			id: 41,
			collection_id: 7,
			name: "Server inventory",
			description: "CSV for operations",
			content_type: "text/csv",
			template: "{{ items | tojson }}",
			kind: "export",
			scope_kind: "objects_in_class",
			class_id: 42,
			default_query: "sort=name.asc",
			include: {
				related_objects: {
					rooms: {
						class_id: 91,
						direction: "outgoing",
						sort: "name",
					},
				},
			},
			relation_context: { depth: 2 },
			revision: 1,
			default_missing_data_policy: "omit",
			default_limits: { max_items: 100, max_output_bytes: 262_144 },
			created_at: "2026-07-26T00:00:00Z",
			updated_at: "2026-07-26T00:00:00Z",
		} satisfies ReportTemplate;

		expect(
			reportTemplateToExportTemplateDraft(template, () => `row-${++nextId}`),
		).toMatchObject({
			mode: "edit",
			templateId: 41,
			collectionId: "7",
			classId: "42",
			defaultQuery: "sort=name.asc",
			depth: "2",
			missingDataPolicy: "omit",
			maxItems: "100",
			maxOutputBytes: "262144",
			includeRows: [
				{
					id: "row-1",
					alias: "rooms",
					classId: "91",
					direction: "outgoing",
					sort: "name",
				},
			],
		});
	});

	it("accepts a complete executable template", () => {
		expect(validateExportTemplateDraft(validDraft)).toEqual({});
	});

	it("returns field-level authoring errors", () => {
		const errors = validateExportTemplateDraft({
			...validDraft,
			name: "",
			templateBody: "{% for item in items %}{{ item.name }}",
			classId: "",
			depth: "3",
		});

		expect(errors.name).toMatch(/name/i);
		expect(errors.templateBody).toMatch(/endfor/i);
		expect(errors.classId).toMatch(/class/i);
		expect(errors.depth).toMatch(/1 or 2/i);
		expect(getEditorTabForErrors(errors)).toBe("identity");
		expect(getEditorTabForErrors({ name: errors.name })).toBe("identity");
		expect(getEditorTabForErrors({ classId: errors.classId })).toBe("target");
		expect(getEditorTabForErrors({ depth: errors.depth })).toBe("related");
		expect(getEditorTabForErrors({ maxItems: "Invalid" })).toBe("rules");
	});

	it("validates strict positive integers", () => {
		expect(parsePositiveInteger("12")).toBe(12);
		expect(parsePositiveInteger("12px")).toBeNull();
		expect(parsePositiveInteger("0")).toBeNull();
	});

	it("rejects a class owned by another template collection", () => {
		const errors = validateExportTemplateTarget(validDraft, {
			classCollectionById: new Map([[42, 8]]),
		});
		expect(errors.classId).toMatch(/selected collection/i);
		expect(getEditorTabForErrors(errors)).toBe("target");
	});

	it("filters class choices to the selected collection", () => {
		const classes = [
			{ id: 1, collection: { id: 2 } },
			{ id: 2, collection: { id: 1 } },
		];
		expect(filterClassesForCollection(classes, "1")).toEqual([classes[1]]);
	});

	it("validates related settings and rules in their own stages", () => {
		const draft = {
			...validDraft,
			depth: "3",
			maxItems: "many",
			maxOutputBytes: "0",
		};

		expect(validateExportTemplateTarget(draft)).toEqual({});
		expect(validateExportTemplateRelated(draft).depth).toMatch(/1 or 2/i);
		expect(validateExportTemplateRules(draft)).toEqual({
			maxItems: expect.stringMatching(/positive/i),
			maxOutputBytes: expect.stringMatching(/positive/i),
		});
	});

	it("validates recognizable template details before target selection", () => {
		expect(
			validateExportTemplateIdentity({
				...validDraft,
				name: "",
				description: "",
			}),
		).toEqual({
			name: expect.stringMatching(/name/i),
			description: expect.stringMatching(/describe/i),
		});
	});

	it("stores standard HTML as a complete deterministic document while editing only its body", () => {
		const body = "<h1>{{ item.name }}</h1>";
		const stored = serializeTemplateBody({
			...validDraft,
			name: "Inventory & status",
			contentType: "text/html",
			htmlDocumentMode: "standard",
			templateBody: body,
		});

		expect(stored).toMatch(/^<!doctype html>/);
		expect(stored).toContain("<title>Inventory &amp; status</title>");
		expect(stored).toContain("tbody tr:nth-child(even)");
		expect(parseStoredTemplateBody("text/html", stored)).toEqual({
			htmlDocumentMode: "standard",
			templateBody: body,
		});
	});

	it("leaves advanced full HTML templates byte-for-byte unchanged", () => {
		const document = "<!doctype html><title>Custom</title><p>Report</p>";
		expect(
			serializeTemplateBody({
				...validDraft,
				contentType: "text/html",
				htmlDocumentMode: "full",
				templateBody: document,
			}),
		).toBe(document);
		expect(parseStoredTemplateBody("text/html", document)).toEqual({
			htmlDocumentMode: "full",
			templateBody: document,
		});
	});

	it("enforces the inferred minimum depth for a related include", () => {
		const includeRow = {
			id: "rooms",
			alias: "rooms",
			classId: "91",
			direction: "any" as const,
			sort: "path" as const,
			limit: "",
			maxDepth: "1",
		};
		const context = {
			relatedClassDepthStatus: "ready" as const,
			relatedClassMinimumDepthById: new Map([[91, 2]]),
		};

		expect(
			validateExportTemplateRelated(
				{ ...validDraft, includeRows: [includeRow] },
				context,
			).includeRows,
		).toMatch(/at least 2/i);
		expect(
			validateExportTemplateRelated(
				{
					...validDraft,
					includeRows: [{ ...includeRow, maxDepth: "2" }],
				},
				context,
			),
		).toEqual({});
	});

	it("waits for path verification before accepting related includes", () => {
		const draft = {
			...validDraft,
			includeRows: [
				{
					id: "rooms",
					alias: "rooms",
					classId: "91",
					direction: "any" as const,
					sort: "path" as const,
					limit: "",
					maxDepth: "2",
				},
			],
		};

		expect(
			validateExportTemplateRelated(draft, {
				relatedClassDepthStatus: "loading",
			}).includeRows,
		).toMatch(/wait/i);
		expect(
			validateExportTemplateRelated(draft, {
				relatedClassDepthStatus: "error",
			}).includeRows,
		).toMatch(/retry/i);
	});
});
