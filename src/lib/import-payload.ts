import type {
	ClassKey,
	ImportClassInput,
	ImportClassRelationInput,
	ImportCollectionPermissionInput,
	ImportObjectInput,
	ImportObjectRelationInput,
	ImportRequest,
	ObjectKey,
} from "@/lib/api/generated/models";
import { Permissions } from "@/lib/api/generated/models";

export type CollectionMode = "file" | "existing_override" | "create_override";

type CollectionPermissionSeed = Pick<
	ImportCollectionPermissionInput,
	"collection_key" | "collection_ref" | "ref"
>;

type CollectionTarget =
	| { kind: "key"; name: string }
	| { kind: "ref"; ref: string };

export type ImportCollectionSuggestion = {
	description: string;
	isExistingCollectionPayload: boolean;
	collectionName: string;
	collectionRef: string | null;
};

export type ImportPayloadOptions = {
	atomicity: "strict" | "best_effort";
	collisionPolicy: "abort" | "overwrite";
	delegateGroupName?: string;
	dryRun: boolean;
	collectionDescription?: string;
	collectionMode: CollectionMode;
	collectionName?: string;
	permissionPolicy: "abort" | "continue";
};

const FULL_NAMESPACE_PERMISSIONS = Object.values(Permissions);
const NAMESPACE_REF_PREFIX = "ns:";
const SAFE_REF_PATTERN = /[^a-z0-9]+/g;

function trimToNonEmpty(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function slugCollectionName(value: string): string {
	const slug = value.toLowerCase().replace(SAFE_REF_PATTERN, "-").replace(
		/^-+|-+$/g,
		"",
	);
	return slug || "item";
}

export function buildCollectionRef(name: string): string {
	return `${NAMESPACE_REF_PREFIX}${slugCollectionName(name)}`;
}

function collectionNameFromRef(ref: string): string {
	const rawName = ref.startsWith(NAMESPACE_REF_PREFIX)
		? ref.slice(NAMESPACE_REF_PREFIX.length)
		: ref;
	const normalized = rawName.trim();
	if (!normalized) {
		return "";
	}

	if (!normalized.includes("-")) {
		return normalized;
	}

	return normalized
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function collectClassCollectionRefs(payload: ImportRequest): Set<string> {
	const refs = new Set<string>();

	for (const classItem of payload.graph.classes ?? []) {
		const collectionRef = trimToNonEmpty(classItem.collection_ref);
		if (collectionRef) {
			refs.add(collectionRef);
		}
	}

	return refs;
}

export function getImportCollectionSuggestion(
	payload: ImportRequest,
	existingCollectionNames: readonly string[] = [],
): ImportCollectionSuggestion {
	const declaredCollection = payload.graph.collections?.[0];
	const declaredName = trimToNonEmpty(declaredCollection?.name);
	const declaredDescription = trimToNonEmpty(declaredCollection?.description);
	const collectionRefs = collectClassCollectionRefs(payload);
	const collectionRef =
		collectionRefs.size === 1 ? Array.from(collectionRefs.values())[0] : null;
	const hasCollectionPermissions =
		(payload.graph.collection_permissions?.length ?? 0) > 0;
	const isExistingCollectionPayload =
		(payload.graph.collections?.length ?? 0) === 0 &&
		!hasCollectionPermissions &&
		collectionRef !== null;
	const refSlug = collectionRef
		? slugCollectionName(collectionNameFromRef(collectionRef))
		: "";
	const matchedExistingName =
		refSlug && existingCollectionNames.length
			? (existingCollectionNames.find(
					(name) => slugCollectionName(name) === refSlug,
				) ?? null)
			: null;

	return {
		description: declaredDescription ?? "",
		isExistingCollectionPayload,
		collectionName:
			declaredName ??
			matchedExistingName ??
			(collectionRef ? collectionNameFromRef(collectionRef) : ""),
		collectionRef,
	};
}

function buildCollectionPermissionIdentity(
	permission: Pick<
		ImportCollectionPermissionInput,
		"collection_key" | "collection_ref"
	>,
	index: number,
): string {
	const collectionRef = permission.collection_ref?.trim();
	if (collectionRef) {
		return `ref:${collectionRef}`;
	}

	const collectionName = permission.collection_key?.name?.trim();
	if (collectionName) {
		return `name:${collectionName}`;
	}

	return `index:${index}`;
}

function buildSeedCollectionPermissions(
	payload: ImportRequest,
	groupname: string,
): ImportCollectionPermissionInput[] {
	const seeds = new Map<string, CollectionPermissionSeed>();
	const classCollectionByRef = new Map<string, CollectionPermissionSeed>();

	function registerSeed(seed: CollectionPermissionSeed): void {
		const key = buildCollectionPermissionIdentity(seed, seeds.size);
		if (key.startsWith("index:")) {
			return;
		}

		if (!seeds.has(key)) {
			seeds.set(key, seed);
		}
	}

	for (const collectionItem of payload.graph.collections ?? []) {
		const collectionRef = collectionItem.ref?.trim();
		registerSeed({
			collection_key: collectionRef ? undefined : { name: collectionItem.name },
			collection_ref: collectionRef || undefined,
			ref: collectionItem.ref ?? undefined,
		});
	}

	for (const classItem of payload.graph.classes ?? []) {
		const seed = {
			collection_key: classItem.collection_ref?.trim()
				? undefined
				: (classItem.collection_key ?? undefined),
			collection_ref: classItem.collection_ref?.trim() || undefined,
			ref: classItem.ref ?? undefined,
		};

		registerSeed(seed);

		const classRef = classItem.ref?.trim();
		if (classRef) {
			classCollectionByRef.set(classRef, seed);
		}
	}

	for (const objectItem of payload.graph.objects ?? []) {
		if (
			objectItem.class_key?.collection_key ||
			objectItem.class_key?.collection_ref
		) {
			registerSeed({
				collection_key: objectItem.class_key.collection_ref?.trim()
					? undefined
					: (objectItem.class_key.collection_key ?? undefined),
				collection_ref: objectItem.class_key.collection_ref?.trim() || undefined,
			});
			continue;
		}

		const classRef = objectItem.class_ref?.trim();
		if (!classRef) {
			continue;
		}

		const classCollection = classCollectionByRef.get(classRef);
		if (classCollection) {
			registerSeed(classCollection);
		}
	}

	return Array.from(seeds.values()).map((seed) => ({
		...seed,
		group_key: { groupname },
		permissions: FULL_NAMESPACE_PERMISSIONS,
		replace_existing: false,
	}));
}

function applyDelegateGroupOverride(
	payload: ImportRequest,
	groupname: string,
): ImportRequest {
	const existingPermissions = payload.graph.collection_permissions ?? [];
	const seededPermissions = buildSeedCollectionPermissions(payload, groupname);
	const mergedPermissions = new Map<string, ImportCollectionPermissionInput>();

	[...existingPermissions, ...seededPermissions].forEach(
		(permission, index) => {
			const key = buildCollectionPermissionIdentity(permission, index);
			const previous = mergedPermissions.get(key);
			const permissionNames = new Set(previous?.permissions ?? []);

			for (const permissionName of permission.permissions) {
				permissionNames.add(permissionName);
			}

			mergedPermissions.set(key, {
				...permission,
				group_key: { groupname },
				permissions: Array.from(permissionNames),
				replace_existing:
					previous?.replace_existing ?? permission.replace_existing ?? false,
			});
		},
	);

	return {
		...payload,
		graph: {
			...payload.graph,
			collection_permissions: Array.from(mergedPermissions.values()),
		},
	};
}

function rewriteClassKeyCollection<T extends ClassKey | null | undefined>(
	classKey: T,
	target: CollectionTarget,
): T {
	if (!classKey) {
		return classKey;
	}

	return {
		...classKey,
		collection_key: target.kind === "key" ? { name: target.name } : undefined,
		collection_ref: target.kind === "ref" ? target.ref : undefined,
	} as T;
}

function rewriteObjectKeyCollection<T extends ObjectKey | null | undefined>(
	objectKey: T,
	target: CollectionTarget,
): T {
	if (!objectKey) {
		return objectKey;
	}

	return {
		...objectKey,
		class_key: rewriteClassKeyCollection(objectKey.class_key, target),
	} as T;
}

function rewriteClassCollection(
	classItem: ImportClassInput,
	target: CollectionTarget,
): ImportClassInput {
	return {
		...classItem,
		collection_key: target.kind === "key" ? { name: target.name } : undefined,
		collection_ref: target.kind === "ref" ? target.ref : undefined,
	};
}

function rewriteObjectCollection(
	objectItem: ImportObjectInput,
	target: CollectionTarget,
): ImportObjectInput {
	return {
		...objectItem,
		class_key: rewriteClassKeyCollection(objectItem.class_key, target),
	};
}

function rewriteClassRelationCollection(
	relation: ImportClassRelationInput,
	target: CollectionTarget,
): ImportClassRelationInput {
	return {
		...relation,
		from_class_key: rewriteClassKeyCollection(relation.from_class_key, target),
		to_class_key: rewriteClassKeyCollection(relation.to_class_key, target),
	};
}

function rewriteObjectRelationCollection(
	relation: ImportObjectRelationInput,
	target: CollectionTarget,
): ImportObjectRelationInput {
	return {
		...relation,
		from_object_key: rewriteObjectKeyCollection(relation.from_object_key, target),
		to_object_key: rewriteObjectKeyCollection(relation.to_object_key, target),
	};
}

function rewriteCollectionReferences(
	payload: ImportRequest,
	target: CollectionTarget,
): ImportRequest {
	return {
		...payload,
		graph: {
			...payload.graph,
			classes: payload.graph.classes?.map((classItem) =>
				rewriteClassCollection(classItem, target),
			),
			objects: payload.graph.objects?.map((objectItem) =>
				rewriteObjectCollection(objectItem, target),
			),
			class_relations: payload.graph.class_relations?.map((relation) =>
				rewriteClassRelationCollection(relation, target),
			),
			object_relations: payload.graph.object_relations?.map((relation) =>
				rewriteObjectRelationCollection(relation, target),
			),
		},
	};
}

function applyExistingCollectionOverride(
	payload: ImportRequest,
	collectionName: string,
): ImportRequest {
	const rewritten = rewriteCollectionReferences(payload, {
		kind: "key",
		name: collectionName,
	});

	return {
		...rewritten,
		graph: {
			...rewritten.graph,
			collections: [],
			collection_permissions: [],
		},
	};
}

function applyCreateCollectionOverride(
	payload: ImportRequest,
	collectionName: string,
	collectionDescription: string,
): ImportRequest {
	const collectionRef = buildCollectionRef(collectionName);
	const rewritten = rewriteCollectionReferences(payload, {
		kind: "ref",
		ref: collectionRef,
	});

	return {
		...rewritten,
		graph: {
			...rewritten.graph,
			collections: [
				{
					ref: collectionRef,
					name: collectionName,
					description: collectionDescription,
				},
			],
			collection_permissions: rewritten.graph.collection_permissions?.map(
				(permission) => ({
					...permission,
					collection_key: undefined,
					collection_ref: collectionRef,
				}),
			),
		},
	};
}

export function buildImportSubmissionPayload(
	payload: ImportRequest,
	options: ImportPayloadOptions,
): ImportRequest {
	const collectionName = trimToNonEmpty(options.collectionName);
	const collectionDescription = trimToNonEmpty(options.collectionDescription);
	const delegateGroupName = trimToNonEmpty(options.delegateGroupName);
	let effectivePayload: ImportRequest = {
		...payload,
		dry_run: options.dryRun,
		mode: {
			...payload.mode,
			atomicity: options.atomicity,
			collision_policy: options.collisionPolicy,
			permission_policy: options.permissionPolicy,
		},
	};

	if (options.collectionMode === "existing_override") {
		if (!collectionName) {
			throw new Error("Target collection is required.");
		}

		return applyExistingCollectionOverride(effectivePayload, collectionName);
	}

	if (options.collectionMode === "create_override") {
		if (!collectionName) {
			throw new Error("Target collection is required.");
		}
		if (!collectionDescription) {
			throw new Error("Collection description is required.");
		}

		effectivePayload = applyCreateCollectionOverride(
			effectivePayload,
			collectionName,
			collectionDescription,
		);
	}

	if (delegateGroupName) {
		effectivePayload = applyDelegateGroupOverride(
			effectivePayload,
			delegateGroupName,
		);
	}

	return effectivePayload;
}
