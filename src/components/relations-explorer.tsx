"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  deleteApiV1RelationsClassesByRelationId,
  deleteApiV1RelationsObjectsByRelationId,
  getApiV1Classes,
  getApiV1Namespaces,
  getApiV1RelationsObjects,
  postApiV1ClassesByClassIdByFromObjectIdRelationsByToClassIdByToObjectId
} from "@/lib/api/generated/client";
import { CreateModal } from "@/components/create-modal";
import type {
  HubuumClassExpanded,
  HubuumClassRelation,
  HubuumClassRelationTransitive,
  HubuumObject,
  HubuumObjectRelation,
  HubuumObjectWithPath,
  Namespace
} from "@/lib/api/generated/models";
import { OPEN_CREATE_EVENT, type OpenCreateEventDetail } from "@/lib/create-events";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
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

async function fetchClassRelations(classId: number): Promise<HubuumClassRelation[]> {
  const response = await fetch(`/api/classes/${classId}/relations`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load class relations."));
  }

  return expectArrayPayload<HubuumClassRelation>(payload, "class relations");
}

async function fetchTransitiveClassRelations(classId: number): Promise<HubuumClassRelationTransitive[]> {
  const response = await fetch(`/api/v1/classes/${classId}/relations/transitive/`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);

  // Some backend versions do not expose transitive class relations yet.
  // Treat 404 as "feature unavailable/empty" instead of surfacing an error loop.
  if (response.status === 404) {
    return [];
  }

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load transitive class relations."));
  }

  return expectArrayPayload<HubuumClassRelationTransitive>(payload, "transitive class relations");
}

async function fetchObjectsByClass(classId: number): Promise<HubuumObject[]> {
  const response = await fetch(`/api/classes/${classId}/objects`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load objects."));
  }

  return expectArrayPayload<HubuumObject>(payload, "class objects");
}

async function fetchReachableObjectRelations(classId: number, fromObjectId: number): Promise<HubuumObjectWithPath[]> {
  const response = await fetch(`/api/classes/${classId}/${fromObjectId}/relations`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load object relations."));
  }

  return expectArrayPayload<HubuumObjectWithPath>(payload, "object relations");
}

async function fetchDirectObjectRelations(fromObjectId: number): Promise<HubuumObjectRelation[]> {
  const response = await getApiV1RelationsObjects({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load object relations."));
  }

  return response.data.filter((relation) => relation.from_hubuum_object_id === fromObjectId);
}

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type RelationsExplorerProps = {
  mode: "classes" | "objects";
};

type ClassRelationsView = "direct" | "transitive";
type ObjectRelationsView = "direct" | "reachable";

type ObjectContext = {
  classId: number;
  name: string;
  namespaceId: number;
};

export function RelationsExplorer({ mode }: RelationsExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const isClassMode = mode === "classes";
  const isObjectMode = mode === "objects";

  const sourceClassId = searchParams.get("classId") ?? "";
  const sourceObjectId = searchParams.get("objectId") ?? "";
  const initialClassView = searchParams.get("classView");
  const initialObjectView = searchParams.get("objectView");

  const [classRelationsView, setClassRelationsView] = useState<ClassRelationsView>(
    initialClassView === "transitive" ? "transitive" : "direct"
  );
  const [objectRelationsView, setObjectRelationsView] = useState<ObjectRelationsView>(
    initialObjectView === "direct" ? "direct" : "reachable"
  );
  const [classRelationTargetClassId, setClassRelationTargetClassId] = useState("");
  const [objectRelationTargetClassId, setObjectRelationTargetClassId] = useState("");
  const [objectRelationTargetObjectId, setObjectRelationTargetObjectId] = useState("");

  const [classRelationError, setClassRelationError] = useState<string | null>(null);
  const [classRelationSuccess, setClassRelationSuccess] = useState<string | null>(null);
  const [objectRelationError, setObjectRelationError] = useState<string | null>(null);
  const [objectRelationSuccess, setObjectRelationSuccess] = useState<string | null>(null);
  const [classTableError, setClassTableError] = useState<string | null>(null);
  const [classTableSuccess, setClassTableSuccess] = useState<string | null>(null);
  const [objectTableError, setObjectTableError] = useState<string | null>(null);
  const [objectTableSuccess, setObjectTableSuccess] = useState<string | null>(null);
  const [selectedClassRelationIds, setSelectedClassRelationIds] = useState<number[]>([]);
  const [selectedObjectRelationIds, setSelectedObjectRelationIds] = useState<number[]>([]);
  const [pendingClassRelationDeleteIds, setPendingClassRelationDeleteIds] = useState<number[]>([]);
  const [pendingObjectRelationDeleteIds, setPendingObjectRelationDeleteIds] = useState<number[]>([]);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    setCreateModalOpen(true);
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }, [pathname, router, searchParams]);

  const classesQuery = useQuery({
    queryKey: ["classes", "relations-explorer"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "relations-explorer"],
    queryFn: fetchNamespaces,
    enabled: isObjectMode
  });

  const classes = classesQuery.data ?? [];
  const namespaces = namespacesQuery.data ?? [];
  const classNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const classItem of classes) {
      map.set(classItem.id, classItem.name);
    }
    return map;
  }, [classes]);
  const namespaceNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const namespace of namespaces) {
      map.set(namespace.id, namespace.name);
    }
    for (const classItem of classes) {
      if (!map.has(classItem.namespace.id)) {
        map.set(classItem.namespace.id, classItem.namespace.name);
      }
    }
    return map;
  }, [classes, namespaces]);

  const resolvedSourceClassId = useMemo(() => {
    const parsed = parseId(sourceClassId);
    if (parsed !== null && classes.some((item) => item.id === parsed)) {
      return String(parsed);
    }

    return classes.length ? String(classes[0].id) : "";
  }, [classes, sourceClassId]);
  const parsedSourceClassId = useMemo(() => parseId(resolvedSourceClassId), [resolvedSourceClassId]);
  const parsedClassRelationTargetClassId = useMemo(
    () => parseId(classRelationTargetClassId),
    [classRelationTargetClassId]
  );
  const parsedObjectRelationTargetClassId = useMemo(
    () => parseId(objectRelationTargetClassId),
    [objectRelationTargetClassId]
  );
  const parsedObjectRelationTargetObjectId = useMemo(
    () => parseId(objectRelationTargetObjectId),
    [objectRelationTargetObjectId]
  );

  const classRelationsQuery = useQuery({
    queryKey: ["class-relations", parsedSourceClassId],
    queryFn: async () => fetchClassRelations(parsedSourceClassId ?? 0),
    enabled: parsedSourceClassId !== null
  });
  const classTransitiveRelationsQuery = useQuery({
    queryKey: ["class-relations-transitive", parsedSourceClassId],
    queryFn: async () => fetchTransitiveClassRelations(parsedSourceClassId ?? 0),
    enabled: isClassMode && classRelationsView === "transitive" && parsedSourceClassId !== null
  });
  const sourceObjectsQuery = useQuery({
    queryKey: ["objects", "relations-source", parsedSourceClassId],
    queryFn: async () => fetchObjectsByClass(parsedSourceClassId ?? 0),
    enabled: isObjectMode && parsedSourceClassId !== null
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
    [resolvedSourceObjectId]
  );

  const classRelationTargetOptions = useMemo(
    () => classes.filter((classItem) => classItem.id !== parsedSourceClassId),
    [classes, parsedSourceClassId]
  );
  const relatedTargetClassIds = useMemo(() => {
    const ids = new Set<number>();
    if (parsedSourceClassId === null) {
      return ids;
    }

    const directClassRelations = Array.isArray(classRelationsQuery.data) ? classRelationsQuery.data : [];
    for (const relation of directClassRelations) {
      if (relation.from_hubuum_class_id === parsedSourceClassId) {
        ids.add(relation.to_hubuum_class_id);
      }
    }

    return ids;
  }, [classRelationsQuery.data, parsedSourceClassId]);
  const objectRelationTargetClassOptions = useMemo(
    () => classes.filter((classItem) => relatedTargetClassIds.has(classItem.id)),
    [classes, relatedTargetClassIds]
  );

  const targetObjectsQuery = useQuery({
    queryKey: ["objects", "relations-target", parsedObjectRelationTargetClassId],
    queryFn: async () => fetchObjectsByClass(parsedObjectRelationTargetClassId ?? 0),
    enabled: isObjectMode && parsedObjectRelationTargetClassId !== null
  });
  const objectReachabilityQuery = useQuery({
    queryKey: ["object-relations-reachable", parsedSourceClassId, parsedResolvedSourceObjectId],
    queryFn: async () => fetchReachableObjectRelations(parsedSourceClassId ?? 0, parsedResolvedSourceObjectId ?? 0),
    enabled:
      isObjectMode &&
      objectRelationsView === "reachable" &&
      parsedSourceClassId !== null &&
      parsedResolvedSourceObjectId !== null
  });
  const objectDirectRelationsQuery = useQuery({
    queryKey: ["object-relations-direct", parsedResolvedSourceObjectId],
    queryFn: async () => fetchDirectObjectRelations(parsedResolvedSourceObjectId ?? 0),
    enabled: isObjectMode && objectRelationsView === "direct" && parsedResolvedSourceObjectId !== null
  });

  const targetObjects = targetObjectsQuery.data ?? [];
  const classDirectRelations = Array.isArray(classRelationsQuery.data) ? classRelationsQuery.data : [];
  const classTransitiveRelations = Array.isArray(classTransitiveRelationsQuery.data)
    ? classTransitiveRelationsQuery.data
    : [];
  const objectReachabilityRelations = Array.isArray(objectReachabilityQuery.data)
    ? objectReachabilityQuery.data
    : [];
  const objectDirectRelations = Array.isArray(objectDirectRelationsQuery.data)
    ? objectDirectRelationsQuery.data
    : [];

  const classRelationById = useMemo(() => {
    const map = new Map<number, HubuumClassRelation>();
    for (const relation of classDirectRelations) {
      map.set(relation.id, relation);
    }
    return map;
  }, [classDirectRelations]);

  const objectContextById = useMemo(() => {
    const map = new Map<number, ObjectContext>();

    const store = (objectItem: {
      hubuum_class_id: number;
      id: number;
      name: string;
      namespace_id: number;
    }) => {
      map.set(objectItem.id, {
        classId: objectItem.hubuum_class_id,
        name: objectItem.name,
        namespaceId: objectItem.namespace_id
      });
    };

    for (const objectItem of sourceObjects) {
      store(objectItem);
    }
    for (const objectItem of targetObjects) {
      store(objectItem);
    }
    for (const objectItem of objectReachabilityRelations) {
      store(objectItem);
    }

    return map;
  }, [objectReachabilityRelations, sourceObjects, targetObjects]);

  const classRelationExists =
    parsedSourceClassId !== null &&
    parsedClassRelationTargetClassId !== null &&
    classDirectRelations.some(
      (relation) =>
        relation.from_hubuum_class_id === parsedSourceClassId &&
        relation.to_hubuum_class_id === parsedClassRelationTargetClassId
    );

  useEffect(() => {
    if (!pathname) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (resolvedSourceClassId) {
      params.set("classId", resolvedSourceClassId);
    } else {
      params.delete("classId");
    }

    if (isClassMode) {
      params.set("classView", classRelationsView);
      params.delete("objectView");
      params.delete("objectId");
    } else if (isObjectMode) {
      params.set("objectView", objectRelationsView);
      params.delete("classView");
      if (resolvedSourceObjectId) {
        params.set("objectId", resolvedSourceObjectId);
      } else {
        params.delete("objectId");
      }
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [
    classRelationsView,
    isClassMode,
    isObjectMode,
    objectRelationsView,
    pathname,
    resolvedSourceClassId,
    resolvedSourceObjectId
  ]);

  useEffect(() => {
    if (!isObjectMode) {
      return;
    }

    if (!targetObjects.length) {
      setObjectRelationTargetObjectId("");
      return;
    }

    const exists = targetObjects.some((item) => String(item.id) === objectRelationTargetObjectId);
    if (!exists) {
      setObjectRelationTargetObjectId(String(targetObjects[0].id));
    }
  }, [isObjectMode, objectRelationTargetObjectId, targetObjects]);

  useEffect(() => {
    if (!isClassMode) {
      return;
    }

    if (!classRelationTargetOptions.length) {
      setClassRelationTargetClassId("");
      return;
    }

    const exists = classRelationTargetOptions.some((item) => String(item.id) === classRelationTargetClassId);
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
      return;
    }

    const exists = objectRelationTargetClassOptions.some(
      (item) => String(item.id) === objectRelationTargetClassId
    );
    if (!exists) {
      setObjectRelationTargetClassId(String(objectRelationTargetClassOptions[0].id));
    }
  }, [isObjectMode, objectRelationTargetClassId, objectRelationTargetClassOptions]);

  useEffect(() => {
    if (!selectedClassRelationIds.length) {
      return;
    }

    const existingIds = new Set(classDirectRelations.map((relation) => relation.id));
    setSelectedClassRelationIds((current) => current.filter((relationId) => existingIds.has(relationId)));
  }, [classDirectRelations, selectedClassRelationIds.length]);

  useEffect(() => {
    if (!selectedObjectRelationIds.length) {
      return;
    }

    const existingIds = new Set(objectDirectRelations.map((relation) => relation.id));
    setSelectedObjectRelationIds((current) => current.filter((relationId) => existingIds.has(relationId)));
  }, [objectDirectRelations, selectedObjectRelationIds.length]);

  useEffect(() => {
    if (
      (classRelationsView === "direct" || classRelationsView === "transitive") &&
      (parsedSourceClassId === null || parsedSourceClassId > 0)
    ) {
      setSelectedClassRelationIds([]);
      setClassTableError(null);
      setClassTableSuccess(null);
    }
  }, [classRelationsView, parsedSourceClassId]);

  useEffect(() => {
    if (
      (objectRelationsView === "direct" || objectRelationsView === "reachable") &&
      (parsedResolvedSourceObjectId === null || parsedResolvedSourceObjectId > 0)
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

  const createClassRelationMutation = useMutation({
    mutationFn: async (payload: { sourceClassId: number; targetClassId: number }) => {
      const response = await fetch(`/api/classes/${payload.sourceClassId}/relations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          to_hubuum_class_id: payload.targetClassId
        })
      });
      const responsePayload = await parseJsonPayload(response);

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(responsePayload, "Failed to create class relation."));
      }
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["class-relations", variables.sourceClassId] }),
        queryClient.invalidateQueries({ queryKey: ["class-relations-transitive", variables.sourceClassId] })
      ]);
      setClassRelationError(null);
      setClassRelationSuccess("Class relation created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setClassRelationSuccess(null);
      setClassRelationError(error instanceof Error ? error.message : "Failed to create class relation.");
    }
  });

  const createObjectRelationMutation = useMutation({
    mutationFn: async (payload: {
      sourceClassId: number;
      sourceObjectId: number;
      targetClassId: number;
      targetObjectId: number;
    }) => {
      const response = await postApiV1ClassesByClassIdByFromObjectIdRelationsByToClassIdByToObjectId(
        payload.sourceClassId,
        payload.sourceObjectId,
        payload.targetClassId,
        payload.targetObjectId,
        {
          credentials: "include"
        }
      );

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to create object relation."));
      }
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["object-relations-reachable", variables.sourceClassId, variables.sourceObjectId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["object-relations-direct", variables.sourceObjectId]
        })
      ]);
      setObjectRelationError(null);
      setObjectRelationSuccess("Object relation created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setObjectRelationSuccess(null);
      setObjectRelationError(error instanceof Error ? error.message : "Failed to create object relation.");
    }
  });

  const deleteClassRelationsMutation = useMutation({
    mutationFn: async (relationIds: number[]) => {
      await Promise.all(
        relationIds.map(async (relationId) => {
          const response = await deleteApiV1RelationsClassesByRelationId(relationId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(
              `#${relationId}: ${getApiErrorMessage(response.data, "Failed to delete class relation.")}`
            );
          }
        })
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
        queryClient.invalidateQueries({ queryKey: ["class-relations-transitive"] }),
        queryClient.invalidateQueries({ queryKey: ["object-relations-reachable"] }),
        queryClient.invalidateQueries({ queryKey: ["object-relations-direct"] })
      ]);
      setSelectedClassRelationIds([]);
      setClassTableError(null);
      setClassTableSuccess(`${count} class relation${count === 1 ? "" : "s"} deleted.`);
    },
    onError: (error) => {
      setClassTableSuccess(null);
      setClassTableError(error instanceof Error ? error.message : "Failed to delete class relations.");
    },
    onSettled: () => {
      setPendingClassRelationDeleteIds([]);
    }
  });

  const deleteObjectRelationsMutation = useMutation({
    mutationFn: async (relationIds: number[]) => {
      await Promise.all(
        relationIds.map(async (relationId) => {
          const response = await deleteApiV1RelationsObjectsByRelationId(relationId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(
              `#${relationId}: ${getApiErrorMessage(response.data, "Failed to delete object relation.")}`
            );
          }
        })
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
        queryClient.invalidateQueries({ queryKey: ["object-relations-reachable"] }),
        queryClient.invalidateQueries({ queryKey: ["object-relations-direct"] })
      ]);
      setSelectedObjectRelationIds([]);
      setObjectTableError(null);
      setObjectTableSuccess(`${count} object relation${count === 1 ? "" : "s"} deleted.`);
    },
    onError: (error) => {
      setObjectTableSuccess(null);
      setObjectTableError(error instanceof Error ? error.message : "Failed to delete object relations.");
    },
    onSettled: () => {
      setPendingObjectRelationDeleteIds([]);
    }
  });

  function onCreateClassRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClassRelationError(null);
    setClassRelationSuccess(null);

    if (parsedSourceClassId === null || parsedClassRelationTargetClassId === null) {
      setClassRelationError("Select both source and target classes.");
      return;
    }

    if (parsedSourceClassId === parsedClassRelationTargetClassId) {
      setClassRelationError("Target class must be different from source class.");
      return;
    }

    if (classRelationExists) {
      setClassRelationError("This class relation already exists.");
      return;
    }

    createClassRelationMutation.mutate({
      sourceClassId: parsedSourceClassId,
      targetClassId: parsedClassRelationTargetClassId
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
      setObjectRelationError("Select source class/object and target class/object.");
      return;
    }

    if (parsedObjectRelationTargetClassId === parsedSourceClassId) {
      setObjectRelationError("Target class must be different from source class.");
      return;
    }

    if (!relatedTargetClassIds.has(parsedObjectRelationTargetClassId)) {
      setObjectRelationError("Target class must be related to the source class.");
      return;
    }

    createObjectRelationMutation.mutate({
      sourceClassId: parsedSourceClassId,
      sourceObjectId: parsedResolvedSourceObjectId,
      targetClassId: parsedObjectRelationTargetClassId,
      targetObjectId: parsedObjectRelationTargetObjectId
    });
  }

  if (classesQuery.isLoading) {
    return <div className="card">Loading class options...</div>;
  }

  if (classesQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load class options. {" "}
        {classesQuery.error instanceof Error ? classesQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const selectedClass = classes.find((item) => item.id === parsedSourceClassId);
  const selectedSourceObject = sourceObjects.find((item) => item.id === parsedResolvedSourceObjectId);
  const canCreateClassRelation =
    parsedSourceClassId !== null &&
    parsedClassRelationTargetClassId !== null &&
    parsedClassRelationTargetClassId !== parsedSourceClassId &&
    !classRelationExists;
  const canCreateObjectRelation =
    parsedSourceClassId !== null &&
    parsedResolvedSourceObjectId !== null &&
    parsedObjectRelationTargetClassId !== null &&
    parsedObjectRelationTargetObjectId !== null &&
    parsedObjectRelationTargetClassId !== parsedSourceClassId &&
    relatedTargetClassIds.has(parsedObjectRelationTargetClassId);

  const allClassRelationsSelected =
    classDirectRelations.length > 0 && selectedClassRelationIds.length === classDirectRelations.length;
  const allObjectRelationsSelected =
    objectDirectRelations.length > 0 && selectedObjectRelationIds.length === objectDirectRelations.length;

  function renderClassById(classId: number): string {
    const className = classNameById.get(classId);
    return className ? `${className} (#${classId})` : `#${classId}`;
  }

  function renderNamespaceById(namespaceId: number): string {
    const namespaceName = namespaceNameById.get(namespaceId);
    return namespaceName ? `${namespaceName} (#${namespaceId})` : `#${namespaceId}`;
  }

  function renderObjectById(objectId: number): string {
    const objectInfo = objectContextById.get(objectId);
    if (!objectInfo) {
      return `#${objectId}`;
    }

    const className = classNameById.get(objectInfo.classId) ?? `Class #${objectInfo.classId}`;
    return `${objectInfo.name} (${className}) #${objectId}`;
  }

  function renderObjectPath(path: number[]): string {
    if (!path.length) {
      return "-";
    }

    return path.map((objectId) => renderObjectById(objectId)).join(" -> ");
  }

  function onClassRelationsViewChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextView = event.target.value === "transitive" ? "transitive" : "direct";
    setClassRelationsView(nextView);
  }

  function onObjectRelationsViewChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextView = event.target.value === "direct" ? "direct" : "reachable";
    setObjectRelationsView(nextView);
  }

  function toggleAllClassRelations(checked: boolean) {
    if (checked) {
      setSelectedClassRelationIds(classDirectRelations.map((relation) => relation.id));
      return;
    }

    setSelectedClassRelationIds([]);
  }

  function toggleClassRelation(relationId: number, checked: boolean) {
    setSelectedClassRelationIds((current) => {
      if (checked) {
        return current.includes(relationId) ? current : [...current, relationId];
      }

      return current.filter((id) => id !== relationId);
    });
  }

  function toggleAllObjectRelations(checked: boolean) {
    if (checked) {
      setSelectedObjectRelationIds(objectDirectRelations.map((relation) => relation.id));
      return;
    }

    setSelectedObjectRelationIds([]);
  }

  function toggleObjectRelation(relationId: number, checked: boolean) {
    setSelectedObjectRelationIds((current) => {
      if (checked) {
        return current.includes(relationId) ? current : [...current, relationId];
      }

      return current.filter((id) => id !== relationId);
    });
  }

  function deleteClassRelation(relationId: number) {
    if (!window.confirm(`Delete class relation #${relationId}?`)) {
      return;
    }

    deleteClassRelationsMutation.mutate([relationId]);
  }

  function deleteSelectedClassRelations() {
    if (!selectedClassRelationIds.length) {
      return;
    }

    if (!window.confirm(`Delete ${selectedClassRelationIds.length} selected class relation(s)?`)) {
      return;
    }

    deleteClassRelationsMutation.mutate([...selectedClassRelationIds]);
  }

  function deleteObjectRelation(relationId: number) {
    if (!window.confirm(`Delete object relation #${relationId}?`)) {
      return;
    }

    deleteObjectRelationsMutation.mutate([relationId]);
  }

  function deleteSelectedObjectRelations() {
    if (!selectedObjectRelationIds.length) {
      return;
    }

    if (!window.confirm(`Delete ${selectedObjectRelationIds.length} selected object relation(s)?`)) {
      return;
    }

    deleteObjectRelationsMutation.mutate([...selectedObjectRelationIds]);
  }

  function renderCreateClassRelationForm() {
    return (
      <form className="stack" onSubmit={onCreateClassRelation}>
        <div className="relation-create-grid">
          <div className="relation-create-pane">
            <h4>From</h4>
              <div className="muted">
                {selectedClass
                  ? `${selectedClass.name} (#${selectedClass.id})`
                  : "Select a source class in the top bar first."}
              </div>
            </div>

          <div className="relation-create-pane">
            <h4>To</h4>
            <label className="control-field">
              <span>Class</span>
              <select
                value={classRelationTargetClassId}
                onChange={(event) => setClassRelationTargetClassId(event.target.value)}
                disabled={!classRelationTargetOptions.length}
              >
                {!classRelationTargetOptions.length ? <option value="">No eligible target classes</option> : null}
                {classRelationTargetOptions.map((hubuumClass) => (
                  <option key={hubuumClass.id} value={hubuumClass.id}>
                    {hubuumClass.name} (#{hubuumClass.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {classRelationError ? <div className="error-banner">{classRelationError}</div> : null}
        {!classRelationTargetOptions.length ? (
          <div className="muted">Create at least two classes to add class-to-class relations.</div>
        ) : null}
        {classRelationSuccess ? <div className="muted">{classRelationSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createClassRelationMutation.isPending || !canCreateClassRelation}>
            {createClassRelationMutation.isPending ? "Creating..." : "Create class relation"}
          </button>
        </div>
      </form>
    );
  }

  function renderCreateObjectRelationForm() {
    return (
      <form className="stack" onSubmit={onCreateObjectRelation}>
        <div className="relation-create-grid">
          <div className="relation-create-pane">
            <h4>From</h4>
            <div className="stack">
              <div className="muted">
                Class: {selectedClass ? `${selectedClass.name} (#${selectedClass.id})` : "Select source class in the top bar"}
              </div>
              <div className="muted">
                Object:{" "}
                {selectedSourceObject
                  ? `${selectedSourceObject.name} (#${selectedSourceObject.id})`
                  : "Select source object in the top bar"}
              </div>
            </div>
          </div>

          <div className="relation-create-pane">
            <h4>To</h4>
            <label className="control-field">
              <span>Class</span>
              <select
                value={objectRelationTargetClassId}
                onChange={(event) => setObjectRelationTargetClassId(event.target.value)}
                disabled={!objectRelationTargetClassOptions.length}
              >
                {!objectRelationTargetClassOptions.length ? <option value="">No eligible target classes</option> : null}
                {objectRelationTargetClassOptions.map((hubuumClass) => (
                  <option key={hubuumClass.id} value={hubuumClass.id}>
                    {hubuumClass.name} (#{hubuumClass.id})
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Object</span>
              <select
                value={objectRelationTargetObjectId}
                onChange={(event) => setObjectRelationTargetObjectId(event.target.value)}
                disabled={!targetObjects.length}
              >
                {!targetObjects.length ? <option value="">No objects available</option> : null}
                {targetObjects.map((objectItem) => (
                  <option key={objectItem.id} value={objectItem.id}>
                    {objectItem.name} (#{objectItem.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {objectRelationError ? <div className="error-banner">{objectRelationError}</div> : null}
        {classRelationsQuery.isLoading ? <div className="muted">Loading related target classes...</div> : null}
        {!classRelationsQuery.isLoading && !objectRelationTargetClassOptions.length ? (
          <div className="muted">
            Create a class relation from this source class before adding object-to-object relations.
          </div>
        ) : null}
        {objectRelationSuccess ? <div className="muted">{objectRelationSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createObjectRelationMutation.isPending || !canCreateObjectRelation}>
            {createObjectRelationMutation.isPending ? "Creating..." : "Create object relation"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <CreateModal
        open={isCreateModalOpen}
        title={isClassMode ? "Create class relation" : "Create object relation"}
        onClose={() => setCreateModalOpen(false)}
      >
        <div className="stack">{isClassMode ? renderCreateClassRelationForm() : renderCreateObjectRelationForm()}</div>
      </CreateModal>

      {isClassMode ? (
        <div className="card table-wrap">
          <div className="table-header">
            <h3>Class relations</h3>
            <div className="table-tools">
              <select
                aria-label="Class relations view"
                value={classRelationsView}
                onChange={onClassRelationsViewChange}
              >
                <option value="direct">Direct relations</option>
                <option value="transitive">Transitive reachability</option>
              </select>
              <span className="muted">
                {classRelationsView === "direct"
                  ? classRelationsQuery.data
                    ? `${classDirectRelations.length} loaded`
                    : parsedSourceClassId
                      ? "Waiting..."
                      : "No class"
                  : classTransitiveRelationsQuery.data
                    ? `${classTransitiveRelations.length} loaded`
                    : parsedSourceClassId
                      ? "Waiting..."
                      : "No class"}
                {classRelationsView === "direct" && selectedClassRelationIds.length
                  ? ` • ${selectedClassRelationIds.length} selected`
                  : ""}
              </span>
              {classRelationsView === "direct" ? (
                <button
                  type="button"
                  className="danger"
                  onClick={deleteSelectedClassRelations}
                  disabled={deleteClassRelationsMutation.isPending || selectedClassRelationIds.length === 0}
                >
                  {deleteClassRelationsMutation.isPending ? "Deleting..." : "Delete selected"}
                </button>
              ) : null}
            </div>
          </div>

          {classRelationSuccess ? <div className="muted">{classRelationSuccess}</div> : null}
          {classTableError ? <div className="error-banner">{classTableError}</div> : null}
          {classTableSuccess ? <div className="muted">{classTableSuccess}</div> : null}

          {parsedSourceClassId === null ? (
            <div className="muted">Select a class to load class-level relations.</div>
          ) : classRelationsView === "direct" ? (
            classRelationsQuery.isLoading ? (
              <div>Loading class relations...</div>
            ) : classRelationsQuery.isError ? (
              <div className="error-banner">
                Failed to load class relations. {" "}
                {classRelationsQuery.error instanceof Error ? classRelationsQuery.error.message : "Unknown error"}
              </div>
            ) : classDirectRelations.length === 0 ? (
              <div className="muted">No direct class relations for this class.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="check-col">
                      <input
                        type="checkbox"
                        aria-label="Select all class relations"
                        checked={allClassRelationsSelected}
                        onChange={(event) => toggleAllClassRelations(event.target.checked)}
                      />
                    </th>
                    <th>ID</th>
                    <th>From class</th>
                    <th>To class</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {classDirectRelations.map((relation) => {
                    const isRowDeleting = pendingClassRelationDeleteIds.includes(relation.id);
                    return (
                      <tr key={relation.id}>
                        <td className="check-col">
                          <input
                            type="checkbox"
                            aria-label={`Select class relation ${relation.id}`}
                            checked={selectedClassRelationIds.includes(relation.id)}
                            onChange={(event) => toggleClassRelation(relation.id, event.target.checked)}
                          />
                        </td>
                        <td>{relation.id}</td>
                        <td>
                          <Link href={`/classes/${relation.from_hubuum_class_id}`} className="row-link">
                            {renderClassById(relation.from_hubuum_class_id)}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/classes/${relation.to_hubuum_class_id}`} className="row-link">
                            {renderClassById(relation.to_hubuum_class_id)}
                          </Link>
                        </td>
                        <td>{new Date(relation.updated_at).toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deleteClassRelation(relation.id)}
                            disabled={deleteClassRelationsMutation.isPending}
                          >
                            {isRowDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : classTransitiveRelationsQuery.isLoading ? (
            <div>Loading transitive class relations...</div>
          ) : classTransitiveRelationsQuery.isError ? (
            <div className="error-banner">
              Failed to load transitive class relations. {" "}
              {classTransitiveRelationsQuery.error instanceof Error
                ? classTransitiveRelationsQuery.error.message
                : "Unknown error"}
            </div>
          ) : classTransitiveRelations.length === 0 ? (
            <div className="muted">No transitive class paths for this class.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ancestor class</th>
                  <th>Descendant class</th>
                  <th>Depth</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {classTransitiveRelations.map((relation, index) => (
                  <tr
                    key={`${relation.ancestor_class_id}-${relation.descendant_class_id}-${relation.depth}-${index}`}
                  >
                    <td>{renderClassById(relation.ancestor_class_id)}</td>
                    <td>{renderClassById(relation.descendant_class_id)}</td>
                    <td>{relation.depth}</td>
                    <td>
                      {relation.path.length
                        ? relation.path
                            .map((pathClassId) =>
                              pathClassId === null ? "?" : renderClassById(pathClassId)
                            )
                            .join(" -> ")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {isObjectMode ? (
        <div className="card table-wrap">
          <div className="table-header">
            <h3>Object relations</h3>
            <div className="table-tools">
              <select
                aria-label="Object relations view"
                value={objectRelationsView}
                onChange={onObjectRelationsViewChange}
              >
                <option value="direct">Direct relations</option>
                <option value="reachable">Reachability</option>
              </select>
              <span className="muted">
                {objectRelationsView === "direct"
                  ? objectDirectRelationsQuery.data
                    ? `${objectDirectRelations.length} loaded`
                    : parsedResolvedSourceObjectId !== null
                      ? "Waiting..."
                      : "No source object"
                  : objectReachabilityQuery.data
                    ? `${objectReachabilityRelations.length} loaded`
                    : parsedResolvedSourceObjectId !== null
                      ? "Waiting..."
                      : "No source object"}
                {objectRelationsView === "direct" && selectedObjectRelationIds.length
                  ? ` • ${selectedObjectRelationIds.length} selected`
                  : ""}
              </span>
              {objectRelationsView === "direct" ? (
                <button
                  type="button"
                  className="danger"
                  onClick={deleteSelectedObjectRelations}
                  disabled={deleteObjectRelationsMutation.isPending || selectedObjectRelationIds.length === 0}
                >
                  {deleteObjectRelationsMutation.isPending ? "Deleting..." : "Delete selected"}
                </button>
              ) : null}
            </div>
          </div>

          {objectRelationSuccess ? <div className="muted">{objectRelationSuccess}</div> : null}
          {objectTableError ? <div className="error-banner">{objectTableError}</div> : null}
          {objectTableSuccess ? <div className="muted">{objectTableSuccess}</div> : null}

          {parsedSourceClassId === null ? (
            <div className="muted">Select a class first.</div>
          ) : parsedResolvedSourceObjectId === null ? (
            <div className="muted">Select a source object to load object-level relations.</div>
          ) : objectRelationsView === "direct" ? (
            objectDirectRelationsQuery.isLoading ? (
              <div>Loading direct object relations...</div>
            ) : objectDirectRelationsQuery.isError ? (
              <div className="error-banner">
                Failed to load direct object relations. {" "}
                {objectDirectRelationsQuery.error instanceof Error
                  ? objectDirectRelationsQuery.error.message
                  : "Unknown error"}
              </div>
            ) : objectDirectRelations.length === 0 ? (
              <div className="muted">No direct object relations for this object.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="check-col">
                      <input
                        type="checkbox"
                        aria-label="Select all object relations"
                        checked={allObjectRelationsSelected}
                        onChange={(event) => toggleAllObjectRelations(event.target.checked)}
                      />
                    </th>
                    <th>Relation ID</th>
                    <th>To object</th>
                    <th>To class</th>
                    <th>Class relation ID</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {objectDirectRelations.map((relation) => {
                    const targetClassId = classRelationById.get(relation.class_relation_id)?.to_hubuum_class_id;
                    const toObjectLabel = renderObjectById(relation.to_hubuum_object_id);
                    const isRowDeleting = pendingObjectRelationDeleteIds.includes(relation.id);

                    return (
                      <tr key={relation.id}>
                        <td className="check-col">
                          <input
                            type="checkbox"
                            aria-label={`Select object relation ${relation.id}`}
                            checked={selectedObjectRelationIds.includes(relation.id)}
                            onChange={(event) => toggleObjectRelation(relation.id, event.target.checked)}
                          />
                        </td>
                        <td>{relation.id}</td>
                        <td>
                          {targetClassId ? (
                            <Link
                              href={`/objects/${targetClassId}/${relation.to_hubuum_object_id}`}
                              className="row-link"
                            >
                              {toObjectLabel}
                            </Link>
                          ) : (
                            toObjectLabel
                          )}
                        </td>
                        <td>
                          {targetClassId ? renderClassById(targetClassId) : `Class relation #${relation.class_relation_id}`}
                        </td>
                        <td>{relation.class_relation_id}</td>
                        <td>{new Date(relation.updated_at).toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deleteObjectRelation(relation.id)}
                            disabled={deleteObjectRelationsMutation.isPending}
                          >
                            {isRowDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : objectReachabilityQuery.isLoading ? (
            <div>Loading reachable objects...</div>
          ) : objectReachabilityQuery.isError ? (
            <div className="error-banner">
              Failed to load object reachability. {" "}
              {objectReachabilityQuery.error instanceof Error
                ? objectReachabilityQuery.error.message
                : "Unknown error"}
            </div>
          ) : objectReachabilityRelations.length === 0 ? (
            <div className="muted">No reachable objects for this source object.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Namespace</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {objectReachabilityRelations.map((relation) => (
                  <tr key={relation.id}>
                    <td>{relation.id}</td>
                    <td>
                      <Link href={`/objects/${relation.hubuum_class_id}/${relation.id}`} className="row-link">
                        {relation.name}
                      </Link>
                    </td>
                    <td>{renderClassById(relation.hubuum_class_id)}</td>
                    <td>{renderNamespaceById(relation.namespace_id)}</td>
                    <td>{renderObjectPath(relation.path)}</td>
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
