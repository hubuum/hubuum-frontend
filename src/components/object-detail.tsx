"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { JsonEditor } from "@/components/json-editor";
import { InlineFieldEditTrigger } from "@/components/inline-field-edit-trigger";
import { ObjectDetailTracker } from "@/components/object-detail-tracker";
import { RemoteInvocationsPanel } from "@/components/remote-invocations-panel";
import { ResourceActivityPanel } from "@/components/resource-activity-panel";
import { useConfirm } from "@/lib/confirm-context";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import {
	buildObjectDataPatchPlan,
	buildObjectDataReplacePatch,
	patchObjectData,
} from "@/lib/api/object-data-patch";
import {
	deleteApiV1ClassesByClassIdByObjectId,
	getApiV1Classes,
	getApiV1ClassesByClassIdByObjectId,
	getApiV1IamMeGroups,
	getApiV1Collections,
	getApiV1CollectionsByCollectionIdPermissions,
	patchApiV1ClassesByClassIdByObjectId,
} from "@/lib/api/generated/client";
import type {
	GroupPermission,
	HubuumClassExpanded,
	HubuumObject,
	HubuumObjectComputedResponse,
	HubuumObjectWithPath,
	Collection,
	UpdateHubuumObject,
} from "@/lib/api/generated/models";
import type { ConsoleGroup } from "@/lib/identity-scopes";
import { TITLE_STATE_EVENT } from "@/lib/create-events";
import {
	buildRelatedObjectSearchParams,
	DEFAULT_INCLUDE_SELF_CLASS,
	DEFAULT_RELATED_OBJECT_DEPTH_LIMIT,
	normalizeRelatedObjectPath,
} from "@/lib/object-relation-summary";
import {
	createObjectDataFieldValue,
	getObjectDataFieldType,
	getObjectDataValue,
	parseObjectDataPath,
	setObjectDataValue,
	type ObjectDataFieldType,
} from "@/lib/object-data-editing";
import {
	flattenObjectPropertyEntries,
	type ObjectPropertyPathSegment,
} from "@/lib/object-property-entries";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

type ObjectDetailProps = {
	classId: number;
	objectId: number;
	currentUsername: string | null;
	canEditAnything: boolean;
};

type EditableField = "name" | "description" | "collection" | "data";

const CONNECTION_PROPERTY_LIMIT = 12;
const OBJECT_DATA_CHANGE_PREVIEW_LIMIT = 24;

const OBJECT_DATA_FIELD_TYPES: Array<{
	value: ObjectDataFieldType;
	label: string;
}> = [
	{ value: "string", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "boolean", label: "Boolean" },
	{ value: "null", label: "Null" },
	{ value: "object", label: "Object" },
	{ value: "array", label: "Array" },
];

async function fetchObject(
	classId: number,
	objectId: number,
): Promise<HubuumObjectComputedResponse> {
	const response = await getApiV1ClassesByClassIdByObjectId(
		classId,
		objectId,
		{ include: "computed" },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load object."),
		);
	}

	return response.data as HubuumObjectComputedResponse;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function fetchCollections(): Promise<Collection[]> {
	const response = await getApiV1Collections(
		{ include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

async function fetchCollectionPermissions(
	collectionId: number,
): Promise<GroupPermission[]> {
	const response = await getApiV1CollectionsByCollectionIdPermissions(
		collectionId,
		undefined,
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to load collection permissions.",
			),
		);
	}

	return response.data;
}

async function fetchCurrentUserGroups(
	_username: string,
): Promise<ConsoleGroup[]> {
	try {
		const response = await getApiV1IamMeGroups(
			{ include_total: false },
			{
				credentials: "include",
			},
		);
		if (response.status !== 200) {
			return [];
		}
		return response.data;
	} catch {
		return [];
	}
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

async function fetchRelatedObjects(
	classId: number,
	objectId: number,
	depthLimit: number,
	includeSelfClass: boolean,
	ignoredClassIds: number[],
): Promise<HubuumObjectWithPath[]> {
	const params = buildRelatedObjectSearchParams({
		depthLimit,
		includeSelfClass,
		ignoredClassIds,
	});
	const response = await fetch(
		`/_hubuum-bff/hubuum/api/v1/classes/${classId}/objects/${objectId}/related/objects?${params.toString()}`,
		{
			credentials: "include",
		},
	);
	const payload = await parseJsonPayload(response);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to load related objects."),
		);
	}

	return expectArrayPayload<HubuumObjectWithPath>(payload, "related objects");
}

function stringifyJson(value: unknown): string {
	const formatted = JSON.stringify(value, null, 2);
	return formatted ?? "null";
}

function normalizePermissionFlag(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value === 1;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "t" || normalized === "1";
	}

	return false;
}

function canCurrentUserUpdateObject(
	permissionEntries: GroupPermission[],
	currentUserGroups: ConsoleGroup[],
): boolean {
	const currentUserGroupIds = new Set(
		currentUserGroups.map((group) => group.id),
	);
	return permissionEntries.some(
		(entry) =>
			currentUserGroupIds.has(entry.group.id) &&
			normalizePermissionFlag(entry.permission.has_update_object),
	);
}

function formatTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
}

function renderFieldText(value: string): string {
	return value.trim() ? value : "No value";
}

function parseObjectDataDraft(
	value: string,
): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(value) };
	} catch {
		return { ok: false };
	}
}

function formatObjectDataPatchPath(path: string): string {
	if (!path) return "Data root";
	return path
		.slice(1)
		.split("/")
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.reduce((formatted, segment) => {
			if (/^\d+$/.test(segment)) return `${formatted}[${segment}]`;
			if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
				return formatted ? `${formatted}.${segment}` : segment;
			}
			return `${formatted}[${JSON.stringify(segment)}]`;
		}, "");
}

function formatObjectDataPatchValue(value: unknown): string {
	const serialized = JSON.stringify(value);
	const formatted = serialized ?? String(value);
	return formatted.length > 96 ? `${formatted.slice(0, 93)}...` : formatted;
}

function ObjectDataValueEditor({
	path,
	value,
	disabled,
	onCommit,
	onCancel,
}: {
	path: string;
	value: unknown;
	disabled: boolean;
	onCommit: (value: unknown) => void;
	onCancel: () => void;
}) {
	const initialType = getObjectDataFieldType(value);
	const typeSelectRef = useRef<HTMLSelectElement | null>(null);
	const valueInputRef = useRef<HTMLInputElement | null>(null);
	const valueSelectRef = useRef<HTMLSelectElement | null>(null);
	const [draftType, setDraftType] = useState<ObjectDataFieldType>(initialType);
	const [draftInput, setDraftInput] = useState(() => {
		if (initialType === "string" || initialType === "number") {
			return String(value);
		}
		return initialType === "boolean" && value === true ? "true" : "false";
	});
	const [editorError, setEditorError] = useState<string | null>(null);

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			(
				valueInputRef.current ??
				valueSelectRef.current ??
				typeSelectRef.current
			)?.focus();
			if (valueInputRef.current) {
				valueInputRef.current.select();
			}
		});
		return () => window.cancelAnimationFrame(frame);
	}, []);

	function changeType(type: ObjectDataFieldType) {
		setDraftType(type);
		setDraftInput(type === "number" ? "0" : type === "boolean" ? "false" : "");
		setEditorError(null);
		window.requestAnimationFrame(() =>
			(valueInputRef.current ?? valueSelectRef.current)?.focus(),
		);
	}

	function commit() {
		const result = createObjectDataFieldValue(draftType, draftInput);
		if (!result.ok) {
			setEditorError(result.error);
			return;
		}
		onCommit(result.value);
	}

	function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
		if (event.nativeEvent.isComposing) {
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
			return;
		}
		if (
			event.key === "Enter" &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			event.stopPropagation();
			commit();
		}
	}

	return (
		<div className="object-data-inline-editor" data-object-nonsubmit>
			{draftType === "string" ? (
				<label className="object-data-inline-value">
					<span className="sr-only">Value for {path}</span>
					<input
						ref={valueInputRef}
						value={draftInput}
						onChange={(event) => {
							setDraftInput(event.target.value);
							setEditorError(null);
						}}
						disabled={disabled}
						aria-label={`Value for ${path}`}
						onKeyDown={handleKeyDown}
					/>
				</label>
			) : null}
			{draftType === "number" ? (
				<label className="object-data-inline-value">
					<span className="sr-only">Value for {path}</span>
					<input
						ref={valueInputRef}
						type="number"
						step="any"
						required
						value={draftInput}
						onChange={(event) => {
							setDraftInput(event.target.value);
							setEditorError(null);
						}}
						disabled={disabled}
						aria-label={`Value for ${path}`}
						onKeyDown={handleKeyDown}
					/>
				</label>
			) : null}
			{draftType === "boolean" ? (
				<label className="object-data-inline-value">
					<span className="sr-only">Value for {path}</span>
					<select
						ref={valueSelectRef}
						value={draftInput}
						onChange={(event) => {
							setDraftInput(event.target.value);
							setEditorError(null);
						}}
						disabled={disabled}
						aria-label={`Value for ${path}`}
						onKeyDown={handleKeyDown}
					>
						<option value="true">True</option>
						<option value="false">False</option>
					</select>
				</label>
			) : null}
			{draftType === "null" ||
			draftType === "object" ||
			draftType === "array" ? (
				<span className="object-data-inline-placeholder">
					{draftType === "null" ? "Null value" : `Empty ${draftType}`}
				</span>
			) : null}
			<label className="object-data-inline-type">
				<span className="sr-only">Type for {path}</span>
				<select
					ref={typeSelectRef}
					value={draftType}
					onChange={(event) =>
						changeType(event.target.value as ObjectDataFieldType)
					}
					disabled={disabled}
					aria-label={`Type for ${path}`}
					title={`JSON type: ${draftType}`}
					onKeyDown={handleKeyDown}
				>
					{OBJECT_DATA_FIELD_TYPES.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
			{editorError ? (
				<span className="object-data-inline-error" role="alert">
					{editorError}
				</span>
			) : null}
		</div>
	);
}

function ObjectDataEditTrigger({
	path,
	value,
	disabled,
	onClick,
}: {
	path: string;
	value: string;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<InlineFieldEditTrigger
			fieldLabel={path}
			valueText={value}
			onClick={onClick}
			disabled={disabled}
		>
			{value}
		</InlineFieldEditTrigger>
	);
}

function ObjectPropertyItem({
	label,
	className = "",
	children,
}: {
	label: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`object-property-item${className ? ` ${className}` : ""}`}>
			<dt title={typeof label === "string" ? label : undefined}>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}

function formatComputedValue(value: unknown): string {
	if (typeof value === "string") return value;
	const formatted = JSON.stringify(value);
	return formatted ?? String(value);
}

function ComputedValueScope({
	title,
	values,
	errors,
}: {
	title: string;
	values: Record<string, unknown>;
	errors: Record<
		string,
		{ code: string; message: string; path?: string | null }
	>;
}) {
	const entries = Object.entries(values).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	const errorEntries = Object.entries(errors).sort(([left], [right]) =>
		left.localeCompare(right),
	);

	return (
		<section className="card stack panel-card">
			<h3>{title}</h3>
			{entries.length === 0 && errorEntries.length === 0 ? (
				<p className="muted">No enabled computed values.</p>
			) : null}
			{entries.length > 0 ? (
				<dl className="object-property-grid object-property-grid--data">
					{entries.map(([key, value]) => (
						<ObjectPropertyItem key={key} label={key}>
							<span title={formatComputedValue(value)}>
								{formatComputedValue(value)}
							</span>
						</ObjectPropertyItem>
					))}
				</dl>
			) : null}
			{errorEntries.map(([key, error]) => (
				<div className="error-banner" key={key}>
					<strong>{key}</strong>: {error.message} ({error.code})
					{error.path ? ` at ${error.path}` : ""}
				</div>
			))}
		</section>
	);
}

export function ObjectDetail({
	classId,
	objectId,
	currentUsername,
	canEditAnything,
}: ObjectDetailProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const objectFormRef = useRef<HTMLFormElement | null>(null);
	const ignoreClassesRef = useRef<HTMLDivElement | null>(null);
	const objectHeadingRef = useRef<HTMLElement | null>(null);
	const nameInputRef = useRef<HTMLInputElement | null>(null);
	const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);
	const collectionSelectRef = useRef<HTMLSelectElement | null>(null);
	const collectionInputRef = useRef<HTMLInputElement | null>(null);
	const newDataFieldPathRef = useRef<HTMLInputElement | null>(null);

	const [relationDepthLimit, setRelationDepthLimit] = useState(
		DEFAULT_RELATED_OBJECT_DEPTH_LIMIT,
	);
	const [showAllRelations, setShowAllRelations] = useState(false);
	const [includeSelfClass, setIncludeSelfClass] = useState(
		DEFAULT_INCLUDE_SELF_CLASS,
	);
	const [ignoredClassIds, setIgnoredClassIds] = useState<number[]>([]);
	const [isIgnoreClassesOpen, setIgnoreClassesOpen] = useState(false);
	const [isRawDataViewOpen, setRawDataViewOpen] = useState(false);
	const [isAdvancedDataEditorOpen, setAdvancedDataEditorOpen] = useState(false);
	const [isAddDataFieldOpen, setAddDataFieldOpen] = useState(false);
	const [activeDataFieldId, setActiveDataFieldId] = useState<string | null>(
		null,
	);
	const [dataFieldFilter, setDataFieldFilter] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [dataInput, setDataInput] = useState("{}");
	const [dataDraft, setDataDraft] = useState<unknown>({});
	const [newDataFieldPath, setNewDataFieldPath] = useState("");
	const [newDataFieldType, setNewDataFieldType] =
		useState<ObjectDataFieldType>("string");
	const [newDataFieldValue, setNewDataFieldValue] = useState("");
	const [newDataFieldError, setNewDataFieldError] = useState<string | null>(
		null,
	);
	const [collectionId, setCollectionId] = useState("");
	const [initialized, setInitialized] = useState(false);
	const [editingFields, setEditingFields] = useState<EditableField[]>([]);
	const [dirtyFields, setDirtyFields] = useState<EditableField[]>([]);
	const [formError, setFormError] = useState<string | null>(null);
	const [formSuccess, setFormSuccess] = useState<string | null>(null);

	const objectQuery = useQuery({
		queryKey: ["object", classId, objectId],
		queryFn: async () => fetchObject(classId, objectId),
	});
	const classesQuery = useQuery({
		queryKey: ["classes", "object-detail"],
		queryFn: fetchClasses,
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "object-detail"],
		queryFn: fetchCollections,
	});
	const collectionPermissionsQuery = useQuery({
		queryKey: [
			"collection",
			objectQuery.data?.collection_id,
			"permissions",
			"object-detail",
		],
		queryFn: async () => {
			if (!objectQuery.data) {
				return [];
			}

			return fetchCollectionPermissions(objectQuery.data.collection_id);
		},
		enabled: Boolean(objectQuery.data) && !canEditAnything,
	});
	const currentUserGroupsQuery = useQuery({
		queryKey: [
			"permissions",
			"current-user-groups",
			currentUsername,
			"object-detail",
		],
		queryFn: async () => {
			if (!currentUsername) {
				return [];
			}

			return fetchCurrentUserGroups(currentUsername);
		},
		enabled: Boolean(currentUsername) && !canEditAnything,
	});
	const relatedObjectsQuery = useQuery({
		queryKey: [
			"object-related-objects",
			"detail",
			classId,
			objectId,
			relationDepthLimit,
			includeSelfClass,
			ignoredClassIds,
		],
		queryFn: async () =>
			fetchRelatedObjects(
				classId,
				objectId,
				relationDepthLimit,
				includeSelfClass,
				ignoredClassIds,
			),
	});
	const flattenedObjectData = useMemo(
		() => flattenObjectPropertyEntries(objectQuery.data?.data),
		[objectQuery.data?.data],
	);
	const flattenedDataDraft = useMemo(
		() => flattenObjectPropertyEntries(dataDraft),
		[dataDraft],
	);
	const parsedDataDraft = useMemo(
		() => parseObjectDataDraft(dataInput),
		[dataInput],
	);
	const dataPatchPlan = useMemo(() => {
		if (!objectQuery.data || !parsedDataDraft.ok) return null;
		return buildObjectDataPatchPlan(
			objectQuery.data.data,
			parsedDataDraft.value,
		);
	}, [objectQuery.data, parsedDataDraft]);

	useEffect(() => {
		if (!objectQuery.data) {
			return;
		}

		if (!initialized || editingFields.length === 0) {
			setName(objectQuery.data.name);
			setDescription(objectQuery.data.description ?? "");
			setDataInput(stringifyJson(objectQuery.data.data));
			setDataDraft(objectQuery.data.data);
			setCollectionId(String(objectQuery.data.collection_id));
			setInitialized(true);
		}
	}, [editingFields.length, initialized, objectQuery.data]);

	useEffect(() => {
		if (!isIgnoreClassesOpen) {
			return;
		}

		function handlePointerDown(event: MouseEvent) {
			if (!ignoreClassesRef.current?.contains(event.target as Node)) {
				setIgnoreClassesOpen(false);
			}
		}

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, [isIgnoreClassesOpen]);
	useEscapeToCancel({
		enabled: isIgnoreClassesOpen,
		onCancel: () => setIgnoreClassesOpen(false),
	});

	useEffect(() => {
		const lastEditingField = editingFields.at(-1);
		if (lastEditingField === "name") {
			nameInputRef.current?.focus();
		} else if (lastEditingField === "description") {
			descriptionInputRef.current?.focus();
		} else if (lastEditingField === "collection") {
			(collectionSelectRef.current ?? collectionInputRef.current)?.focus();
		}
	}, [editingFields]);

	useEffect(() => {
		if (isAddDataFieldOpen) {
			newDataFieldPathRef.current?.focus();
		}
	}, [isAddDataFieldOpen]);

	const collections = collectionsQuery.data ?? [];

	async function applyUpdatedObject(updatedObject: HubuumObject) {
		const targetClassId = updatedObject.hubuum_class_id;
		await queryClient.invalidateQueries({
			queryKey: ["object", classId, objectId],
		});
		await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
		await queryClient.invalidateQueries({
			queryKey: ["objects", targetClassId],
		});
		await queryClient.invalidateQueries({
			queryKey: ["object-aggregates", classId],
		});
		await queryClient.invalidateQueries({
			queryKey: ["collection", updatedObject.collection_id, "permissions"],
		});
		setName(updatedObject.name);
		setDescription(updatedObject.description ?? "");
		setDataInput(stringifyJson(updatedObject.data));
		setDataDraft(updatedObject.data);
		setAddDataFieldOpen(false);
		setAdvancedDataEditorOpen(false);
		setActiveDataFieldId(null);
		setNewDataFieldError(null);
		setCollectionId(String(updatedObject.collection_id));
		setEditingFields([]);
		setDirtyFields([]);
		setFormError(null);
		setFormSuccess("Object updated.");
		window.requestAnimationFrame(() => objectHeadingRef.current?.focus());

		if (targetClassId !== classId) {
			router.replace(`/objects/${targetClassId}/${objectId}`);
			router.refresh();
		}
	}

	const updateMutation = useMutation({
		mutationFn: async (payload: UpdateHubuumObject) => {
			const response = await patchApiV1ClassesByClassIdByObjectId(
				classId,
				objectId,
				payload,
				{
					credentials: "include",
				},
			);

			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to update object."),
				);
			}

			return response.data;
		},
		onSuccess: applyUpdatedObject,
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to update object.",
			);
		},
	});
	const dataPatchMutation = useMutation({
		mutationFn: (patch: Parameters<typeof patchObjectData>[2]) =>
			patchObjectData(classId, objectId, patch),
		onSuccess: applyUpdatedObject,
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to update object data.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const response = await deleteApiV1ClassesByClassIdByObjectId(
				classId,
				objectId,
				{
					credentials: "include",
				},
			);

			if (response.status !== 204) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to delete object."),
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
			await queryClient.invalidateQueries({
				queryKey: ["object-aggregates", classId],
			});
			router.push("/objects");
			router.refresh();
		},
		onError: (error) => {
			setFormSuccess(null);
			setFormError(
				error instanceof Error ? error.message : "Failed to delete object.",
			);
		},
	});

	const currentUserGroups = currentUserGroupsQuery.data ?? [];
	const permissionEntries = collectionPermissionsQuery.data ?? [];
	const canCheckPermissionMembership = Boolean(currentUsername);
	const permissionCheckPending =
		!canEditAnything &&
		canCheckPermissionMembership &&
		(collectionPermissionsQuery.isLoading || currentUserGroupsQuery.isLoading);
	const canEditObject =
		Boolean(objectQuery.data) &&
		(canEditAnything ||
			(canCheckPermissionMembership &&
				canCurrentUserUpdateObject(permissionEntries, currentUserGroups)));
	const hasActiveEdits = editingFields.length > 0;
	const isSavingOrDeleting =
		updateMutation.isPending ||
		dataPatchMutation.isPending ||
		deleteMutation.isPending;
	useEffect(() => {
		const objectData = objectQuery.data;
		if (!objectData) {
			return;
		}

		const currentClass = (classesQuery.data ?? []).find(
			(item) => item.id === objectData.hubuum_class_id,
		);
		const title = currentClass
			? `${currentClass.name} / ${objectData.name}`
			: objectData.name;

		window.dispatchEvent(
			new CustomEvent(TITLE_STATE_EVENT, {
				detail: {
					title,
					pin: {
						type: "object",
						id: objectData.id,
						name: objectData.name,
						collectionId: objectData.collection_id,
						collectionName:
							(collectionsQuery.data ?? []).find(
								(collection) => collection.id === objectData.collection_id,
							)?.name ?? "Collection",
						classId: objectData.hubuum_class_id,
						className: currentClass?.name,
					},
				},
			}),
		);

		return () => {
			window.dispatchEvent(
				new CustomEvent(TITLE_STATE_EVENT, {
					detail: { title: null, pin: null },
				}),
			);
		};
	}, [classesQuery.data, collectionsQuery.data, objectQuery.data]);

	function resetFieldDraft(field: EditableField, objectData: HubuumObject) {
		if (field === "name") {
			setName(objectData.name);
			return;
		}

		if (field === "description") {
			setDescription(objectData.description ?? "");
			return;
		}

		if (field === "collection") {
			setCollectionId(String(objectData.collection_id));
			return;
		}

		setDataInput(stringifyJson(objectData.data));
		setDataDraft(objectData.data);
		setAddDataFieldOpen(false);
		setAdvancedDataEditorOpen(false);
		setActiveDataFieldId(null);
		setNewDataFieldPath("");
		setNewDataFieldType("string");
		setNewDataFieldValue("");
		setNewDataFieldError(null);
	}

	const cancelActiveEdits = useCallback(() => {
		const objectData = objectQuery.data;
		if (!objectData || editingFields.length === 0) {
			return;
		}

		setName(objectData.name);
		setDescription(objectData.description ?? "");
		setCollectionId(String(objectData.collection_id));
		setDataInput(stringifyJson(objectData.data));
		setDataDraft(objectData.data);
		setAddDataFieldOpen(false);
		setAdvancedDataEditorOpen(false);
		setActiveDataFieldId(null);
		setNewDataFieldPath("");
		setNewDataFieldType("string");
		setNewDataFieldValue("");
		setNewDataFieldError(null);
		setEditingFields([]);
		setDirtyFields([]);
		setFormError(null);
		setFormSuccess(null);
		window.requestAnimationFrame(() => objectHeadingRef.current?.focus());
	}, [editingFields.length, objectQuery.data]);

	useEscapeToCancel({
		enabled: hasActiveEdits && !isSavingOrDeleting,
		onCancel: cancelActiveEdits,
		ignoreSelector: ".json-editor, .relations-filter-dropdown, [role='dialog']",
	});

	function toggleFieldEditing(field: EditableField, objectData: HubuumObject) {
		setFormError(null);
		setFormSuccess(null);

		if (editingFields.includes(field)) {
			resetFieldDraft(field, objectData);
			if (field === "data") {
				setActiveDataFieldId(null);
			}
			setEditingFields((current) =>
				current.filter((currentField) => currentField !== field),
			);
			setDirtyFields((current) =>
				current.filter((currentField) => currentField !== field),
			);
			return;
		}
		if (field === "data") {
			setDataInput(stringifyJson(objectData.data));
			setDataDraft(objectData.data);
			setAddDataFieldOpen(false);
			setAdvancedDataEditorOpen(false);
			setActiveDataFieldId(null);
			setNewDataFieldError(null);
		}

		setEditingFields((current) => [...current, field]);
	}

	function beginRawDataEdit(objectData: HubuumObject) {
		if (!canEditObject || isSavingOrDeleting) {
			return;
		}

		setFormError(null);
		setFormSuccess(null);
		setDataInput(stringifyJson(objectData.data));
		setDataDraft(objectData.data);
		setAddDataFieldOpen(false);
		setActiveDataFieldId(null);
		setNewDataFieldError(null);
		setEditingFields((current) =>
			current.includes("data") ? current : [...current, "data"],
		);
		setAdvancedDataEditorOpen(true);
	}

	function markFieldDirty(field: EditableField) {
		setDirtyFields((current) =>
			current.includes(field) ? current : [...current, field],
		);
	}

	function commitDataDraft(nextData: unknown) {
		setDataDraft(nextData);
		setDataInput(stringifyJson(nextData));
		setNewDataFieldError(null);
		setFormError(null);
		setFormSuccess(null);
		markFieldDirty("data");
	}

	function beginInlineDataField(fieldId: string) {
		const objectData = objectQuery.data;
		if (!objectData || !canEditObject || isSavingOrDeleting) {
			return;
		}

		setFormError(null);
		setFormSuccess(null);
		if (!editingFields.includes("data")) {
			setDataInput(stringifyJson(objectData.data));
			setDataDraft(objectData.data);
			setEditingFields((current) => [...current, "data"]);
		}
		setActiveDataFieldId(fieldId);
	}

	function cancelInlineDataField() {
		setActiveDataFieldId(null);
		if (dirtyFields.includes("data")) {
			return;
		}

		const objectData = objectQuery.data;
		if (objectData) {
			setDataInput(stringifyJson(objectData.data));
			setDataDraft(objectData.data);
		}
		setEditingFields((current) => current.filter((field) => field !== "data"));
	}

	function commitInlineDataField(
		segments: readonly ObjectPropertyPathSegment[],
		value: unknown,
	) {
		const currentValue = getObjectDataValue(dataDraft, segments);
		const updated = setObjectDataValue(dataDraft, segments, value);
		if (!updated.ok) {
			setFormError(updated.error);
			return;
		}
		commitDataDraft(updated.value);
		setActiveDataFieldId(null);
		if (dirtyFields.length === 0 && currentValue.found) {
			dataPatchMutation.mutate(
				buildObjectDataReplacePatch(segments, currentValue.value, value),
			);
			return;
		}
		submitCurrentEdits({ dataOverride: updated.value });
	}

	function resetNewDataField() {
		setNewDataFieldPath("");
		setNewDataFieldType("string");
		setNewDataFieldValue("");
		setNewDataFieldError(null);
	}

	useEscapeToCancel({
		enabled: isAddDataFieldOpen && !isSavingOrDeleting,
		onCancel: () => {
			setAddDataFieldOpen(false);
			resetNewDataField();
		},
	});
	useEscapeToCancel({
		enabled: isAdvancedDataEditorOpen && !isSavingOrDeleting,
		onCancel: () => setAdvancedDataEditorOpen(false),
	});

	function changeNewDataFieldType(type: ObjectDataFieldType) {
		setNewDataFieldType(type);
		setNewDataFieldValue(
			type === "number" ? "0" : type === "boolean" ? "false" : "",
		);
		setNewDataFieldError(null);
	}

	function addDataField() {
		const parsedPath = parseObjectDataPath(newDataFieldPath);
		if (!parsedPath.ok) {
			setNewDataFieldError(parsedPath.error);
			return;
		}
		if (getObjectDataValue(dataDraft, parsedPath.segments).found) {
			setNewDataFieldError("A data field already exists at this path.");
			return;
		}

		const fieldValue = createObjectDataFieldValue(
			newDataFieldType,
			newDataFieldValue,
		);
		if (!fieldValue.ok) {
			setNewDataFieldError(fieldValue.error);
			return;
		}
		const updated = setObjectDataValue(
			dataDraft,
			parsedPath.segments,
			fieldValue.value,
		);
		if (!updated.ok) {
			setNewDataFieldError(updated.error);
			return;
		}

		commitDataDraft(updated.value);
		setDataFieldFilter("");
		setAddDataFieldOpen(false);
		resetNewDataField();
	}

	function updateRawDataInput(value: string) {
		setDataInput(value);
		setFormError(null);
		setFormSuccess(null);
		markFieldDirty("data");
		try {
			setDataDraft(JSON.parse(value));
		} catch {
			// Keep inline fields on the last valid document while JSON is incomplete.
		}
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		submitCurrentEdits();
	}

	function submitCurrentEdits(options?: { dataOverride: unknown }) {
		setFormError(null);
		setFormSuccess(null);
		if (editingFields.length === 0 && !options) {
			return;
		}

		if (!canEditObject) {
			setFormError("You do not have permission to update this object.");
			return;
		}
		const currentObject = objectQuery.data;
		if (!currentObject) {
			setFormError("Object data is unavailable.");
			return;
		}

		const payload: UpdateHubuumObject = {};
		let dataPatchForSave: Parameters<typeof patchObjectData>[2] | null = null;
		if (dirtyFields.includes("name")) {
			const nextName = name.trim();
			if (!nextName) {
				setFormError("Object name is required.");
				return;
			}
			if (name !== currentObject.name && nextName !== currentObject.name) {
				payload.name = nextName;
			}
		}

		if (dirtyFields.includes("description")) {
			const nextDescription = description.trim();
			if (
				description !== (currentObject.description ?? "") &&
				nextDescription !== (currentObject.description ?? "")
			) {
				payload.description = nextDescription;
			}
		}

		if (dirtyFields.includes("data") || options) {
			try {
				const parsedData = options
					? options.dataOverride
					: JSON.parse(dataInput);
				const patchPlan = buildObjectDataPatchPlan(
					currentObject.data,
					parsedData,
				);
				if (patchPlan.patch.length > 0) {
					payload.data = parsedData;
					dataPatchForSave = patchPlan.patch;
				}
			} catch {
				setFormError("Object data must be valid JSON.");
				return;
			}
		}

		if (dirtyFields.includes("collection")) {
			const parsedCollectionId = Number.parseInt(collectionId, 10);
			if (!Number.isFinite(parsedCollectionId) || parsedCollectionId < 1) {
				setFormError("Collection ID is required.");
				return;
			}
			if (parsedCollectionId !== currentObject.collection_id) {
				payload.collection_id = parsedCollectionId;
			}
		}

		if (Object.keys(payload).length === 0) {
			setActiveDataFieldId(null);
			setEditingFields([]);
			setDirtyFields([]);
			setFormSuccess("No changes to save.");
			window.requestAnimationFrame(() => objectHeadingRef.current?.focus());
			return;
		}
		if (Object.keys(payload).length === 1 && "data" in payload) {
			dataPatchMutation.mutate(
				dataPatchForSave ??
					buildObjectDataPatchPlan(currentObject.data, payload.data).patch,
			);
			return;
		}

		updateMutation.mutate(payload);
	}

	function onSubmitShortcut(event: ReactKeyboardEvent<HTMLFormElement>) {
		const target = event.target;
		if (
			event.key === "Enter" &&
			!event.ctrlKey &&
			!event.metaKey &&
			target instanceof HTMLInputElement &&
			!["button", "checkbox", "radio", "reset", "submit"].includes(
				target.type,
			) &&
			target.closest("[data-object-nonsubmit]")
		) {
			event.preventDefault();
			return;
		}

		if (
			event.key !== "Enter" ||
			(!event.ctrlKey && !event.metaKey) ||
			event.altKey ||
			event.shiftKey
		) {
			return;
		}

		const submitButton = event.currentTarget.querySelector<HTMLButtonElement>(
			"button[type='submit']:not(:disabled)",
		);
		if (!submitButton) {
			return;
		}

		event.preventDefault();
		event.currentTarget.requestSubmit(submitButton);
	}

	async function onDelete() {
		setFormError(null);
		setFormSuccess(null);
		const objectLabel = objectQuery.data?.name ?? "this object";
		const confirmed = await confirm({
			title: `Delete ${objectLabel}?`,
			description: "This removes the object and cannot be undone.",
			confirmLabel: "Delete",
			tone: "danger",
		});
		if (!confirmed) {
			return;
		}

		deleteMutation.mutate();
	}

	if (objectQuery.isLoading) {
		return <div className="card">Loading object...</div>;
	}

	if (objectQuery.isError) {
		return (
			<div className="card error-banner">
				Failed to load object.{" "}
				{objectQuery.error instanceof Error
					? objectQuery.error.message
					: "Unknown error"}
			</div>
		);
	}

	const objectData = objectQuery.data;
	if (!objectData) {
		return <div className="card error-banner">Object data is unavailable.</div>;
	}

	const currentClass =
		(classesQuery.data ?? []).find(
			(item) => item.id === objectData.hubuum_class_id,
		) ?? null;
	const hasCollectionOptions = collections.length > 0;
	const hasCollectionSelection = collections.some(
		(collection) => String(collection.id) === collectionId,
	);
	const classNameById = new Map<number, string>();
	for (const item of classesQuery.data ?? []) {
		classNameById.set(item.id, item.name);
	}
	const collectionNameById = new Map<number, string>();
	for (const collection of collections) {
		collectionNameById.set(collection.id, collection.name);
	}
	const objectContextById = new Map<
		number,
		{ classId: number; name: string }
	>();
	objectContextById.set(objectData.id, {
		classId: objectData.hubuum_class_id,
		name: objectData.name,
	});
	for (const relatedObject of relatedObjectsQuery.data ?? []) {
		objectContextById.set(relatedObject.id, {
			classId: relatedObject.hubuum_class_id,
			name: relatedObject.name,
		});
	}
	const relatedObjects = [...(relatedObjectsQuery.data ?? [])].sort(
		(left, right) => {
			const depthDelta = left.path.length - right.path.length;
			if (depthDelta !== 0) {
				return depthDelta;
			}

			return left.name.localeCompare(right.name);
		},
	);
	const ignoredClassSet = new Set(ignoredClassIds);
	const ignoredClassOptions = (classesQuery.data ?? [])
		.filter((item) => item.id !== objectData.hubuum_class_id)
		.sort((left, right) => left.name.localeCompare(right.name));
	const collectionLabel =
		collectionNameById.get(objectData.collection_id) ?? "Collection";
	const editAccessMessage = canEditAnything
		? null
		: permissionCheckPending
			? "Checking whether you can update this object..."
			: canEditObject
				? null
				: canCheckPermissionMembership
					? "You can view this object, but editing is unavailable because your access does not include UpdateObject on this collection."
					: "Could not identify the current user. Showing a read-only object view.";

	function renderObjectLabel(relatedObjectId: number) {
		const relatedObject = objectContextById.get(relatedObjectId);
		if (!relatedObject) {
			return "Unknown related object";
		}

		const relatedClassName = classNameById.get(relatedObject.classId);
		return relatedClassName
			? `${relatedClassName} / ${relatedObject.name}`
			: relatedObject.name;
	}

	function getDisplayPath(path: number[], targetId: number): number[] {
		return normalizeRelatedObjectPath(objectId, targetId, path);
	}

	function renderPathLink(objectPathId: number) {
		const pathObject = objectContextById.get(objectPathId);
		const label = renderObjectLabel(objectPathId);
		return pathObject ? (
			<Link href={`/objects/${pathObject.classId}/${objectPathId}`}>
				{label}
			</Link>
		) : (
			<span>{label}</span>
		);
	}

	function renderObjectPath(path: number[], keyPrefix: string) {
		return (
			<>
				{path.map((pathObjectId, index) => (
					<span key={`${keyPrefix}-${path.slice(0, index + 1).join("-")}`}>
						{index > 0 ? " \u2192 " : null}
						{renderPathLink(pathObjectId)}
					</span>
				))}
			</>
		);
	}

	const isEditingData = editingFields.includes("data");
	const hasNonDataChanges = dirtyFields.some((field) => field !== "data");
	const dataPatchPlanDescription = !dataPatchPlan
		? null
		: hasNonDataChanges
			? "This change list is accurate, but saving data together with other object fields uses the combined object update route. Save data separately to use guarded path updates."
			: dataPatchPlan.mode === "granular"
				? `Saving sends ${dataPatchPlan.patch.length} guarded RFC 6902 operations. Changed values are tested first so stale edits are rejected instead of overwritten.`
				: "This edit exceeds the server's 1,000-operation limit, so saving uses one guarded whole-document replacement.";
	const flattenedData = isEditingData
		? flattenedDataDraft
		: flattenedObjectData;
	const normalizedDataFilter = dataFieldFilter.trim().toLocaleLowerCase();
	const visibleDataProperties = normalizedDataFilter
		? flattenedData.entries.filter(
				(entry) =>
					entry.label.toLocaleLowerCase().includes(normalizedDataFilter) ||
					entry.value.toLocaleLowerCase().includes(normalizedDataFilter),
			)
		: flattenedData.entries;
	const directRelatedObjects = relatedObjects.filter(
		(relatedObject) =>
			getDisplayPath(relatedObject.path, relatedObject.id).length === 1,
	);
	const directRelationCount = directRelatedObjects.length;
	const indirectRelationCount = Math.max(
		0,
		relatedObjects.length - directRelationCount,
	);
	const visibleConnections = showAllRelations
		? relatedObjects
		: relatedObjects.slice(0, CONNECTION_PROPERTY_LIMIT);
	const hiddenConnectionCount =
		relatedObjects.length - visibleConnections.length;

	function toggleIgnoredClass(classToToggle: number, checked: boolean) {
		setShowAllRelations(false);
		setIgnoredClassIds((current) => {
			if (checked) {
				return current.includes(classToToggle)
					? current
					: [...current, classToToggle].sort((left, right) => left - right);
			}

			return current.filter((classIdValue) => classIdValue !== classToToggle);
		});
	}

	return (
		<section className="stack">
			<ObjectDetailTracker
				objectId={objectId}
				objectName={objectData.name}
				classId={classId}
				collectionId={objectData.collection_id}
			/>
			<form
				ref={objectFormRef}
				className="card stack resource-index object-properties-card"
				onSubmit={onSubmit}
				onKeyDownCapture={onSubmitShortcut}
			>
				<header className="object-record-toolbar">
					<h2 className="sr-only">Object properties</h2>
					<div className="object-record-heading">
						<strong ref={objectHeadingRef} tabIndex={-1}>
							Object #{objectData.id}
						</strong>
						<span className="muted">
							{flattenedData.entries.length}
							{flattenedData.truncated ? "+" : ""} data field
							{flattenedData.entries.length === 1 ? "" : "s"} ·{" "}
							{relatedObjects.length} connection
							{relatedObjects.length === 1 ? "" : "s"} loaded
						</span>
					</div>
					<div className="object-record-actions">
						<div className="object-record-times">
							<span>
								Created{" "}
								<time dateTime={objectData.created_at}>
									{formatTimestamp(objectData.created_at)}
								</time>
							</span>
							<span>
								Updated{" "}
								<time dateTime={objectData.updated_at}>
									{formatTimestamp(objectData.updated_at)}
								</time>
							</span>
						</div>
					</div>
				</header>

				{editAccessMessage ? (
					<div className="muted object-edit-access-note">
						{editAccessMessage}
					</div>
				) : null}

				<div className="object-property-surface">
					<section
						className="object-property-section object-property-section--identity"
						aria-labelledby="object-identity-heading"
					>
						<h3 id="object-identity-heading" className="sr-only">
							Object identity
						</h3>
						<div className="object-fact-grid object-fact-grid--core">
							<div
								className={`object-fact${editingFields.includes("name") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Name</div>
								<div className="object-fact-value">
									{editingFields.includes("name") ? (
										<label className="control-field">
											<span className="sr-only">Object name</span>
											<input
												ref={nameInputRef}
												required
												value={name}
												onChange={(event) => {
													setName(event.target.value);
													markFieldDirty("name");
												}}
											/>
										</label>
									) : canEditObject ? (
										<InlineFieldEditTrigger
											fieldLabel="object name"
											valueText={renderFieldText(objectData.name)}
											onClick={() => toggleFieldEditing("name", objectData)}
											disabled={isSavingOrDeleting}
										>
											{renderFieldText(objectData.name)}
										</InlineFieldEditTrigger>
									) : (
										<div
											className="object-fact-display-value"
											title={renderFieldText(objectData.name)}
										>
											{renderFieldText(objectData.name)}
										</div>
									)}
								</div>
							</div>

							<div
								className={`object-fact object-fact--wide${editingFields.includes("description") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Description</div>
								<div className="object-fact-value">
									{editingFields.includes("description") ? (
										<label className="control-field">
											<span className="sr-only">Object description</span>
											<textarea
												ref={descriptionInputRef}
												rows={2}
												value={description}
												onChange={(event) => {
													setDescription(event.target.value);
													markFieldDirty("description");
												}}
											/>
										</label>
									) : canEditObject ? (
										<InlineFieldEditTrigger
											fieldLabel="object description"
											valueText={renderFieldText(objectData.description ?? "")}
											onClick={() =>
												toggleFieldEditing("description", objectData)
											}
											disabled={isSavingOrDeleting}
										>
											{renderFieldText(objectData.description ?? "")}
										</InlineFieldEditTrigger>
									) : (
										<div
											className="object-fact-display-value"
											title={renderFieldText(objectData.description ?? "")}
										>
											{renderFieldText(objectData.description ?? "")}
										</div>
									)}
								</div>
							</div>

							<div
								className={`object-fact${editingFields.includes("collection") ? " is-editing" : ""}`}
							>
								<div className="object-fact-label">Collection</div>
								<div className="object-fact-value">
									{editingFields.includes("collection") ? (
										<div className="control-field">
											<label
												htmlFor="object-detail-collection"
												className="sr-only"
											>
												Collection
											</label>
											{hasCollectionOptions ? (
												<select
													ref={collectionSelectRef}
													id="object-detail-collection"
													required
													value={hasCollectionSelection ? collectionId : ""}
													onChange={(event) => {
														setCollectionId(event.target.value);
														markFieldDirty("collection");
													}}
												>
													{!hasCollectionSelection ? (
														<option value="">Select a collection...</option>
													) : null}
													{collections.map((collection) => (
														<option key={collection.id} value={collection.id}>
															{collection.name}
														</option>
													))}
												</select>
											) : (
												<input
													ref={collectionInputRef}
													id="object-detail-collection"
													required
													type="number"
													min={1}
													value={collectionId}
													onChange={(event) => {
														setCollectionId(event.target.value);
														markFieldDirty("collection");
													}}
													placeholder={
														collectionsQuery.isLoading
															? "Loading collections..."
															: "Enter collection ID"
													}
													disabled={collectionsQuery.isLoading}
												/>
											)}
										</div>
									) : canEditObject ? (
										<InlineFieldEditTrigger
											fieldLabel="object collection"
											valueText={collectionLabel}
											onClick={() =>
												toggleFieldEditing("collection", objectData)
											}
											disabled={isSavingOrDeleting}
										>
											{collectionLabel}
										</InlineFieldEditTrigger>
									) : (
										<div
											className="object-fact-display-value"
											title={collectionLabel}
										>
											{collectionLabel}
										</div>
									)}
								</div>
							</div>

							<div className="object-fact">
								<div className="object-fact-label">Class</div>
								<div
									className="object-fact-value"
									title={
										currentClass?.name ?? `Class #${objectData.hubuum_class_id}`
									}
								>
									{currentClass?.name ?? `Class #${objectData.hubuum_class_id}`}
								</div>
							</div>
						</div>
					</section>

					<section
						className={`object-property-section object-property-section--data${isEditingData ? " is-editing" : ""}`}
						aria-labelledby="object-data-heading"
					>
						<header className="object-property-section-header">
							<div>
								<div className="table-title-row">
									<h3 id="object-data-heading">Data fields</h3>
									<span className="muted table-count">
										{normalizedDataFilter
											? `${visibleDataProperties.length} of ${flattenedData.entries.length}`
											: flattenedData.truncated
												? `${flattenedData.entries.length}+`
												: flattenedData.entries.length}
									</span>
								</div>
								{canEditObject ? (
									<p className="object-data-edit-guidance">
										Click a field to edit · Enter saves the field · Esc cancels
									</p>
								) : null}
							</div>
							<div className="object-property-section-actions">
								<label className="object-data-filter" data-object-nonsubmit>
									<span className="sr-only">Filter object data fields</span>
									<input
										type="search"
										value={dataFieldFilter}
										onChange={(event) => setDataFieldFilter(event.target.value)}
										placeholder="Filter data fields"
									/>
								</label>
								{isEditingData ? (
									<button
										type="button"
										className="ghost"
										onClick={() => {
											setAddDataFieldOpen((current) => !current);
											setActiveDataFieldId(null);
											setNewDataFieldError(null);
										}}
										disabled={isSavingOrDeleting}
										aria-expanded={isAddDataFieldOpen}
									>
										{isAddDataFieldOpen ? "Close add field" : "Add field"}
									</button>
								) : null}
								{canEditObject ? (
									<button
										type="button"
										className="ghost"
										onClick={() => toggleFieldEditing("data", objectData)}
										disabled={isSavingOrDeleting}
									>
										{isEditingData ? "Cancel data edit" : "Edit data"}
									</button>
								) : null}
							</div>
						</header>

						{isEditingData ? (
							<>
								{isAddDataFieldOpen ? (
									<div className="object-data-add-panel" data-object-nonsubmit>
										<label className="control-field object-data-add-path">
											<span>Field path</span>
											<input
												ref={newDataFieldPathRef}
												value={newDataFieldPath}
												onChange={(event) => {
													setNewDataFieldPath(event.target.value);
													setNewDataFieldError(null);
												}}
												placeholder="hardware.rack.name"
											/>
										</label>
										<label className="control-field">
											<span>Type</span>
											<select
												value={newDataFieldType}
												onChange={(event) =>
													changeNewDataFieldType(
														event.target.value as ObjectDataFieldType,
													)
												}
											>
												{OBJECT_DATA_FIELD_TYPES.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</label>
										{newDataFieldType === "string" ||
										newDataFieldType === "number" ? (
											<label className="control-field object-data-add-value">
												<span>Value</span>
												<input
													type={
														newDataFieldType === "number" ? "number" : "text"
													}
													step={
														newDataFieldType === "number" ? "any" : undefined
													}
													value={newDataFieldValue}
													onChange={(event) => {
														setNewDataFieldValue(event.target.value);
														setNewDataFieldError(null);
													}}
												/>
											</label>
										) : null}
										{newDataFieldType === "boolean" ? (
											<label className="control-field object-data-add-value">
												<span>Value</span>
												<select
													value={newDataFieldValue || "false"}
													onChange={(event) =>
														setNewDataFieldValue(event.target.value)
													}
												>
													<option value="false">False</option>
													<option value="true">True</option>
												</select>
											</label>
										) : null}
										{newDataFieldType === "null" ||
										newDataFieldType === "object" ||
										newDataFieldType === "array" ? (
											<div className="object-data-add-value object-data-add-preview">
												<span>Initial value</span>
												<strong>
													{newDataFieldType === "null"
														? "null"
														: newDataFieldType === "array"
															? "[]"
															: "{}"}
												</strong>
											</div>
										) : null}
										<div className="object-data-add-actions">
											<button
												type="button"
												onClick={addDataField}
												disabled={isSavingOrDeleting}
											>
												Add field
											</button>
											<button
												type="button"
												className="ghost"
												onClick={() => {
													setAddDataFieldOpen(false);
													resetNewDataField();
												}}
											>
												Cancel
											</button>
										</div>
										<div className="object-data-add-help muted">
											Use dotted paths for nested objects and brackets for
											arrays, e.g. <code>hardware.cpu[0].model</code>.
										</div>
										{newDataFieldError ? (
											<div
												className="error-banner object-data-add-error"
												role="alert"
											>
												{newDataFieldError}
											</div>
										) : null}
									</div>
								) : null}
								{visibleDataProperties.length ? (
									<dl className="object-property-grid object-property-grid--data object-property-grid--data-editing">
										{visibleDataProperties.map((entry) => {
											const currentValue = getObjectDataValue(
												dataDraft,
												entry.segments,
											);
											const canEditInline =
												entry.kind !== "object-summary" &&
												entry.kind !== "array-summary";
											const isActive = activeDataFieldId === entry.id;
											return (
												<ObjectPropertyItem
													key={`data-edit:${entry.id}`}
													label={entry.label}
													className={`object-property-item--data${isActive ? " object-property-item--data-editing" : ""} object-property-item--${entry.kind}`}
												>
													{isActive ? (
														<ObjectDataValueEditor
															path={entry.label}
															value={
																currentValue.found ? currentValue.value : null
															}
															disabled={isSavingOrDeleting}
															onCommit={(value) =>
																commitInlineDataField(entry.segments, value)
															}
															onCancel={cancelInlineDataField}
														/>
													) : canEditInline ? (
														<ObjectDataEditTrigger
															path={entry.label}
															value={entry.value}
															disabled={isSavingOrDeleting}
															onClick={() => beginInlineDataField(entry.id)}
														/>
													) : (
														<span title={entry.value}>{entry.value}</span>
													)}
												</ObjectPropertyItem>
											);
										})}
									</dl>
								) : (
									<div className="object-property-empty">
										No data fields match “{dataFieldFilter}”.
									</div>
								)}
								{flattenedData.truncated ? (
									<div className="object-property-note">
										Showing the first {flattenedData.entries.length} flattened
										fields. Deep branches remain unchanged unless edited in
										JSON.
									</div>
								) : null}
								<details
									className="object-property-inspector object-data-advanced-editor"
									data-object-nonsubmit
									open={isAdvancedDataEditorOpen}
									onToggle={(event) => {
										setAdvancedDataEditorOpen(event.currentTarget.open);
										if (event.currentTarget.open) {
											setActiveDataFieldId(null);
										}
									}}
								>
									<summary>
										<span>Edit as JSON</span>
										<span>Raw object data with change review</span>
									</summary>
									{isAdvancedDataEditorOpen ? (
										<div className="object-property-inspector-panel">
											<JsonEditor
												id="object-detail-data"
												label="Data (JSON)"
												value={dataInput}
												onChange={updateRawDataInput}
												placeholder='{"hostname":"srv-web-01","env":"prod"}'
												mode="data"
												rows={16}
												validationEnabled={
													currentClass?.validate_schema ?? false
												}
												validationSchema={currentClass?.json_schema}
												helperText={
													currentClass?.validate_schema
														? "This class validates object data against its JSON schema."
														: "This class does not currently enforce JSON schema validation."
												}
											/>
											{dataPatchPlan ? (
												<section
													className="object-data-change-review"
													aria-labelledby="object-data-change-review-heading"
												>
													<div className="object-data-change-review-header">
														<strong id="object-data-change-review-heading">
															Change review
														</strong>
														<span>
															{dataPatchPlan.changes.length} change
															{dataPatchPlan.changes.length === 1 ? "" : "s"}
														</span>
													</div>
													{dataPatchPlan.changes.length === 0 ? (
														<p className="muted">
															The JSON is structurally unchanged.
														</p>
													) : (
														<>
															<p className="muted">
																{dataPatchPlanDescription}
															</p>
															<ol className="object-data-change-list">
																{dataPatchPlan.changes
																	.slice(0, OBJECT_DATA_CHANGE_PREVIEW_LIMIT)
																	.map((change) => (
																		<li
																			key={`${change.operation}:${change.path}`}
																		>
																			<span
																				className={`object-data-change-operation object-data-change-operation--${change.operation}`}
																			>
																				{change.operation}
																			</span>
																			<code title={change.path || "/"}>
																				{formatObjectDataPatchPath(change.path)}
																			</code>
																			<span className="object-data-change-values">
																				{change.operation === "add"
																					? formatObjectDataPatchValue(
																							change.nextValue,
																						)
																					: change.operation === "remove"
																						? formatObjectDataPatchValue(
																								change.previousValue,
																							)
																						: `${formatObjectDataPatchValue(change.previousValue)} → ${formatObjectDataPatchValue(change.nextValue)}`}
																			</span>
																		</li>
																	))}
															</ol>
															{dataPatchPlan.changes.length >
															OBJECT_DATA_CHANGE_PREVIEW_LIMIT ? (
																<p className="muted">
																	+
																	{dataPatchPlan.changes.length -
																		OBJECT_DATA_CHANGE_PREVIEW_LIMIT}{" "}
																	more changes
																</p>
															) : null}
														</>
													)}
												</section>
											) : null}
										</div>
									) : null}
								</details>
							</>
						) : (
							<>
								{visibleDataProperties.length ? (
									<dl className="object-property-grid object-property-grid--data">
										{visibleDataProperties.map((entry) => {
											const canEditInline =
												canEditObject &&
												entry.kind !== "object-summary" &&
												entry.kind !== "array-summary";
											return (
												<ObjectPropertyItem
													key={`data:${entry.id}`}
													label={entry.label}
													className={`object-property-item--data object-property-item--${entry.kind}`}
												>
													{canEditInline ? (
														<ObjectDataEditTrigger
															path={entry.label}
															value={entry.value}
															disabled={isSavingOrDeleting}
															onClick={() => beginInlineDataField(entry.id)}
														/>
													) : (
														<span title={entry.value}>{entry.value}</span>
													)}
												</ObjectPropertyItem>
											);
										})}
									</dl>
								) : (
									<div className="object-property-empty">
										No data fields match “{dataFieldFilter}”.
									</div>
								)}
								{flattenedData.truncated ? (
									<div className="object-property-note">
										Showing the first {flattenedData.entries.length} flattened
										fields. Use the JSON {canEditObject ? "editor" : "view"} for
										the complete value.
									</div>
								) : null}
								{canEditObject ? (
									<button
										type="button"
										className="object-property-json-action"
										data-object-nonsubmit
										onClick={() => beginRawDataEdit(objectData)}
										disabled={isSavingOrDeleting}
									>
										<span>Edit as JSON</span>
										<span>Raw object data with change review</span>
									</button>
								) : (
									<details
										className="object-property-inspector"
										data-object-nonsubmit
										open={isRawDataViewOpen}
										onToggle={(event) =>
											setRawDataViewOpen(event.currentTarget.open)
										}
									>
										<summary>
											<span>View as JSON</span>
											<span>Raw object data</span>
										</summary>
										{isRawDataViewOpen ? (
											<div className="object-property-inspector-panel">
												<pre className="object-json-code is-expanded">
													{stringifyJson(objectData.data)}
												</pre>
											</div>
										) : null}
									</details>
								)}
							</>
						)}
					</section>

					<section
						id="object-connections"
						className="object-property-section object-property-section--connections"
						aria-labelledby="object-connections-heading"
					>
						<header className="object-property-section-header">
							<div>
								<div className="table-title-row">
									<h3 id="object-connections-heading">Connections</h3>
									<span className="muted table-count">
										{directRelationCount} direct · {indirectRelationCount}{" "}
										indirect
									</span>
								</div>
							</div>
							<div
								className="object-property-section-actions object-connection-header-actions"
								data-object-nonsubmit
							>
								<label className="relations-depth-control">
									<span>Depth</span>
									<input
										className="relations-depth-input"
										type="number"
										min={1}
										step={1}
										value={relationDepthLimit}
										onChange={(event) => {
											const nextDepth = Number.parseInt(event.target.value, 10);
											if (Number.isFinite(nextDepth) && nextDepth > 0) {
												setShowAllRelations(false);
												setRelationDepthLimit(nextDepth);
											}
										}}
										aria-label="Connection depth"
									/>
								</label>
								<label className="relations-toggle">
									<input
										type="checkbox"
										checked={includeSelfClass}
										onChange={(event) => {
											setShowAllRelations(false);
											setIncludeSelfClass(event.target.checked);
										}}
									/>
									<span>Include {currentClass?.name ?? "current class"}</span>
								</label>
								<div
									className="relations-filter-dropdown"
									ref={ignoreClassesRef}
								>
									<button
										type="button"
										className="ghost relations-filter-trigger"
										onClick={() => setIgnoreClassesOpen((current) => !current)}
										aria-expanded={isIgnoreClassesOpen}
										aria-controls="object-relation-class-filters"
									>
										Class filters
										{ignoredClassIds.length
											? ` (${ignoredClassIds.length})`
											: ""}
									</button>
									{isIgnoreClassesOpen ? (
										<div
											id="object-relation-class-filters"
											className="relations-filter-menu"
										>
											<strong>Hide classes</strong>
											<span className="muted">
												Exclude noisy classes from this view.
											</span>
											{ignoredClassOptions.length ? (
												ignoredClassOptions.map((hubuumClass) => (
													<label
														key={hubuumClass.id}
														className="relations-filter-option"
													>
														<input
															type="checkbox"
															checked={ignoredClassSet.has(hubuumClass.id)}
															onChange={(event) =>
																toggleIgnoredClass(
																	hubuumClass.id,
																	event.target.checked,
																)
															}
														/>
														<span>{hubuumClass.name}</span>
													</label>
												))
											) : (
												<div className="muted">No other classes available.</div>
											)}
										</div>
									) : null}
								</div>
								<Link
									className="link-chip"
									href={`/relations/objects?classId=${objectData.hubuum_class_id}&objectId=${objectId}&objectView=direct`}
								>
									Manage relations
								</Link>
							</div>
						</header>

						{relatedObjectsQuery.isLoading ? (
							<div className="object-property-empty" role="status">
								Loading connected objects...
							</div>
						) : null}
						{relatedObjectsQuery.isError ? (
							<div className="object-property-empty error-banner" role="alert">
								Failed to load connected objects.{" "}
								{relatedObjectsQuery.error instanceof Error
									? relatedObjectsQuery.error.message
									: "Unknown error"}
							</div>
						) : null}
						{!relatedObjectsQuery.isLoading && !relatedObjectsQuery.isError ? (
							relatedObjects.length ? (
								<>
									<dl className="object-property-grid object-property-grid--connections">
										{visibleConnections.map((relatedObject) => {
											const displayPath = getDisplayPath(
												relatedObject.path,
												relatedObject.id,
											);
											const relatedClassLabel =
												classNameById.get(relatedObject.hubuum_class_id) ??
												`Class #${relatedObject.hubuum_class_id}`;
											return (
												<ObjectPropertyItem
													key={`connection:${relatedObject.hubuum_class_id}:${relatedObject.id}:${displayPath.join("-")}`}
													className="object-property-item--connection"
													label={
														<span
															className={`relation-depth-badge relation-depth-badge--${displayPath.length === 1 ? "direct" : "indirect"}`}
														>
															{displayPath.length === 1
																? "Direct"
																: `${displayPath.length} hops`}
														</span>
													}
												>
													<div className="object-connection-value">
														<Link
															className="row-link"
															href={`/objects/${relatedObject.hubuum_class_id}/${relatedObject.id}`}
															title={`${relatedClassLabel} #${relatedObject.id}`}
														>
															{relatedObject.name}
														</Link>
														{relatedObject.description ? (
															<span
																className="object-connection-description"
																title={relatedObject.description}
															>
																{relatedObject.description}
															</span>
														) : null}
														{displayPath.length > 1 ? (
															<span className="object-connection-route">
																via{" "}
																{renderObjectPath(
																	displayPath.slice(0, -1),
																	`property-${relatedObject.id}`,
																)}
															</span>
														) : null}
													</div>
												</ObjectPropertyItem>
											);
										})}
									</dl>
									{hiddenConnectionCount > 0 ? (
										<button
											type="button"
											className="ghost object-property-more"
											onClick={() => setShowAllRelations(true)}
										>
											Show {hiddenConnectionCount} more connection
											{hiddenConnectionCount === 1 ? "" : "s"}
										</button>
									) : showAllRelations &&
										relatedObjects.length > CONNECTION_PROPERTY_LIMIT ? (
										<button
											type="button"
											className="ghost object-property-more"
											onClick={() => setShowAllRelations(false)}
										>
											Show fewer
										</button>
									) : null}
								</>
							) : (
								<div className="object-property-empty">
									No connections match the current filters. Same-class objects
									are hidden by default.
								</div>
							)
						) : null}
					</section>
				</div>

				{hasActiveEdits ? (
					<fieldset className="object-edit-dock">
						<legend className="sr-only">Unsaved object changes</legend>
						<div className="object-edit-dock-copy">
							<strong>
								Editing {editingFields.length} field
								{editingFields.length === 1 ? "" : "s"}
							</strong>
							<span>
								{activeDataFieldId
									? "Finish or cancel the active data field before saving all changes"
									: "Ctrl/Cmd + Enter to save · Esc to cancel"}
							</span>
						</div>
						<div className="form-actions">
							<button
								type="submit"
								disabled={isSavingOrDeleting || Boolean(activeDataFieldId)}
							>
								{isSavingOrDeleting ? "Saving..." : "Save changes"}
							</button>
							<button
								type="button"
								className="ghost"
								onClick={cancelActiveEdits}
								disabled={isSavingOrDeleting}
							>
								Cancel
							</button>
						</div>
					</fieldset>
				) : null}

				{formError ? (
					<div className="error-banner" role="alert">
						{formError}
					</div>
				) : null}
				{classesQuery.isError ? (
					<div className="muted">
						Could not load class names. Showing class ID only.
					</div>
				) : null}
				{collectionsQuery.isError ? (
					<div className="muted">
						Could not load collections automatically. Manual collection ID entry
						is enabled.
					</div>
				) : null}
				{collectionPermissionsQuery.isError ? (
					<div className="muted">
						Could not verify collection update permissions. Editing is hidden
						until that check succeeds.
					</div>
				) : null}
				{formSuccess ? (
					<div className="muted" role="status">
						{formSuccess}
					</div>
				) : null}

				{!hasActiveEdits ? (
					<div className="object-detail-footer">
						{canEditObject ? null : (
							<div className="muted">This object is currently read-only.</div>
						)}
						<button
							type="button"
							className="danger"
							onClick={onDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete object"}
						</button>
					</div>
				) : null}
			</form>

			<section className="stack" aria-labelledby="object-computed-heading">
				<header className="relations-toolbar">
					<h2 id="object-computed-heading">Computed values</h2>
					<Link
						className="link-chip"
						href={`/classes/${classId}#computed-fields`}
					>
						Manage fields
					</Link>
				</header>
				{objectData.computed.shared.materialization_stale ? (
					<div className="error-banner" role="status">
						Shared values are stale while revision{" "}
						{objectData.computed.shared.revision} is being materialized.
					</div>
				) : null}
				<div className="grid cols-2">
					<ComputedValueScope
						title={`Shared · revision ${objectData.computed.shared.revision}`}
						values={objectData.computed.shared.values}
						errors={objectData.computed.shared.errors}
					/>
					<ComputedValueScope
						title="Personal"
						values={objectData.computed.personal?.values ?? {}}
						errors={objectData.computed.personal?.errors ?? {}}
					/>
				</div>
			</section>

			<RemoteInvocationsPanel
				collectionId={objectData.collection_id}
				subject={{ type: "object", class_id: classId, object_id: objectId }}
				subjectLabel={`object "${objectData.name}"`}
				subjectType="object"
				targetClassId={classId}
			/>

			<ResourceActivityPanel
				scope={{ type: "object", classId, objectId }}
				title="Object audit and history"
			/>
		</section>
	);
}
