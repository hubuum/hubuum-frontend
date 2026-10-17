import assert from "node:assert/strict";

export async function verifyAdvancedSearch({
	request,
	auth,
	collection,
	peerCollection,
	hubuumClass,
	objects,
	hasHydration,
}) {
	const field = (name, value, operator = "equals") => ({
		op: "field",
		predicate: { field: name, operator, value },
	});
	const search = async (body, expected = 200) =>
		(await request("POST", "/api/v1/search", { ...auth, body, expected })).data;
	for (const [kind, resource] of [
		["collection", collection],
		["class", hubuumClass],
	]) {
		const result = await search({
			version: 1,
			target: { kind },
			filter: field("id", resource.id),
			include_total: true,
		});
		assert.equal(result.kind, kind);
		assert.equal(result.total, 1);
		assert.deepEqual(
			result.results.map((item) => item.resource.id),
			[resource.id],
		);
	}
	const query = {
		version: 1,
		target: { kind: "object", class: { id: hubuumClass.id } },
		filter: {
			op: "and",
			args: [
				{
					op: "or",
					args: [
						field("collection_id", collection.id),
						field("collection_id", peerCollection.id),
					],
				},
				field(
					"id",
					objects.map((object) => object.id),
					"in",
				),
				{ op: "not", arg: field("name", "does-not-exist") },
			],
		},
		sort: [{ field: "id", direction: "asc" }],
		limit: 1,
		include_total: true,
	};
	const first = await search(query);
	assert.equal(first.total, 2);
	assert.ok(first.next);
	const second = await search({ ...query, cursor: first.next });
	assert.deepEqual(
		[first, second].flatMap((page) =>
			page.results.map((item) => item.resource.id),
		),
		objects.map((object) => object.id).sort((a, b) => a - b),
	);
	assert.equal(second.next, null);
	await search(
		{
			...query,
			cursor: first.next,
			sort: [{ field: "id", direction: "desc" }],
		},
		400,
	);
	await search({ ...query, filter: field("unsupported_field", "x") }, 400);
	const site = (
		await request("POST", "/api/v1/classes", {
			...auth,
			expected: 201,
			body: {
				name: `search_sites_${objects[0].id}`,
				description: "Advanced search contract",
				collection_id: peerCollection.id,
				json_schema: {},
				validate_schema: false,
			},
		})
	).data;
	try {
		const endpoint = (
			await request("POST", `/api/v1/classes/${site.id}/`, {
				...auth,
				expected: 201,
				body: {
					name: `search_site_${objects[0].id}`,
					description: "Related endpoint",
					collection_id: peerCollection.id,
					hubuum_class_id: site.id,
					data: {},
				},
			})
		).data;
		const classRelation = (
			await request("POST", "/api/v1/relations/classes", {
				...auth,
				expected: 201,
				body: {
					from_hubuum_class_id: hubuumClass.id,
					to_hubuum_class_id: site.id,
				},
			})
		).data;
		const relation = (
			await request("POST", "/api/v1/relations/objects", {
				...auth,
				expected: 201,
				body: {
					from_hubuum_object_id: objects[0].id,
					to_hubuum_object_id: endpoint.id,
					class_relation_id: classRelation.id,
				},
			})
		).data;
		const related = {
			op: "related",
			predicate: {
				class: { id: site.id },
				depth: 1,
				filters: [{ field: "name", operator: "equals", value: endpoint.name }],
			},
		};
		const matched = await search({
			...query,
			filter: { op: "and", args: [query.filter, related] },
		});
		assert.deepEqual(
			matched.results.map((item) => item.resource.id),
			[objects[0].id],
		);
		const excluded = await search({
			...query,
			filter: { op: "and", args: [query.filter, { op: "not", arg: related }] },
		});
		assert.deepEqual(
			excluded.results.map((item) => item.resource.id),
			[objects[1].id],
		);
		const hydrationRequest = {
			version: 1,
			root_class_id: hubuumClass.id,
			root_object_id: objects[0].id,
			class: { id: site.id },
			depth: 1,
			limit: 5,
		};
		const hydrated = await request("POST", "/api/v1/search/hydrate", {
			...auth,
			body: hydrationRequest,
			expected: hasHydration ? 200 : [404, 405],
		});
		if (hasHydration) {
			assert.equal(hydrated.data.truncated, false);
			assert.deepEqual(hydrated.data.paths, [
				{
					object_ids: [objects[0].id, endpoint.id],
					relation_ids: [relation.id],
				},
			]);
			assert.deepEqual(
				hydrated.data.objects.map((object) => object.id).sort((a, b) => a - b),
				[objects[0].id, endpoint.id].sort((a, b) => a - b),
			);
			assert.equal(hydrated.headers.get("cache-control"), "private, no-store");
		}
		assert.deepEqual(
			await search(query),
			first,
			"Inspection must not change root results, total or cursor",
		);
	} finally {
		await request("DELETE", `/api/v1/classes/${site.id}`, {
			...auth,
			expected: 204,
		});
	}
}
