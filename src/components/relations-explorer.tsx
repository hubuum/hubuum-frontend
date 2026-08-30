"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	ChangeEvent,
	FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { CreateModal } from "@/components/create-modal";
import { ObjectDirectoryLookup } from "@/components/object-directory-lookup";
import { ResourceIndexHeading } from "@/components/resource-index-heading";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	fetchClassRelations,
	fetchRelatedClassPaths,
} from "@/lib/api/class-relations";
import { useConfirm } from "@/lib/confirm-context";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1RelationsClassesByRelationId,
	deleteApiV1RelationsObjectsByRelationId,
	getApiV1Classes,
	getApiV1RelationsClasses,
	postApiV1ClassesByClassIdByFromObjectIdRelationsByToClassIdByToObjectId,
} from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	HubuumClassRelation,
	HubuumClassWithPath,
	HubuumObject,
	HubuumObjectRelation,
	HubuumObjectWithPath,
} from "@/lib/api/generated/models";
import {
	fetchObjectRelations,
	fetchRelatedObjects,
} from "@/lib/api/object-relations";
import {
	fetchClassObjectDirectory,
	fetchCollectionsByIds,
} from "@/lib/api/resource-directory";
import { filterClassRelations } from "@/lib/class-relation-filters";
import {
	DESELECT_ALL_EVENT,
	OPEN_CREATE_EVENT,
	type OpenCreateEventDetail,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
} from "@/lib/create-events";
import {
	DEFAULT_INCLUDE_SELF_CLASS,
	MAX_RELATED_OBJECT_DEPTH_LIMIT,
	normalizeRelatedObjectDepthLimit,
} from "@/lib/object-relation-summary";
import { buildResourceSummary } from "@/lib/resource-summary";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useResizableTable } from "@/lib/use-resizable-table";
import { useShiftSelect } from "@/lib/use-shift-select";

function _IconSearch() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.42-1.42-4.44-4.43A6.5 6.5 0 0 0 10.5 4m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9"
				fill="currentColor"
			/>
		</svg>
	);
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const classes: HubuumClassExpanded[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;

	do {
		const response = await getApiV1Classes(
			{ limit: 250, sort: "id.asc", cursor, include_total: false },
			{
				credentials: "include",
			},
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load classes."),
			);
		}

		classes.push(...response.data);
		const nextCursor = response.headers.get("X-Next-Cursor");
		if (!nextCursor) {
			break;
		}
		if (seenCursors.has(nextCursor)) {
			throw new Error("Failed to load classes: pagination cursor repeated.");
		}

		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (cursor);

	return classes;
}

async function parseJsonPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function fetchAllClassRelations(): Promise<HubuumClassRelation[]> {
	const relations: HubuumClassRelation[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;

	do {
		const response = await getApiV1RelationsClasses(
			{ limit: 250, sort: "id.asc", cursor, include_total: false },
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load class relations."),
			);
		}

		relations.push(...response.data);
		const nextCursor = response.headers.get("X-Next-Cursor");
		if (!nextCursor) {
			break;
		}
		if (seenCursors.has(nextCursor)) {
			throw new Error(
				"Failed to load class relations: pagination cursor repeated.",
			);
		}

		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (cursor);

	return relations;
}

async function fetchObjectsByClass(classId: number): Promise<HubuumObject[]> {
	const response = await fetch(`/_hubuum-bff/classes/${classId}/objects`, {
		credentials: "include",
	});
	const payload = await parseJsonPayload(response);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(payload, "Failed to load objects."));
	}

	return expectArrayPayload<HubuumObject>(payload, "class objects");
}

function parseId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type RelationsExplorerProps = {
	mode: "classes" | "objects";
};

type ClassRelationsView = "direct" | "connected";
type ObjectRelationsView = "direct" | "reachable";

type ObjectContext = {
	classId: number;
	name: string;
	collectionId: number;
};

export function RelationsExplorer({ mode }: RelationsExplorerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const isClassMode = mode === "classes";
	const isObjectMode = mode === "objects";

	const sourceClassId = searchParams.get("classId") ?? "";
	const sourceObjectId = searchParams.get("objectId") ?? "";
	const initialClassView = searchParams.get("classView");
	const initialObjectView = searchParams.get("objectView");
	const initialFromClassFilterId = searchParams.get("fromClassId") ?? "";
	const initialToClassFilterId = searchParams.get("toClassId") ?? "";

	const [classRelationsView, setClassRelationsView] =
		useState<ClassRelationsView>(
			initialClassView === "connected" || initialClassView === "transitive"
				? "connected"
				: "direct",
		);
	const [objectRelationsView, setObjectRelationsView] =
		useState<ObjectRelationsView>(
			initialObjectView === "direct" ? "direct" : "reachable",
		);
	const [reachabilityDepth, setReachabilityDepth] = useState(() =>
		normalizeRelatedObjectDepthLimit(searchParams.get("depth")),
	);
	const [classRelationSourceClassId, setClassRelationSourceClassId] =
		useState(sourceClassId);
	const [classRelationTargetClassId, setClassRelationTargetClassId] =
		useState("");
	const [objectRelationTargetClassId, setObjectRelationTargetClassId] =
		useState("");
	const [objectRelationTargetObjectId, setObjectRelationTargetObjectId] =
		useState("");
	const [objectRelationTargetObjectSearch, setObjectRelationTargetObjectSearch] =
		useState("");
	const [fromClassFilterId, setFromClassFilterId] = useState(
		initialFromClassFilterId,
	);
	const [toClassFilterId, setToClassFilterId] = useState(
		initialToClassFilterId,
	);

	const [classRelationError, setClassRelationError] = useState<string | null>(
		null,
	);
	const [classRelationSuccess, setClassRelationSuccess] = useState<
		string | null
	>(null);
	const [objectRelationError, setObjectRelationError] = useState<string | null>(
		null,
	);
	const [objectRelationSuccess, setObjectRelationSuccess] = useState<
		string | null
	>(null);
	const [classTableError, setClassTableError] = useState<string | null>(null);
	const [classTableSuccess, setClassTableSuccess] = useState<string | null>(
		null,
	);
	const [objectTableError, setObjectTableError] = useState<string | null>(null);
	const [objectTableSuccess, setObjectTableSuccess] = useState<string | null>(
		null,
	);
	const [selectedClassRelationIds, setSelectedClassRelationIds] = useState<
		number[]
	>([]);
	const [selectedObjectRelationIds, setSelectedObjectRelationIds] = useState<
		number[]
	>([]);
	const [_pendingClassRelationDeleteIds, setPendingClassRelationDeleteIds] =
		useState<number[]>([]);
	const [_pendingObjectRelationDeleteIds, setPendingObjectRelationDeleteIds] =
		useState<number[]>([]);
	const [isCreateModalOpen, setCreateModalOpen] = useState(false);

	useResizableTable({
		tableId: "class-relations-table",
		storageKey: "class-relations",
	});
	useResizableTable({
		tableId: "object-relations-table",
		storageKey: "object-relations",
	});

	useEffect(() => {
		if (searchParams.get("create") !== "1") {
			return;
		}

		const params = new URLSearchParams(searchParams.toString());
		params.delete("create");
		setCreateModalOpen(true);
		router.replace(
			params.toString() ? `${pathname}?${params.toString()}` : pathname,
		);
	}, [pathname, router, searchParams]);

	const classesQuery = useQuery({
		queryKey: ["classes", "relations-explorer"],
		queryFn: fetchClasses,
	});

	const classes = classesQuery.data ?? [];
	const classNameById = useMemo(() => {
		const map = new Map<number, string>();
		for (const classItem of classes) {
			map.set(classItem.id, classItem.name);
		}
		return map;
	}, [classes]);

	const resolvedSourceClassId = useMemo(() => {
		const parsed = parseId(sourceClassId);
		if (parsed !== null && classes.some((item) => item.id === parsed)) {
			return String(parsed);
		}

		return classes.length ? String(classes[0].id) : "";
	}, [classes, sourceClassId]);
	const parsedSourceClassId = useMemo(
		() => parseId(resolvedSourceClassId),
		[resolvedSourceClassId],
	);
	const resolvedClassRelationSourceClassId = useMemo(() => {
		const parsed = parseId(classRelationSourceClassId);
		if (parsed !== null && classes.some((item) => item.id === parsed)) {
			return String(parsed);
		}

		return resolvedSourceClassId;
	}, [classRelationSourceClassId, classes, resolvedSourceClassId]);
	const parsedClassRelationSourceClassId = useMemo(
		() => parseId(resolvedClassRelationSourceClassId),
		[resolvedClassRelationSourceClassId],
	);
	const parsedClassRelationTargetClassId = useMemo(
		() => parseId(classRelationTargetClassId),
		[classRelationTargetClassId],
	);
	const parsedObjectRelationTargetClassId = useMemo(
		() => parseId(objectRelationTargetClassId),
		[objectRelationTargetClassId],
	);
	const parsedObjectRelationTargetObjectId = useMemo(
		() => parseId(objectRelationTargetObjectId),
		[objectRelationTargetObjectId],
	);
	const parsedFromClassFilterId = useMemo(
		() => parseId(fromClassFilterId),
		[fromClassFilterId],
	);
	const parsedToClassFilterId = useMemo(
		() => parseId(toClassFilterId),
		[toClassFilterId],
	);

	const classRelationsQuery = useQuery({
		queryKey: ["class-relations", parsedSourceClassId],
		queryFn: async () => fetchClassRelations(parsedSourceClassId ?? 0),
		enabled: isObjectMode && parsedSourceClassId !== null,
	});
	const allClassRelationsQuery = useQuery({
		queryKey: ["class-relations", "all"],
		queryFn: fetchAllClassRelations,
		enabled:
			isClassMode && (classRelationsView === "direct" || isCreateModalOpen),
	});
	const classConnectedClassesQuery = useQuery({
		queryKey: ["class-related-classes", parsedSourceClassId],
		queryFn: async () => fetchRelatedClassPaths(parsedSourceClassId ?? 0),
		enabled:
			isClassMode &&
			classRelationsView === "connected" &&
			parsedSourceClassId !== null,
	});
	const sourceObjectsQuery = useQuery({
		queryKey: ["objects", "relations-source", parsedSourceClassId],
		queryFn: async () => fetchObjectsByClass(parsedSourceClassId ?? 0),
		enabled: isObjectMode && parsedSourceClassId !== null,
	});
	const sourceObjects = sourceObjectsQuery.data ?? [];
	const resolvedSourceObjectId = useMemo(() => {
		if (!isObjectMode) {
			return sourceObjectId;
		}

		const parsed = parseId(sourceObjectId);
		if (parsed !== null && sourceObjects.some((item) => item.id === parsed)) {
			return String(parsed);
		}

		return "";
	}, [isObjectMode, sourceObjectId, sourceObjects]);
	const parsedResolvedSourceObjectId = useMemo(
		() => parseId(resolvedSourceObjectId),
		[resolvedSourceObjectId],
	);
	const selectedSourceObject = sourceObjects.find(
		(item) => item.id === parsedResolvedSourceObjectId,
	);

	const classRelationTargetOptions = useMemo(
		() =>
			classes.filter(
				(classItem) => classItem.id !== parsedClassRelationSourceClassId,
			),
		[classes, parsedClassRelationSourceClassId],
	);
	const relatedTargetClassIds = useMemo(() => {
		const ids = new Set<number>();
		if (parsedSourceClassId === null) {
			return ids;
		}

		const directClassRelations = Array.isArray(classRelationsQuery.data)
			? classRelationsQuery.data
			: [];
		for (const relation of directClassRelations) {
			if (relation.from_hubuum_class_id === parsedSourceClassId) {
				ids.add(relation.to_hubuum_class_id);
				continue;
			}

			if (relation.to_hubuum_class_id === parsedSourceClassId) {
				ids.add(relation.from_hubuum_class_id);
			}
		}

		return ids;
	}, [classRelationsQuery.data, parsedSourceClassId]);
	const objectRelationTargetClassOptions = useMemo(
		() =>
			classes.filter((classItem) => relatedTargetClassIds.has(classItem.id)),
		[classes, relatedTargetClassIds],
	);

	const objectRelationTargetObjectSearchTerm =
		objectRelationTargetObjectSearch.trim();
	const objectRelationTargetObjectSearchMinimum = 3;
	const debouncedObjectRelationTargetObjectSearchTerm = useDebouncedValue(
		objectRelationTargetObjectSearchTerm,
		300,
	);
	const objectRelationTargetObjectSearchIsReady =
		objectRelationTargetObjectSearchTerm.length >=
			objectRelationTargetObjectSearchMinimum &&
		debouncedObjectRelationTargetObjectSearchTerm ===
			objectRelationTargetObjectSearchTerm;
	const targetObjectsQuery = useQuery({
		queryKey: [
			"relation-target-object-directory",
			parsedObjectRelationTargetClassId,
			debouncedObjectRelationTargetObjectSearchTerm,
		],
		queryFn: () =>
			fetchClassObjectDirectory(
				parsedObjectRelationTargetClassId ?? 0,
				debouncedObjectRelationTargetObjectSearchTerm,
			),
		enabled:
			isObjectMode &&
			isCreateModalOpen &&
			parsedObjectRelationTargetClassId !== null &&
			objectRelationTargetObjectSearchIsReady,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
	const relatedObjectsQuery = useQuery({
		queryKey: [
			"object-related-objects",
			parsedSourceClassId,
			parsedResolvedSourceObjectId,
			objectRelationsView === "reachable" ? reachabilityDepth : 1,
		],
		queryFn: async () =>
			fetchRelatedObjects(
				parsedSourceClassId ?? 0,
				parsedResolvedSourceObjectId ?? 0,
				{
					depthLimit:
						objectRelationsView === "reachable" ? reachabilityDepth : 1,
					ignoredClassIds: [],
					includeSelfClass: DEFAULT_INCLUDE_SELF_CLASS,
				},
			),
		enabled:
			isObjectMode &&
			parsedSourceClassId !== null &&
			parsedResolvedSourceObjectId !== null,
	});
	const objectDirectRelationsQuery = useQuery({
		queryKey: [
			"object-relations-direct",
			parsedSourceClassId,
			parsedResolvedSourceObjectId,
		],
		queryFn: async () =>
			fetchObjectRelations(
				parsedSourceClassId ?? 0,
				parsedResolvedSourceObjectId ?? 0,
			),
		enabled:
			isObjectMode &&
			objectRelationsView === "direct" &&
			parsedSourceClassId !== null &&
			parsedResolvedSourceObjectId !== null,
	});

	const targetObjects = objectRelationTargetObjectSearchIsReady
		? (targetObjectsQuery.data?.items ?? [])
		: [];
	const scopedClassRelations = Array.isArray(classRelationsQuery.data)
		? classRelationsQuery.data
		: [];
	const allClassRelations = Array.isArray(allClassRelationsQuery.data)
		? allClassRelationsQuery.data
		: [];
	const classDirectRelations = useMemo(
		() =>
			filterClassRelations(allClassRelations, {
				fromClassId: parsedFromClassFilterId,
				toClassId: parsedToClassFilterId,
			}),
		[allClassRelations, parsedFromClassFilterId, parsedToClassFilterId],
	);
	const connectedClasses = Array.isArray(classConnectedClassesQuery.data)
		? classConnectedClassesQuery.data.filter(
				(classItem) => classItem.id !== parsedSourceClassId,
			)
		: [];
	const relatedObjects = Array.isArray(relatedObjectsQuery.data)
		? relatedObjectsQuery.data
		: [];
	const objectDirectRelations = Array.isArray(objectDirectRelationsQuery.data)
		? objectDirectRelationsQuery.data
		: [];
	const referencedCollectionIds = useMemo(() => {
		const ids = new Set<number>();
		for (const connectedClass of connectedClasses) {
			ids.add(connectedClass.collection_id);
		}
		for (const objectItem of [
			...sourceObjects,
			...targetObjects,
			...relatedObjects,
		]) {
			ids.add(objectItem.collection_id);
		}
		return Array.from(ids).sort((left, right) => left - right);
	}, [connectedClasses, relatedObjects, sourceObjects, targetObjects]);
	const referencedCollectionsQuery = useQuery({
		queryKey: [
			"collections",
			"relations-explorer",
			referencedCollectionIds,
		],
		queryFn: async () => fetchCollectionsByIds(referencedCollectionIds),
		enabled: referencedCollectionIds.length > 0,
	});
	const collectionNameById = useMemo(() => {
		const map = new Map<number, string>();
		for (const classItem of classes) {
			map.set(classItem.collection.id, classItem.collection.name);
		}
		for (const collection of referencedCollectionsQuery.data ?? []) {
			map.set(collection.id, collection.name);
		}
		return map;
	}, [classes, referencedCollectionsQuery.data]);

	const classRelationsShiftSelect = useShiftSelect({
		items: classDirectRelations,
		selectedIds: selectedClassRelationIds,
		setSelectedIds: setSelectedClassRelationIds,
		getId: (relation) => relation.id,
	});

	const objectRelationsShiftSelect = useShiftSelect({
		items: objectDirectRelations,
		selectedIds: selectedObjectRelationIds,
		setSelectedIds: setSelectedObjectRelationIds,
		getId: (relation) => relation.id,
	});

	const classRelationById = useMemo(() => {
		const map = new Map<number, HubuumClassRelation>();
		for (const relation of scopedClassRelations) {
			map.set(relation.id, relation);
		}
		return map;
	}, [scopedClassRelations]);

	const objectContextById = useMemo(() => {
		const map = new Map<number, ObjectContext>();

		const store = (objectItem: {
			hubuum_class_id: number;
			id: number;
			name: string;
			collection_id: number;
		}) => {
			map.set(objectItem.id, {
				classId: objectItem.hubuum_class_id,
				name: objectItem.name,
				collectionId: objectItem.collection_id,
			});
		};

		for (const objectItem of sourceObjects) {
			store(objectItem);
		}
		for (const objectItem of targetObjects) {
			store(objectItem);
		}
		for (const objectItem of relatedObjects) {
			store(objectItem);
		}
		if (selectedSourceObject) {
			store(selectedSourceObject);
		}

		return map;
	}, [relatedObjects, selectedSourceObject, sourceObjects, targetObjects]);

	const classRelationExists =
		parsedClassRelationSourceClassId !== null &&
		parsedClassRelationTargetClassId !== null &&
		allClassRelations.some(
			(relation) =>
				(relation.from_hubuum_class_id === parsedClassRelationSourceClassId &&
					relation.to_hubuum_class_id === parsedClassRelationTargetClassId) ||
				(relation.to_hubuum_class_id === parsedClassRelationSourceClassId &&
					relation.from_hubuum_class_id === parsedClassRelationTargetClassId),
		);

	useEffect(() => {
		if (!pathname) {
			return;
		}

		const params = new URLSearchParams(window.location.search);
		if (
			resolvedSourceClassId &&
			(!isClassMode || classRelationsView === "connected")
		) {
			params.set("classId", resolvedSourceClassId);
		} else {
			params.delete("classId");
		}

		if (isClassMode) {
			params.set("classView", classRelationsView);
			if (fromClassFilterId) {
				params.set("fromClassId", fromClassFilterId);
			} else {
				params.delete("fromClassId");
			}
			if (toClassFilterId) {
				params.set("toClassId", toClassFilterId);
			} else {
				params.delete("toClassId");
			}
			params.delete("objectView");
			params.delete("objectId");
			params.delete("depth");
		} else if (isObjectMode) {
			params.set("objectView", objectRelationsView);
			params.set("depth", String(reachabilityDepth));
			params.delete("classView");
			if (resolvedSourceObjectId) {
				params.set("objectId", resolvedSourceObjectId);
			} else {
				params.delete("objectId");
			}
			params.delete("fromClassId");
			params.delete("toClassId");
		}

		const nextQuery = params.toString();
		const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
		const currentUrl = `${window.location.pathname}${window.location.search}`;
		if (nextUrl !== currentUrl) {
			window.history.replaceState(window.history.state, "", nextUrl);
		}
	}, [
		classRelationsView,
		fromClassFilterId,
		isClassMode,
		isObjectMode,
		objectRelationsView,
		pathname,
		reachabilityDepth,
		resolvedSourceClassId,
		resolvedSourceObjectId,
		toClassFilterId,
	]);

	useEffect(() => {
		if (!classes.length) {
			return;
		}

		if (
			parsedFromClassFilterId !== null &&
			!classes.some((classItem) => classItem.id === parsedFromClassFilterId)
		) {
			setFromClassFilterId("");
		}
		if (
			parsedToClassFilterId !== null &&
			!classes.some((classItem) => classItem.id === parsedToClassFilterId)
		) {
			setToClassFilterId("");
		}
	}, [classes, parsedFromClassFilterId, parsedToClassFilterId]);

	useEffect(() => {
		if (!isClassMode) {
			return;
		}

		if (!classRelationTargetOptions.length) {
			setClassRelationTargetClassId("");
			return;
		}

		const exists = classRelationTargetOptions.some(
			(item) => String(item.id) === classRelationTargetClassId,
		);
		if (!exists) {
			setClassRelationTargetClassId(String(classRelationTargetOptions[0].id));
		}
	}, [classRelationTargetClassId, classRelationTargetOptions, isClassMode]);

	useEffect(() => {
		if (!isObjectMode) {
			return;
		}

		if (!objectRelationTargetClassOptions.length) {
			setObjectRelationTargetClassId("");
			setObjectRelationTargetObjectId("");
			setObjectRelationTargetObjectSearch("");
			return;
		}

		const exists = objectRelationTargetClassOptions.some(
			(item) => String(item.id) === objectRelationTargetClassId,
		);
		if (!exists) {
			setObjectRelationTargetClassId(
				String(objectRelationTargetClassOptions[0].id),
			);
			setObjectRelationTargetObjectId("");
			setObjectRelationTargetObjectSearch("");
		}
	}, [
		isObjectMode,
		objectRelationTargetClassId,
		objectRelationTargetClassOptions,
	]);

	useEffect(() => {
		if (!selectedClassRelationIds.length) {
			return;
		}

		const existingIds = new Set(
			classDirectRelations.map((relation) => relation.id),
		);
		setSelectedClassRelationIds((current) =>
			current.filter((relationId) => existingIds.has(relationId)),
		);
	}, [classDirectRelations, selectedClassRelationIds.length]);

	useEffect(() => {
		if (!selectedObjectRelationIds.length) {
			return;
		}

		const existingIds = new Set(
			objectDirectRelations.map((relation) => relation.id),
		);
		setSelectedObjectRelationIds((current) =>
			current.filter((relationId) => existingIds.has(relationId)),
		);
	}, [objectDirectRelations, selectedObjectRelationIds.length]);

	useEffect(() => {
		if (
			(classRelationsView === "direct" || classRelationsView === "connected") &&
			(parsedSourceClassId === null || parsedSourceClassId > 0)
		) {
			setSelectedClassRelationIds([]);
			setClassTableError(null);
			setClassTableSuccess(null);
		}
	}, [classRelationsView, parsedSourceClassId]);

	useEffect(() => {
		if (
			(objectRelationsView === "direct" ||
				objectRelationsView === "reachable") &&
			(parsedResolvedSourceObjectId === null ||
				parsedResolvedSourceObjectId > 0)
		) {
			setSelectedObjectRelationIds([]);
			setObjectTableError(null);
			setObjectTableSuccess(null);
		}
	}, [objectRelationsView, parsedResolvedSourceObjectId]);

	useEffect(() => {
		const onOpenCreate = (event: Event) => {
			const customEvent = event as CustomEvent<OpenCreateEventDetail>;
			if (customEvent.detail?.section !== "relations") {
				return;
			}

			setCreateModalOpen(true);
		};

		window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
		return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
	}, []);

	useEffect(() => {
		const onDeselectAll = () => {
			setSelectedClassRelationIds([]);
			setSelectedObjectRelationIds([]);
		};

		const onSelectAll = () => {
			if (isClassMode && classRelationsView === "direct") {
				setSelectedClassRelationIds(classDirectRelations.map((rel) => rel.id));
			} else if (isObjectMode && objectRelationsView === "direct") {
				setSelectedObjectRelationIds(
					objectDirectRelations.map((rel) => rel.id),
				);
			}
		};

		window.addEventListener(DESELECT_ALL_EVENT, onDeselectAll);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener(DESELECT_ALL_EVENT, onDeselectAll);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [
		isClassMode,
		isObjectMode,
		classRelationsView,
		objectRelationsView,
		classDirectRelations,
		objectDirectRelations,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: deleteSelectedClassRelations and deleteSelectedObjectRelations are stable closures
	useEffect(() => {
		if (isClassMode && classRelationsView === "direct") {
			window.dispatchEvent(
				new CustomEvent(SELECTION_STATE_EVENT, {
					detail: {
						count: selectedClassRelationIds.length,
						deleteHandler:
							selectedClassRelationIds.length > 0
								? deleteSelectedClassRelations
								: null,
					},
				}),
			);
		} else if (isObjectMode && objectRelationsView === "direct") {
			window.dispatchEvent(
				new CustomEvent(SELECTION_STATE_EVENT, {
					detail: {
						count: selectedObjectRelationIds.length,
						deleteHandler:
							selectedObjectRelationIds.length > 0
								? deleteSelectedObjectRelations
								: null,
					},
				}),
			);
		} else {
			// Clear FAB when in non-direct views
			window.dispatchEvent(
				new CustomEvent(SELECTION_STATE_EVENT, {
					detail: {
						count: 0,
						deleteHandler: null,
					},
				}),
			);
		}
	}, [
		isClassMode,
		isObjectMode,
		classRelationsView,
		objectRelationsView,
		selectedClassRelationIds.length,
		selectedObjectRelationIds.length,
	]);

	const createClassRelationMutation = useMutation({
		mutationFn: async (payload: {
			sourceClassId: number;
			targetClassId: number;
		}) => {
			const response = await fetch(
				`/_hubuum-bff/classes/${payload.sourceClassId}/relations`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					credentials: "include",
					body: JSON.stringify({
						to_hubuum_class_id: payload.targetClassId,
					}),
				},
			);
			const responsePayload = await parseJsonPayload(response);

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(
						responsePayload,
						"Failed to create class relation.",
					),
				);
			}
		},
		onSuccess: async (_result, variables) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["class-relations", variables.sourceClassId],
				}),
				queryClient.invalidateQueries({
					queryKey: ["class-relations", "all"],
				}),
				queryClient.invalidateQueries({
					queryKey: ["class-related-classes", variables.sourceClassId],
				}),
			]);
			setClassRelationError(null);
			setClassRelationSuccess("Class relation created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setClassRelationSuccess(null);
			setClassRelationError(
				error instanceof Error
					? error.message
					: "Failed to create class relation.",
			);
		},
	});

	const createObjectRelationMutation = useMutation({
		mutationFn: async (payload: {
			sourceClassId: number;
			sourceObjectId: number;
			targetClassId: number;
			targetObjectId: number;
		}) => {
			const response =
				await postApiV1ClassesByClassIdByFromObjectIdRelationsByToClassIdByToObjectId(
					payload.sourceClassId,
					payload.sourceObjectId,
					payload.targetClassId,
					payload.targetObjectId,
					{
						credentials: "include",
					},
				);

			if (response.status !== 201) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to create object relation.",
					),
				);
			}
		},
		onSuccess: async (_result, variables) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [
						"object-related-objects",
						variables.sourceClassId,
						variables.sourceObjectId,
					],
				}),
				queryClient.invalidateQueries({
					queryKey: [
						"object-relations-direct",
						variables.sourceClassId,
						variables.sourceObjectId,
					],
				}),
			]);
			setObjectRelationError(null);
			setObjectRelationSuccess("Object relation created.");
			setCreateModalOpen(false);
		},
		onError: (error) => {
			setObjectRelationSuccess(null);
			setObjectRelationError(
				error instanceof Error
					? error.message
					: "Failed to create object relation.",
			);
		},
	});

	const deleteClassRelationsMutation = useMutation({
		mutationFn: async (relationIds: number[]) => {
			await Promise.all(
				relationIds.map(async (relationId) => {
					const response = await deleteApiV1RelationsClassesByRelationId(
						relationId,
						{
							credentials: "include",
						},
					);

					if (response.status !== 204) {
						throw new Error(
							`#${relationId}: ${getApiErrorMessage(response.data, "Failed to delete class relation.")}`,
						);
					}
				}),
			);

			return relationIds.length;
		},
		onMutate: (relationIds) => {
			setPendingClassRelationDeleteIds(relationIds);
			setClassTableError(null);
			setClassTableSuccess(null);
		},
		onSuccess: async (count) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["class-relations"] }),
				queryClient.invalidateQueries({ queryKey: ["class-related-classes"] }),
				queryClient.invalidateQueries({ queryKey: ["object-related-objects"] }),
				queryClient.invalidateQueries({
					queryKey: ["object-relations-direct"],
				}),
			]);
			setSelectedClassRelationIds([]);
			setClassTableError(null);
			setClassTableSuccess(
				`${count} class relation${count === 1 ? "" : "s"} deleted.`,
			);
		},
		onError: (error) => {
			setClassTableSuccess(null);
			setClassTableError(
				error instanceof Error
					? error.message
					: "Failed to delete class relations.",
			);
		},
		onSettled: () => {
			setPendingClassRelationDeleteIds([]);
		},
	});

	const deleteObjectRelationsMutation = useMutation({
		mutationFn: async (relationIds: number[]) => {
			await Promise.all(
				relationIds.map(async (relationId) => {
					const response = await deleteApiV1RelationsObjectsByRelationId(
						relationId,
						{
							credentials: "include",
						},
					);

					if (response.status !== 204) {
						throw new Error(
							`#${relationId}: ${getApiErrorMessage(response.data, "Failed to delete object relation.")}`,
						);
					}
				}),
			);

			return relationIds.length;
		},
		onMutate: (relationIds) => {
			setPendingObjectRelationDeleteIds(relationIds);
			setObjectTableError(null);
			setObjectTableSuccess(null);
		},
		onSuccess: async (count) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["object-related-objects"] }),
				queryClient.invalidateQueries({
					queryKey: ["object-relations-direct"],
				}),
			]);
			setSelectedObjectRelationIds([]);
			setObjectTableError(null);
			setObjectTableSuccess(
				`${count} object relation${count === 1 ? "" : "s"} deleted.`,
			);
		},
		onError: (error) => {
			setObjectTableSuccess(null);
			setObjectTableError(
				error instanceof Error
					? error.message
					: "Failed to delete object relations.",
			);
		},
		onSettled: () => {
			setPendingObjectRelationDeleteIds([]);
		},
	});

	const deleteSelectedClassRelations = useCallback(async () => {
		if (!selectedClassRelationIds.length) {
			return;
		}

		const confirmed = await confirm({
			title: `Delete ${selectedClassRelationIds.length} selected class relation${
				selectedClassRelationIds.length === 1 ? "" : "s"
			}?`,
			description: "This removes the selected class relations.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteClassRelationsMutation.mutate([...selectedClassRelationIds]);
	}, [confirm, selectedClassRelationIds, deleteClassRelationsMutation]);

	const deleteSelectedObjectRelations = useCallback(async () => {
		if (!selectedObjectRelationIds.length) {
			return;
		}

		const confirmed = await confirm({
			title: `Delete ${selectedObjectRelationIds.length} selected object relation${
				selectedObjectRelationIds.length === 1 ? "" : "s"
			}?`,
			description: "This removes the selected object relations.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteObjectRelationsMutation.mutate([...selectedObjectRelationIds]);
	}, [confirm, selectedObjectRelationIds, deleteObjectRelationsMutation]);

	function onCreateClassRelation(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setClassRelationError(null);
		setClassRelationSuccess(null);

		if (
			parsedClassRelationSourceClassId === null ||
			parsedClassRelationTargetClassId === null
		) {
			setClassRelationError("Select both classes in the relation pair.");
			return;
		}

		if (parsedClassRelationSourceClassId === parsedClassRelationTargetClassId) {
			setClassRelationError("From and to classes must be different.");
			return;
		}

		if (classRelationExists) {
			setClassRelationError("This class relation already exists.");
			return;
		}

		createClassRelationMutation.mutate({
			sourceClassId: parsedClassRelationSourceClassId,
			targetClassId: parsedClassRelationTargetClassId,
		});
	}

	function onCreateObjectRelation(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setObjectRelationError(null);
		setObjectRelationSuccess(null);

		if (
			parsedSourceClassId === null ||
			parsedResolvedSourceObjectId === null ||
			parsedObjectRelationTargetClassId === null ||
			parsedObjectRelationTargetObjectId === null
		) {
			setObjectRelationError(
				"Select both objects and classes in the relation pair.",
			);
			return;
		}

		if (parsedObjectRelationTargetClassId === parsedSourceClassId) {
			setObjectRelationError(
				"Connected class must be different from the current class.",
			);
			return;
		}

		if (!relatedTargetClassIds.has(parsedObjectRelationTargetClassId)) {
			setObjectRelationError(
				"Connected class must already be related to the current class.",
			);
			return;
		}

		createObjectRelationMutation.mutate({
			sourceClassId: parsedSourceClassId,
			sourceObjectId: parsedResolvedSourceObjectId,
			targetClassId: parsedObjectRelationTargetClassId,
			targetObjectId: parsedObjectRelationTargetObjectId,
		});
	}

	const selectedClass = classes.find((item) => item.id === parsedSourceClassId);
	const canCreateClassRelation =
		parsedClassRelationSourceClassId !== null &&
		parsedClassRelationTargetClassId !== null &&
		parsedClassRelationTargetClassId !== parsedClassRelationSourceClassId &&
		!allClassRelationsQuery.isLoading &&
		!allClassRelationsQuery.isError &&
		!classRelationExists;
	const canCreateObjectRelation =
		parsedSourceClassId !== null &&
		parsedResolvedSourceObjectId !== null &&
		parsedObjectRelationTargetClassId !== null &&
		parsedObjectRelationTargetObjectId !== null &&
		parsedObjectRelationTargetClassId !== parsedSourceClassId &&
		relatedTargetClassIds.has(parsedObjectRelationTargetClassId);
	const hasClassRelationFilters =
		parsedFromClassFilterId !== null || parsedToClassFilterId !== null;

	const allClassRelationsSelected =
		classDirectRelations.length > 0 &&
		selectedClassRelationIds.length === classDirectRelations.length;
	const allObjectRelationsSelected =
		objectDirectRelations.length > 0 &&
		selectedObjectRelationIds.length === objectDirectRelations.length;

	function renderClassById(classId: number): string {
		const className = classNameById.get(classId);
		return className ?? `Class #${classId}`;
	}

	function renderCollectionById(collectionId: number): string {
		const collectionName = collectionNameById.get(collectionId);
		return collectionName ?? `Collection #${collectionId}`;
	}

	function renderObjectById(objectId: number): string {
		const objectInfo = objectContextById.get(objectId);
		if (!objectInfo) {
			return `Object #${objectId}`;
		}

		const className = classNameById.get(objectInfo.classId);
		return className ? `${className} / ${objectInfo.name}` : objectInfo.name;
	}

	function renderObjectRelationLabel(relation: HubuumObjectRelation): string {
		const sourceObject = objectContextById.get(relation.from_hubuum_object_id);
		const targetObject = objectContextById.get(relation.to_hubuum_object_id);
		if (sourceObject?.classId && targetObject?.classId) {
			return `${renderClassById(sourceObject.classId)} / ${renderClassById(targetObject.classId)}`;
		}

		const classRelation = classRelationById.get(relation.class_relation_id);
		if (classRelation) {
			return `${renderClassById(classRelation.from_hubuum_class_id)} / ${renderClassById(classRelation.to_hubuum_class_id)}`;
		}

		return "Related object link";
	}

	function getDisplayObjectPath(path: number[], targetId?: number): number[] {
		const normalizedPath = path.length ? [...path] : targetId ? [targetId] : [];
		const trimmedPath =
			normalizedPath[0] === parsedResolvedSourceObjectId
				? normalizedPath.slice(1)
				: normalizedPath;
		if (targetId && trimmedPath[trimmedPath.length - 1] !== targetId) {
			trimmedPath.push(targetId);
		}

		return trimmedPath;
	}

	function renderObjectLink(objectId: number) {
		const objectInfo = objectContextById.get(objectId);
		return objectInfo ? (
			<Link
				href={`/objects/${objectInfo.classId}/${objectId}`}
				className="row-link"
			>
				{renderObjectById(objectId)}
			</Link>
		) : (
			<span>{renderObjectById(objectId)}</span>
		);
	}

	function renderObjectPath(path: number[], targetId?: number) {
		const displayPath = getDisplayObjectPath(path, targetId);
		if (!displayPath.length) {
			return "-";
		}

		return (
			<>
				{displayPath.map((pathObjectId, index) => (
					<span
						key={`${targetId ?? "path"}-${displayPath.slice(0, index + 1).join("-")}`}
					>
						{index > 0 ? " / " : null}
						{renderObjectLink(pathObjectId)}
					</span>
				))}
			</>
		);
	}

	function getDisplayClassPath(path: number[], targetId: number): number[] {
		const normalizedPath = path.length ? [...path] : [targetId];
		const trimmedPath =
			normalizedPath[0] === parsedSourceClassId
				? normalizedPath.slice(1)
				: normalizedPath;
		if (trimmedPath[trimmedPath.length - 1] !== targetId) {
			trimmedPath.push(targetId);
		}

		return trimmedPath;
	}

	function renderClassLink(classId: number) {
		return (
			<Link href={`/classes/${classId}`} className="row-link">
				{renderClassById(classId)}
			</Link>
		);
	}

	function renderClassPath(path: number[], targetId: number) {
		const displayPath = getDisplayClassPath(path, targetId);
		if (!displayPath.length) {
			return "-";
		}

		return (
			<>
				{displayPath.map((pathClassId, index) => (
					<span
						key={`${targetId}-${displayPath.slice(0, index + 1).join("-")}`}
					>
						{index > 0 ? " / " : null}
						{renderClassLink(pathClassId)}
					</span>
				))}
			</>
		);
	}

	const directClassRelationsExportView = {
		id: "all-direct-class-relations",
		fileName: "class-relations",
		sheetName: "Direct class relations",
		columns: [
			{
				key: "id",
				label: "ID",
				getValue: (relation: HubuumClassRelation) => relation.id,
			},
			{
				key: "from_class",
				label: "From class",
				getValue: (relation: HubuumClassRelation) =>
					renderClassById(relation.from_hubuum_class_id),
			},
			{
				key: "to_class",
				label: "To class",
				getValue: (relation: HubuumClassRelation) =>
					renderClassById(relation.to_hubuum_class_id),
			},
		],
		rows: classDirectRelations,
	};
	const connectedClassesExportView = {
		id: `class-${parsedSourceClassId ?? "unselected"}-connected-classes`,
		fileName: `class-${parsedSourceClassId ?? "unselected"}-connected-classes`,
		sheetName: "Connected classes",
		columns: [
			{
				key: "class",
				label: "Class",
				getValue: (connectedClass: HubuumClassWithPath) =>
					renderClassById(connectedClass.id),
			},
			{
				key: "collection",
				label: "Collection",
				getValue: (connectedClass: HubuumClassWithPath) =>
					renderCollectionById(connectedClass.collection_id),
			},
			{
				key: "hops",
				label: "Hops",
				getValue: (connectedClass: HubuumClassWithPath) =>
					Math.max(
						getDisplayClassPath(connectedClass.path, connectedClass.id).length -
							1,
						0,
					),
			},
			{
				key: "path",
				label: "Path",
				getValue: (connectedClass: HubuumClassWithPath) => {
					const path = getDisplayClassPath(
						connectedClass.path,
						connectedClass.id,
					);
					return path.length
						? path.map((classId) => renderClassById(classId)).join(" / ")
						: "-";
				},
			},
		],
		rows: connectedClasses,
	};
	const directObjectRelationsExportView = {
		id: `object-${parsedResolvedSourceObjectId ?? "unselected"}-direct-relations`,
		fileName: `object-${parsedResolvedSourceObjectId ?? "unselected"}-direct-relations`,
		sheetName: "Direct object relations",
		columns: [
			{
				key: "related_object",
				label: "Related object",
				getValue: (relation: HubuumObjectRelation) => {
					const relatedObjectId =
						relation.from_hubuum_object_id === parsedResolvedSourceObjectId
							? relation.to_hubuum_object_id
							: relation.from_hubuum_object_id;
					return renderObjectById(relatedObjectId);
				},
			},
			{
				key: "relation",
				label: "Relation",
				getValue: (relation: HubuumObjectRelation) =>
					renderObjectRelationLabel(relation),
			},
		],
		rows: objectDirectRelations,
	};
	const reachableObjectsExportView = {
		id: `object-${parsedResolvedSourceObjectId ?? "unselected"}-reachable-objects`,
		fileName: `object-${parsedResolvedSourceObjectId ?? "unselected"}-reachable-objects`,
		sheetName: "Reachable objects",
		columns: [
			{
				key: "object",
				label: "Object",
				getValue: (relation: HubuumObjectWithPath) =>
					renderObjectById(relation.id),
			},
			{
				key: "collection",
				label: "Collection",
				getValue: (relation: HubuumObjectWithPath) =>
					renderCollectionById(relation.collection_id),
			},
			{
				key: "path",
				label: "Path",
				getValue: (relation: HubuumObjectWithPath) => {
					const path = getDisplayObjectPath(relation.path, relation.id);
					return path.length
						? path.map((objectId) => renderObjectById(objectId)).join(" / ")
						: "-";
				},
			},
		],
		rows: relatedObjects,
	};

	function onClassRelationsViewChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextView =
			event.target.value === "connected" ? "connected" : "direct";
		setClassRelationsView(nextView);
	}

	function onObjectRelationsViewChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextView = event.target.value === "direct" ? "direct" : "reachable";
		setObjectRelationsView(nextView);
	}

	function onContextClassChange(event: ChangeEvent<HTMLSelectElement>) {
		const params = new URLSearchParams(searchParams.toString());
		const nextClassId = event.target.value;

		if (nextClassId) {
			params.set("classId", nextClassId);
		} else {
			params.delete("classId");
		}
		params.delete("objectId");

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function onContextObjectChange(event: ChangeEvent<HTMLSelectElement>) {
		const params = new URLSearchParams(searchParams.toString());
		const nextObjectId = event.target.value;

		if (resolvedSourceClassId) {
			params.set("classId", resolvedSourceClassId);
		}
		if (nextObjectId) {
			params.set("objectId", nextObjectId);
		} else {
			params.delete("objectId");
		}

		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function _deleteClassRelation(relationId: number) {
		if (!window.confirm(`Delete class relation #${relationId}?`)) {
			return;
		}

		deleteClassRelationsMutation.mutate([relationId]);
	}

	function _deleteObjectRelation(relationId: number) {
		if (!window.confirm(`Delete object relation #${relationId}?`)) {
			return;
		}

		deleteObjectRelationsMutation.mutate([relationId]);
	}

	function renderCreateClassRelationForm() {
		return (
			<form className="stack" onSubmit={onCreateClassRelation}>
				<div className="object-detail-list">
					<section className="object-detail-row">
						<div className="object-detail-label">From class</div>
						<div className="object-detail-body">
							<label className="control-field">
								<span className="sr-only">From class</span>
								<select
									value={resolvedClassRelationSourceClassId}
									onChange={(event) =>
										setClassRelationSourceClassId(event.target.value)
									}
									disabled={!classes.length}
								>
									{!classes.length ? (
										<option value="">No classes available</option>
									) : null}
									{classes.map((hubuumClass) => (
										<option key={hubuumClass.id} value={hubuumClass.id}>
											{hubuumClass.name} (#{hubuumClass.id})
										</option>
									))}
								</select>
							</label>
						</div>
						<div className="object-detail-row-actions" />
					</section>

					<section className="object-detail-row">
						<div className="object-detail-label">To class</div>
						<div className="object-detail-body">
							<label className="control-field">
								<span className="sr-only">To class</span>
								<select
									value={classRelationTargetClassId}
									onChange={(event) =>
										setClassRelationTargetClassId(event.target.value)
									}
									disabled={!classRelationTargetOptions.length}
								>
									{!classRelationTargetOptions.length ? (
										<option value="">No eligible connected classes</option>
									) : null}
									{classRelationTargetOptions.map((hubuumClass) => (
										<option key={hubuumClass.id} value={hubuumClass.id}>
											{hubuumClass.name} (#{hubuumClass.id})
										</option>
									))}
								</select>
							</label>
						</div>
						<div className="object-detail-row-actions" />
					</section>
				</div>

				{classRelationError ? (
					<div className="error-banner">{classRelationError}</div>
				) : null}
				{allClassRelationsQuery.isError ? (
					<div className="error-banner">
						Failed to load existing class relations. Try again before creating a
						relation.
					</div>
				) : null}
				{!classRelationTargetOptions.length ? (
					<div className="muted">
						Create at least two classes to add class relations.
					</div>
				) : null}
				{classRelationSuccess ? (
					<div className="muted">{classRelationSuccess}</div>
				) : null}

				<div className="form-actions">
					<button
						type="submit"
						disabled={
							createClassRelationMutation.isPending || !canCreateClassRelation
						}
					>
						{createClassRelationMutation.isPending
							? "Creating..."
							: "Create class relation"}
					</button>
				</div>
			</form>
		);
	}

	function renderCreateObjectRelationForm() {
		return (
			<form className="stack" onSubmit={onCreateObjectRelation}>
				<div className="object-detail-list">
					<section className="object-detail-row">
						<div className="object-detail-label">Current class</div>
						<div className="object-detail-body">
							<div className="object-detail-value">
								{selectedClass
									? `${selectedClass.name} (#${selectedClass.id})`
									: "Select current class in the top bar"}
							</div>
						</div>
						<div className="object-detail-row-actions" />
					</section>

					<section className="object-detail-row">
						<div className="object-detail-label">Current object</div>
						<div className="object-detail-body">
							<div className="object-detail-value">
								{selectedSourceObject
									? `${selectedSourceObject.name} (#${selectedSourceObject.id})`
									: "Select current object in the top bar"}
							</div>
						</div>
						<div className="object-detail-row-actions" />
					</section>

					<section className="object-detail-row">
						<div className="object-detail-label">Connected class</div>
						<div className="object-detail-body">
							<label className="control-field">
								<span className="sr-only">Connected class</span>
								<select
									value={objectRelationTargetClassId}
									onChange={(event) => {
										setObjectRelationTargetClassId(event.target.value);
										setObjectRelationTargetObjectId("");
										setObjectRelationTargetObjectSearch("");
									}}
									disabled={!objectRelationTargetClassOptions.length}
								>
									{!objectRelationTargetClassOptions.length ? (
										<option value="">No eligible connected classes</option>
									) : null}
									{objectRelationTargetClassOptions.map((hubuumClass) => (
										<option key={hubuumClass.id} value={hubuumClass.id}>
											{hubuumClass.name} (#{hubuumClass.id})
										</option>
									))}
								</select>
							</label>
						</div>
						<div className="object-detail-row-actions" />
					</section>

					<section className="object-detail-row">
						<div className="object-detail-label">Connected object</div>
						<div className="object-detail-body">
							<ObjectDirectoryLookup
								disabled={parsedObjectRelationTargetClassId === null}
								disabledHint="Choose a connected class first"
								helperText={
									parsedObjectRelationTargetObjectId !== null
										? `Selected ${objectRelationTargetObjectSearch} (#${parsedObjectRelationTargetObjectId}).`
										: objectRelationTargetObjectSearchTerm.length <
												objectRelationTargetObjectSearchMinimum
											? "Type at least three characters to search by object name or ID."
											: targetObjectsQuery.isLoading ||
													!objectRelationTargetObjectSearchIsReady
												? "Searching objects visible to your account…"
												: targetObjectsQuery.isError
													? "Object lookup is unavailable. Try again."
													: targetObjectsQuery.data?.isPartial
														? "More than 50 objects match; type more to narrow the results."
														: targetObjects.length === 0
															? "No matching objects are visible in this class."
															: "Choose an object from the results."
								}
								idPrefix="relation-target-object"
								inputLabel="Connected object name or ID"
								objects={targetObjects}
								onChange={(value) => {
									setObjectRelationTargetObjectSearch(value);
									setObjectRelationTargetObjectId("");
								}}
								onSelect={(objectItem) => {
									setObjectRelationTargetObjectId(String(objectItem.id));
									setObjectRelationTargetObjectSearch(objectItem.name);
								}}
								value={objectRelationTargetObjectSearch}
								variant="inline"
							/>
						</div>
						<div className="object-detail-row-actions" />
					</section>
				</div>

				{objectRelationError ? (
					<div className="error-banner">{objectRelationError}</div>
				) : null}
				{classRelationsQuery.isLoading ? (
					<div className="muted">Loading connected classes...</div>
				) : null}
				{!classRelationsQuery.isLoading &&
				!objectRelationTargetClassOptions.length ? (
					<div className="muted">
						Create a class relation for this current class before adding object
						relations.
					</div>
				) : null}
				{objectRelationSuccess ? (
					<div className="muted">{objectRelationSuccess}</div>
				) : null}

				<div className="form-actions">
					<button
						type="submit"
						disabled={
							createObjectRelationMutation.isPending || !canCreateObjectRelation
						}
					>
						{createObjectRelationMutation.isPending
							? "Creating..."
							: "Create object relation"}
					</button>
				</div>
			</form>
		);
	}

	const resourceSummary =
		isClassMode
			? classRelationsView === "direct"
				? allClassRelationsQuery.data
					? buildResourceSummary({
							shown: hasClassRelationFilters
								? classDirectRelations.length
								: null,
							loaded: allClassRelations.length,
							selected: selectedClassRelationIds.length,
						})
					: parsedSourceClassId
						? buildResourceSummary({ status: "Loading…" })
						: buildResourceSummary({ status: "No class selected" })
				: classConnectedClassesQuery.data
					? buildResourceSummary({ loaded: connectedClasses.length })
					: parsedSourceClassId
						? buildResourceSummary({ status: "Loading…" })
						: buildResourceSummary({ status: "No class selected" })
			: objectRelationsView === "direct"
				? objectDirectRelationsQuery.data
					? buildResourceSummary({
							loaded: objectDirectRelations.length,
							selected: selectedObjectRelationIds.length,
						})
					: parsedResolvedSourceObjectId !== null
						? buildResourceSummary({ status: "Loading…" })
						: buildResourceSummary({ status: "No object selected" })
				: relatedObjectsQuery.data
					? buildResourceSummary({
							loaded: relatedObjects.length,
							details: [`depth ${reachabilityDepth}`],
						})
					: parsedResolvedSourceObjectId !== null
						? buildResourceSummary({ status: "Loading…" })
						: buildResourceSummary({ status: "No object selected" });

	if (classesQuery.isLoading) {
		return <div className="card">Loading class options...</div>;
	}

	if (classesQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load class options.{" "}
				{classesQuery.error instanceof Error
					? classesQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	return (
		<div className="stack">
			<CreateModal
				open={isCreateModalOpen}
				title={isClassMode ? "Create class relation" : "Create object relation"}
				onClose={() => setCreateModalOpen(false)}
			>
				<div className="stack">
					{isClassMode
						? renderCreateClassRelationForm()
						: renderCreateObjectRelationForm()}
				</div>
			</CreateModal>
			{referencedCollectionsQuery.isError ? (
				<div className="muted">
					Could not resolve some collection names. Referenced collection IDs
					remain visible.
				</div>
			) : null}

			{isClassMode ? (
				<div className="card table-wrap resource-index">
					<div className="table-header">
						<ResourceIndexHeading
							title="Class relations"
							summary={resourceSummary}
							createSection="relations"
							createLabel="New class relation"
							context={
								classRelationsView === "connected" ? (
									<>
										<span className="resource-index-context-label">of</span>
										<select
											aria-label="Relations class context"
											className="resource-index-context-select"
											value={resolvedSourceClassId}
											onChange={onContextClassChange}
											disabled={classes.length === 0}
										>
											{classes.length === 0 ? (
												<option value="">No classes available</option>
											) : null}
											{classes.map((classItem) => (
												<option key={classItem.id} value={classItem.id}>
													{classItem.name}
												</option>
											))}
										</select>
									</>
								) : null
							}
						/>
						<div className="table-tools">
							{classRelationsView === "direct" ? (
								<TableExportMenu
									view={directClassRelationsExportView}
									disabled={allClassRelationsQuery.isFetching}
									compact
								/>
							) : (
								<TableExportMenu
									view={connectedClassesExportView}
									disabled={classConnectedClassesQuery.isFetching}
									compact
								/>
							)}
							<select
								aria-label="Class relations view"
								value={classRelationsView}
								onChange={onClassRelationsViewChange}
							>
								<option value="direct">Direct relations</option>
								<option value="connected">Connected classes</option>
							</select>
						</div>
					</div>

					{classRelationsView === "direct" ? (
						<fieldset className="controls-row relation-filters">
							<legend className="sr-only">Class relation filters</legend>
							<label className="control-field">
								<span>From class</span>
								<select
									value={fromClassFilterId}
									onChange={(event) => setFromClassFilterId(event.target.value)}
								>
									<option value="">All classes</option>
									{classes.map((classItem) => (
										<option key={classItem.id} value={classItem.id}>
											{classItem.name} (#{classItem.id})
										</option>
									))}
								</select>
							</label>
							<label className="control-field">
								<span>To class</span>
								<select
									value={toClassFilterId}
									onChange={(event) => setToClassFilterId(event.target.value)}
								>
									<option value="">All classes</option>
									{classes.map((classItem) => (
										<option key={classItem.id} value={classItem.id}>
											{classItem.name} (#{classItem.id})
										</option>
									))}
								</select>
							</label>
							{hasClassRelationFilters ? (
								<button
									type="button"
									className="ghost"
									onClick={() => {
										setFromClassFilterId("");
										setToClassFilterId("");
									}}
								>
									Clear filters
								</button>
							) : null}
						</fieldset>
					) : null}

					{classRelationSuccess ? (
						<div className="muted">{classRelationSuccess}</div>
					) : null}
					{classTableError ? (
						<div className="error-banner">{classTableError}</div>
					) : null}
					{classTableSuccess ? (
						<div className="muted">{classTableSuccess}</div>
					) : null}

					{classRelationsView === "direct" ? (
						allClassRelationsQuery.isLoading ? (
							<div>Loading class relations...</div>
						) : allClassRelationsQuery.isError ? (
							<div className="error-banner">
								Failed to load class relations.{" "}
								{allClassRelationsQuery.error instanceof Error
									? allClassRelationsQuery.error.message
									: "Unknown error"}
							</div>
						) : classDirectRelations.length === 0 ? (
							<div className="muted">
								{hasClassRelationFilters
									? "No class relations match the current filters."
									: "No direct class relations available."}
							</div>
						) : (
							<table id="class-relations-table">
								<colgroup>
									<col className="table-select-column" />
									<col className="table-id-column" />
									<col className="table-relation-endpoint-column" />
									<col className="table-relation-endpoint-column" />
								</colgroup>
								<thead>
									<tr>
										<th className="check-col">
											<input
												type="checkbox"
												aria-label="Select all class relations"
												checked={allClassRelationsSelected}
												onChange={(event) =>
													classRelationsShiftSelect.handleSelectAll(
														event.target.checked,
													)
												}
											/>
										</th>
										<th>ID</th>
										<th>From class</th>
										<th>To class</th>
									</tr>
								</thead>
								<tbody>
									{classDirectRelations.map((relation) => (
										<tr key={relation.id}>
											<td className="check-col">
												<input
													type="checkbox"
													aria-label={`Select class relation ${relation.id}`}
													checked={selectedClassRelationIds.includes(
														relation.id,
													)}
													onChange={(event) =>
														classRelationsShiftSelect.handleClick(
															relation.id,
															event.target.checked,
															(event.nativeEvent as MouseEvent).shiftKey,
														)
													}
												/>
											</td>
											<td>{relation.id}</td>
											<td>
												<Link
													href={`/classes/${relation.from_hubuum_class_id}`}
													className="row-link"
												>
													{renderClassById(relation.from_hubuum_class_id)}
												</Link>
											</td>
											<td>
												<Link
													href={`/classes/${relation.to_hubuum_class_id}`}
													className="row-link"
												>
													{renderClassById(relation.to_hubuum_class_id)}
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)
					) : parsedSourceClassId === null ? (
						<div className="muted">
							Select a class to load connected classes.
						</div>
					) : classConnectedClassesQuery.isLoading ? (
						<div>Loading connected classes...</div>
					) : classConnectedClassesQuery.isError ? (
						<div className="error-banner">
							Failed to load connected classes.{" "}
							{classConnectedClassesQuery.error instanceof Error
								? classConnectedClassesQuery.error.message
								: "Unknown error"}
						</div>
					) : connectedClasses.length === 0 ? (
						<div className="muted">No connected classes for this class.</div>
					) : (
						<table>
							<thead>
								<tr>
									<th>Class</th>
									<th>Collection</th>
									<th>Hops</th>
									<th>Path</th>
								</tr>
							</thead>
							<tbody>
								{connectedClasses.map((connectedClass) => (
									<tr
										key={`${connectedClass.id}-${connectedClass.path.join("-")}`}
									>
										<td>{renderClassLink(connectedClass.id)}</td>
										<td>
											{renderCollectionById(connectedClass.collection_id)}
										</td>
										<td>
											{Math.max(
												getDisplayClassPath(
													connectedClass.path,
													connectedClass.id,
												).length - 1,
												0,
											)}
										</td>
										<td>
											{renderClassPath(connectedClass.path, connectedClass.id)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			) : null}

			{isObjectMode ? (
				<div className="card table-wrap resource-index">
					<div className="table-header">
						<ResourceIndexHeading
							title="Object relations"
							summary={resourceSummary}
							createSection="relations"
							createLabel="New object relation"
							context={
								<>
									<span className="resource-index-context-label">of</span>
									<select
										aria-label="Relations class context"
										className="resource-index-context-select"
										value={resolvedSourceClassId}
										onChange={onContextClassChange}
										disabled={classes.length === 0}
									>
										{classes.length === 0 ? (
											<option value="">No classes available</option>
										) : null}
										{classes.map((classItem) => (
											<option key={classItem.id} value={classItem.id}>
												{classItem.name}
											</option>
										))}
									</select>
									<span
										className="resource-index-context-label"
										aria-hidden="true"
									>
										/
									</span>
									<select
										aria-label="Relations object context"
										className="resource-index-context-select"
										value={resolvedSourceObjectId}
										onChange={onContextObjectChange}
										disabled={
											!resolvedSourceClassId ||
											sourceObjectsQuery.isLoading ||
											sourceObjectsQuery.isError
										}
									>
										<option value="">Select an object</option>
										{sourceObjects.map((objectItem) => (
											<option key={objectItem.id} value={objectItem.id}>
												{objectItem.name}
											</option>
										))}
									</select>
								</>
							}
						/>
						<div className="table-tools">
							{objectRelationsView === "reachable" ? (
								<label className="relations-depth-control">
									<span>Depth</span>
									<select
										className="relations-depth-input"
										aria-label="Reachability depth"
										value={reachabilityDepth}
										onChange={(event) =>
											setReachabilityDepth(
												normalizeRelatedObjectDepthLimit(event.target.value),
											)
										}
									>
										{Array.from(
											{ length: MAX_RELATED_OBJECT_DEPTH_LIMIT },
											(_, index) => index + 1,
										).map((depth) => (
											<option key={depth} value={depth}>
												{depth}
											</option>
										))}
									</select>
								</label>
							) : null}
							{objectRelationsView === "direct" ? (
								<TableExportMenu
									view={directObjectRelationsExportView}
									disabled={
										objectDirectRelationsQuery.isFetching ||
										relatedObjectsQuery.isFetching
									}
									compact
								/>
							) : (
								<TableExportMenu
									view={reachableObjectsExportView}
									disabled={relatedObjectsQuery.isFetching}
									compact
								/>
							)}
							<select
								aria-label="Object relations view"
								value={objectRelationsView}
								onChange={onObjectRelationsViewChange}
							>
								<option value="direct">Direct relations</option>
								<option value="reachable">Reachability</option>
							</select>
						</div>
					</div>

					{objectRelationSuccess ? (
						<div className="muted">{objectRelationSuccess}</div>
					) : null}
					{objectTableError ? (
						<div className="error-banner">{objectTableError}</div>
					) : null}
					{objectTableSuccess ? (
						<div className="muted">{objectTableSuccess}</div>
					) : null}

					{parsedSourceClassId === null ? (
						<div className="muted">Select a class first.</div>
					) : parsedResolvedSourceObjectId === null ? (
						<div className="muted">
							Select a current object to load object-level relations.
						</div>
					) : objectRelationsView === "direct" ? (
						objectDirectRelationsQuery.isLoading ||
						relatedObjectsQuery.isLoading ? (
							<div>Loading direct object relations...</div>
						) : objectDirectRelationsQuery.isError ? (
							<div className="error-banner">
								Failed to load direct object relations.{" "}
								{objectDirectRelationsQuery.error instanceof Error
									? objectDirectRelationsQuery.error.message
									: "Unknown error"}
							</div>
						) : objectDirectRelations.length === 0 ? (
							<div className="muted">
								No direct object relations for this object.
							</div>
						) : (
							<table id="object-relations-table">
								<colgroup>
									<col className="table-select-column" />
									<col className="table-relation-endpoint-column" />
									<col className="table-relation-label-column" />
								</colgroup>
								<thead>
									<tr>
										<th className="check-col">
											<input
												type="checkbox"
												aria-label="Select all object relations"
												checked={allObjectRelationsSelected}
												onChange={(event) =>
													objectRelationsShiftSelect.handleSelectAll(
														event.target.checked,
													)
												}
											/>
										</th>
										<th>Related object</th>
										<th>Relation</th>
									</tr>
								</thead>
								<tbody>
									{objectDirectRelations.map((relation) => {
										const relatedObjectId =
											relation.from_hubuum_object_id ===
											parsedResolvedSourceObjectId
												? relation.to_hubuum_object_id
												: relation.from_hubuum_object_id;
										const relatedObject =
											objectContextById.get(relatedObjectId);

										return (
											<tr key={relation.id}>
												<td className="check-col">
													<input
														type="checkbox"
														aria-label={`Select object relation ${relation.id}`}
														checked={selectedObjectRelationIds.includes(
															relation.id,
														)}
														onChange={(event) =>
															objectRelationsShiftSelect.handleClick(
																relation.id,
																event.target.checked,
																(event.nativeEvent as MouseEvent).shiftKey,
															)
														}
													/>
												</td>
												<td>
													{relatedObject
														? renderObjectLink(relatedObjectId)
														: renderObjectById(relatedObjectId)}
												</td>
												<td>{renderObjectRelationLabel(relation)}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)
					) : relatedObjectsQuery.isLoading ? (
						<div>Loading reachable objects...</div>
					) : relatedObjectsQuery.isError ? (
						<div className="error-banner">
							Failed to load object reachability.{" "}
							{relatedObjectsQuery.error instanceof Error
								? relatedObjectsQuery.error.message
								: "Unknown error"}
						</div>
					) : relatedObjects.length === 0 ? (
						<div className="muted">No reachable objects for this object.</div>
					) : (
						<table>
							<thead>
								<tr>
									<th>Object</th>
									<th>Collection</th>
									<th>Path</th>
								</tr>
							</thead>
							<tbody>
								{relatedObjects.map((relation) => (
									<tr key={relation.id}>
										<td>{renderObjectLink(relation.id)}</td>
										<td>{renderCollectionById(relation.collection_id)}</td>
										<td>{renderObjectPath(relation.path, relation.id)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			) : null}
		</div>
	);
}
