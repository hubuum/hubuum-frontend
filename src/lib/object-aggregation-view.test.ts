import { expect, it } from "vitest";
import { parseObjectAggregationView } from "@/lib/object-aggregation-view";

it("restores ordered grouping, measures, sorting and layout", () => {
	const params = new URLSearchParams();
	for (const field of [
		'data:["facts","major"]',
		"computed:shared:minor",
		"object:collection",
	])
		params.append("groupBy", field);
	params.append("aggregate", "sum:json_data.metrics,cpu");
	params.append("aggregate", "average:computed.personal.cost");
	params.set("groupSort", "value-asc");
	params.set("aggregateView", "table");
	expect(parseObjectAggregationView(params)).toEqual({
		groupFieldIds: [
			'data:["facts","major"]',
			"computed:shared:minor",
			"object:collection",
		],
		aggregateMeasures: [
			{ id: "0", operation: "sum", field: "json_data.metrics,cpu" },
			{ id: "1", operation: "average", field: "computed.personal.cost" },
		],
		groupSort: "value-asc",
		aggregateLayout: "table",
	});
});

it("defaults safely and validates hand-edited URLs within server limits", () => {
	const params = new URLSearchParams();
	for (const id of [
		"unknown",
		"data:broken",
		"data:[]",
		"data:[3]",
		"object:name",
		"object:name",
		"object:description",
		"custom:os",
		"object:collection",
	])
		params.append("groupBy", id);
	for (const measure of [
		"sum:json_data.valid",
		"sum:json_data.invalid!",
		"other:json_data.valid",
		"min:name",
		"max:json_data.extra",
	])
		params.append("aggregate", measure);
	params.set("groupSort", "bad");
	params.set("aggregateView", "bad");
	expect(parseObjectAggregationView(params)).toEqual({
		groupFieldIds: ["object:name", "object:description", "custom:os"],
		aggregateMeasures: [
			{ id: "0", field: "json_data.valid", operation: "sum" },
		],
		groupSort: "count-desc",
		aggregateLayout: "tree",
	});
	expect(
		parseObjectAggregationView(new URLSearchParams()).aggregateMeasures,
	).toEqual([]);
});
