import type {
	ClassKey,
	ImportClassInput,
	ImportClassRelationInput,
	ImportNamespacePermissionInput,
	ImportObjectInput,
	ImportObjectRelationInput,
	ImportRequest,
	ObjectKey,
} from "@/lib/api/generated/models";
import { Permissions } from "@/lib/api/generated/models";

export type NamespaceMode = "file" | "existing_override" | "create_override";

type NamespacePermissionSeed = Pick<
	ImportNamespacePermissionInput,
	"namespace_key" | "namespace_ref" | "ref"
>;

type NamespaceTarget =
	| { kind: "key"; name: string }
	| { kind: "ref"; ref: string };

export type ImportNamespaceSuggestion = {
	description: string;
	isExistingNamespacePayload: boolean;
	namespaceName: string;
	namespaceRef: string | null;
};

export type ImportPayloadOptions = {
	atomicity: "strict" | "best_effort";
	collisionPolicy: "abort" | "overwrite";
	delegateGroupName?: string;
	dryRun: boolean;
	namespaceDescription?: string;
	namespaceMode: NamespaceMode;
	namespaceName?: string;
	permissionPolicy: "abort" | "continue";
};

const FULL_NAMESPACE_PERMISSIONS = Object.values(Permissions);
const NAMESPACE_REF_PREFIX = "ns:";
const SAFE_REF_PATTERN = /[^a-z0-9]+/g;

function trimToNonEmpty(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function slugNamespaceName(value: string): string {
	const slug = value.toLowerCase().replace(SAFE_REF_PATTERN, "-").replace(
		/^-+|-+$/g,
		"",
	);
	return slug || "item";
}

export function buildNamespaceRef(name: string): string {
	return `${NAMESPACE_REF_PREFIX}${slugNamespaceName(name)}`;
}

function namespaceNameFromRef(ref: string): string {
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

function collectClassNamespaceRefs(payload: ImportRequest): Set<string> {
	const refs = new Set<string>();

	for (const classItem of payload.graph.classes ?? []) {
		const namespaceRef = trimToNonEmpty(classItem.namespace_ref);
		if (namespaceRef) {
			refs.add(namespaceRef);
		}
	}

	return refs;
}

export function getImportNamespaceSuggestion(
	payload: ImportRequest,
	existingNamespaceNames: readonly string[] = [],
): ImportNamespaceSuggestion {
	const declaredNamespace = payload.graph.namespaces?.[0];
	const declaredName = trimToNonEmpty(declaredNamespace?.name);
	const declaredDescription = trimToNonEmpty(declaredNamespace?.description);
	const namespaceRefs = collectClassNamespaceRefs(payload);
	const namespaceRef =
		namespaceRefs.size === 1 ? Array.from(namespaceRefs.values())[0] : null;
	const hasNamespacePermissions =
		(payload.graph.namespace_permissions?.length ?? 0) > 0;
	const isExistingNamespacePayload =
		(payload.graph.namespaces?.length ?? 0) === 0 &&
		!hasNamespacePermissions &&
		namespaceRef !== null;
	const refSlug = namespaceRef
		? slugNamespaceName(namespaceNameFromRef(namespaceRef))
		: "";
	const matchedExistingName =
		refSlug && existingNamespaceNames.length
			? (existingNamespaceNames.find(
					(name) => slugNamespaceName(name) === refSlug,
				) ?? null)
			: null;

	return {
		description: declaredDescription ?? "",
		isExistingNamespacePayload,
		namespaceName:
			declaredName ??
			matchedExistingName ??
			(namespaceRef ? namespaceNameFromRef(namespaceRef) : ""),
		namespaceRef,
	};
}

function buildNamespacePermissionIdentity(
	permission: Pick<
		ImportNamespacePermissionInput,
		"namespace_key" | "namespace_ref"
	>,
	index: number,
): string {
	const namespaceRef = permission.namespace_ref?.trim();
	if (namespaceRef) {
		return `ref:${namespaceRef}`;
	}

	const namespaceName = permission.namespace_key?.name?.trim();
	if (namespaceName) {
		return `name:${namespaceName}`;
	}

	return `index:${index}`;
}

function buildSeedNamespacePermissions(
	payload: ImportRequest,
	groupname: string,
): ImportNamespacePermissionInput[] {
	const seeds = new Map<string, NamespacePermissionSeed>();
	const classNamespaceByRef = new Map<string, NamespacePermissionSeed>();

	function registerSeed(seed: NamespacePermissionSeed): void {
		const key = buildNamespacePermissionIdentity(seed, seeds.size);
		if (key.startsWith("index:")) {
			return;
		}

		if (!seeds.has(key)) {
			seeds.set(key, seed);
		}
	}

	for (const namespaceItem of payload.graph.namespaces ?? []) {
		const namespaceRef = namespaceItem.ref?.trim();
		registerSeed({
			namespace_key: namespaceRef ? undefined : { name: namespaceItem.name },
			namespace_ref: namespaceRef || undefined,
			ref: namespaceItem.ref ?? undefined,
		});
	}

	for (const classItem of payload.graph.classes ?? []) {
		const seed = {
			namespace_key: classItem.namespace_ref?.trim()
				? undefined
				: (classItem.namespace_key ?? undefined),
			namespace_ref: classItem.namespace_ref?.trim() || undefined,
			ref: classItem.ref ?? undefined,
		};

		registerSeed(seed);

		const classRef = classItem.ref?.trim();
		if (classRef) {
			classNamespaceByRef.set(classRef, seed);
		}
	}

	for (const objectItem of payload.graph.objects ?? []) {
		if (
			objectItem.class_key?.namespace_key ||
			objectItem.class_key?.namespace_ref
		) {
			registerSeed({
				namespace_key: objectItem.class_key.namespace_ref?.trim()
					? undefined
					: (objectItem.class_key.namespace_key ?? undefined),
				namespace_ref: objectItem.class_key.namespace_ref?.trim() || undefined,
			});
			continue;
		}

		const classRef = objectItem.class_ref?.trim();
		if (!classRef) {
			continue;
		}

		const classNamespace = classNamespaceByRef.get(classRef);
		if (classNamespace) {
			registerSeed(classNamespace);
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
	const existingPermissions = payload.graph.namespace_permissions ?? [];
	const seededPermissions = buildSeedNamespacePermissions(payload, groupname);
	const mergedPermissions = new Map<string, ImportNamespacePermissionInput>();

	[...existingPermissions, ...seededPermissions].forEach(
		(permission, index) => {
			const key = buildNamespacePermissionIdentity(permission, index);
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
			namespace_permissions: Array.from(mergedPermissions.values()),
		},
	};
}

function rewriteClassKeyNamespace<T extends ClassKey | null | undefined>(
	classKey: T,
	target: NamespaceTarget,
): T {
	if (!classKey) {
		return classKey;
	}

	return {
		...classKey,
		namespace_key: target.kind === "key" ? { name: target.name } : undefined,
		namespace_ref: target.kind === "ref" ? target.ref : undefined,
	} as T;
}

function rewriteObjectKeyNamespace<T extends ObjectKey | null | undefined>(
	objectKey: T,
	target: NamespaceTarget,
): T {
	if (!objectKey) {
		return objectKey;
	}

	return {
		...objectKey,
		class_key: rewriteClassKeyNamespace(objectKey.class_key, target),
	} as T;
}

function rewriteClassNamespace(
	classItem: ImportClassInput,
	target: NamespaceTarget,
): ImportClassInput {
	return {
		...classItem,
		namespace_key: target.kind === "key" ? { name: target.name } : undefined,
		namespace_ref: target.kind === "ref" ? target.ref : undefined,
	};
}

function rewriteObjectNamespace(
	objectItem: ImportObjectInput,
	target: NamespaceTarget,
): ImportObjectInput {
	return {
		...objectItem,
		class_key: rewriteClassKeyNamespace(objectItem.class_key, target),
	};
}

function rewriteClassRelationNamespace(
	relation: ImportClassRelationInput,
	target: NamespaceTarget,
): ImportClassRelationInput {
	return {
		...relation,
		from_class_key: rewriteClassKeyNamespace(relation.from_class_key, target),
		to_class_key: rewriteClassKeyNamespace(relation.to_class_key, target),
	};
}

function rewriteObjectRelationNamespace(
	relation: ImportObjectRelationInput,
	target: NamespaceTarget,
): ImportObjectRelationInput {
	return {
		...relation,
		from_object_key: rewriteObjectKeyNamespace(relation.from_object_key, target),
		to_object_key: rewriteObjectKeyNamespace(relation.to_object_key, target),
	};
}

function rewriteNamespaceReferences(
	payload: ImportRequest,
	target: NamespaceTarget,
): ImportRequest {
	return {
		...payload,
		graph: {
			...payload.graph,
			classes: payload.graph.classes?.map((classItem) =>
				rewriteClassNamespace(classItem, target),
			),
			objects: payload.graph.objects?.map((objectItem) =>
				rewriteObjectNamespace(objectItem, target),
			),
			class_relations: payload.graph.class_relations?.map((relation) =>
				rewriteClassRelationNamespace(relation, target),
			),
			object_relations: payload.graph.object_relations?.map((relation) =>
				rewriteObjectRelationNamespace(relation, target),
			),
		},
	};
}

function applyExistingNamespaceOverride(
	payload: ImportRequest,
	namespaceName: string,
): ImportRequest {
	const rewritten = rewriteNamespaceReferences(payload, {
		kind: "key",
		name: namespaceName,
	});

	return {
		...rewritten,
		graph: {
			...rewritten.graph,
			namespaces: [],
			namespace_permissions: [],
		},
	};
}

function applyCreateNamespaceOverride(
	payload: ImportRequest,
	namespaceName: string,
	namespaceDescription: string,
): ImportRequest {
	const namespaceRef = buildNamespaceRef(namespaceName);
	const rewritten = rewriteNamespaceReferences(payload, {
		kind: "ref",
		ref: namespaceRef,
	});

	return {
		...rewritten,
		graph: {
			...rewritten.graph,
			namespaces: [
				{
					ref: namespaceRef,
					name: namespaceName,
					description: namespaceDescription,
				},
			],
			namespace_permissions: rewritten.graph.namespace_permissions?.map(
				(permission) => ({
					...permission,
					namespace_key: undefined,
					namespace_ref: namespaceRef,
				}),
			),
		},
	};
}

export function buildImportSubmissionPayload(
	payload: ImportRequest,
	options: ImportPayloadOptions,
): ImportRequest {
	const namespaceName = trimToNonEmpty(options.namespaceName);
	const namespaceDescription = trimToNonEmpty(options.namespaceDescription);
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

	if (options.namespaceMode === "existing_override") {
		if (!namespaceName) {
			throw new Error("Target namespace is required.");
		}

		return applyExistingNamespaceOverride(effectivePayload, namespaceName);
	}

	if (options.namespaceMode === "create_override") {
		if (!namespaceName) {
			throw new Error("Target namespace is required.");
		}
		if (!namespaceDescription) {
			throw new Error("Namespace description is required.");
		}

		effectivePayload = applyCreateNamespaceOverride(
			effectivePayload,
			namespaceName,
			namespaceDescription,
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
