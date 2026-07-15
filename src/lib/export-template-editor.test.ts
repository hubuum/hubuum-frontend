import { describe, expect, it } from "vitest";

import {
	filterClassesForCollection,
	getEditorTabForErrors,
	parsePositiveInteger,
	type ExportTemplateDraft,
	validateExportTemplateDraft,
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
		expect(getEditorTabForErrors(errors)).toBe("target");
		expect(getEditorTabForErrors({ name: errors.name })).toBe("appearance");
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
});
