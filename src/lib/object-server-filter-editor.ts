import type {
	ServerFilterComputedField,
	ServerFilterDataField,
} from "@/lib/object-server-filter-fields";
import {
	getObjectServerFilterIdentity,
	type ObjectServerFilter,
	type ObjectServerFilterBaseOperator,
} from "@/lib/object-server-filters";

export type ObjectServerFilterEditorDraft = {
	field: string;
	negated: boolean;
	operator: ObjectServerFilterBaseOperator;
	value: string;
};

export function getObjectServerFilterEditorDraft(
	filter: ObjectServerFilter,
	dataFields: readonly ServerFilterDataField[],
	computedFields: readonly ServerFilterComputedField[],
): ObjectServerFilterEditorDraft | null {
	let field: string;
	if (filter.field === "json_data") {
		const dataField = dataFields.find(
			(item) =>
				JSON.stringify(item.path) === JSON.stringify(filter.path ?? []),
		);
		if (!dataField) return null;
		field = `data:${dataField.id}`;
	} else if (filter.field === "computed") {
		const computedField = computedFields.find(
			(item) =>
				item.scope === filter.computedScope &&
				item.key === filter.computedKey,
		);
		if (!computedField) return null;
		field = `computed:${computedField.id}`;
	} else {
		field = filter.field;
	}

	const negated = filter.operator.startsWith("not_");
	return {
		field,
		negated,
		operator: (negated
			? filter.operator.slice(4)
			: filter.operator) as ObjectServerFilterBaseOperator,
		value: filter.value,
	};
}

export function replaceObjectServerFilter(
	filters: readonly ObjectServerFilter[],
	editingIdentity: string,
	replacement: ObjectServerFilter,
): ObjectServerFilter[] {
	const replacementIdentity = getObjectServerFilterIdentity(replacement);
	const next: ObjectServerFilter[] = [];
	let inserted = false;

	for (const filter of filters) {
		const identity = getObjectServerFilterIdentity(filter);
		if (identity === editingIdentity) {
			if (!inserted) {
				next.push(replacement);
				inserted = true;
			}
			continue;
		}
		if (identity === replacementIdentity) {
			continue;
		}
		next.push(filter);
	}

	if (!inserted) {
		next.push(replacement);
	}
	return next;
}
