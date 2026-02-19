"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  getApiV1Classes,
  postApiV1ClassesByClassIdByFromObjectIdRelationsByToClassIdByToObjectId,
} from "@/lib/api/generated/client";
import type {
  HubuumClassExpanded,
  HubuumClassRelation,
  HubuumObject,
  HubuumObjectWithPath
} from "@/lib/api/generated/models";
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

async function fetchObjectRelations(classId: number, fromObjectId: number): Promise<HubuumObjectWithPath[]> {
  const response = await fetch(`/api/classes/${classId}/${fromObjectId}/relations`, {
    credentials: "include"
  });
  const payload = await parseJsonPayload(response);

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(payload, "Failed to load object relations."));
  }

  return expectArrayPayload<HubuumObjectWithPath>(payload, "object relations");
}

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function RelationsExplorer() {
  const queryClient = useQueryClient();
  const classesQuery = useQuery({
    queryKey: ["classes", "relations-explorer"],
    queryFn: fetchClasses
  });

  const [sourceClassId, setSourceClassId] = useState("");
  const [sourceObjectId, setSourceObjectId] = useState("");
  const [classRelationTargetClassId, setClassRelationTargetClassId] = useState("");
  const [objectRelationTargetClassId, setObjectRelationTargetClassId] = useState("");
  const [objectRelationTargetObjectId, setObjectRelationTargetObjectId] = useState("");

  const [classRelationError, setClassRelationError] = useState<string | null>(null);
  const [classRelationSuccess, setClassRelationSuccess] = useState<string | null>(null);
  const [objectRelationError, setObjectRelationError] = useState<string | null>(null);
  const [objectRelationSuccess, setObjectRelationSuccess] = useState<string | null>(null);

  const classes = classesQuery.data ?? [];

  useEffect(() => {
    if (sourceClassId || !classes.length) {
      return;
    }

    setSourceClassId(String(classes[0].id));
  }, [sourceClassId, classes]);

  const parsedSourceClassId = useMemo(() => parseId(sourceClassId), [sourceClassId]);
  const parsedSourceObjectId = useMemo(() => parseId(sourceObjectId), [sourceObjectId]);
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
  const sourceObjectsQuery = useQuery({
    queryKey: ["objects", "relations-source", parsedSourceClassId],
    queryFn: async () => fetchObjectsByClass(parsedSourceClassId ?? 0),
    enabled: parsedSourceClassId !== null
  });
  const targetObjectsQuery = useQuery({
    queryKey: ["objects", "relations-target", parsedObjectRelationTargetClassId],
    queryFn: async () => fetchObjectsByClass(parsedObjectRelationTargetClassId ?? 0),
    enabled: parsedObjectRelationTargetClassId !== null
  });
  const objectRelationsQuery = useQuery({
    queryKey: ["object-relations", parsedSourceClassId, parsedSourceObjectId],
    queryFn: async () => fetchObjectRelations(parsedSourceClassId ?? 0, parsedSourceObjectId ?? 0),
    enabled: parsedSourceClassId !== null && parsedSourceObjectId !== null
  });

  const sourceObjects = sourceObjectsQuery.data ?? [];
  const targetObjects = targetObjectsQuery.data ?? [];
  const classRelations = Array.isArray(classRelationsQuery.data) ? classRelationsQuery.data : [];
  const objectRelations = Array.isArray(objectRelationsQuery.data) ? objectRelationsQuery.data : [];

  useEffect(() => {
    if (!sourceObjects.length) {
      setSourceObjectId("");
      return;
    }

    const exists = sourceObjects.some((item) => String(item.id) === sourceObjectId);
    if (!exists) {
      setSourceObjectId(String(sourceObjects[0].id));
    }
  }, [sourceObjectId, sourceObjects]);

  useEffect(() => {
    if (!targetObjects.length) {
      setObjectRelationTargetObjectId("");
      return;
    }

    const exists = targetObjects.some((item) => String(item.id) === objectRelationTargetObjectId);
    if (!exists) {
      setObjectRelationTargetObjectId(String(targetObjects[0].id));
    }
  }, [objectRelationTargetObjectId, targetObjects]);

  useEffect(() => {
    if (classRelationTargetClassId || !classes.length) {
      return;
    }

    const preferred = classes.find((item) => String(item.id) !== sourceClassId) ?? classes[0];
    setClassRelationTargetClassId(String(preferred.id));
  }, [classRelationTargetClassId, classes, sourceClassId]);

  useEffect(() => {
    if (objectRelationTargetClassId || !classes.length) {
      return;
    }

    const preferred = classes.find((item) => String(item.id) !== sourceClassId) ?? classes[0];
    setObjectRelationTargetClassId(String(preferred.id));
  }, [objectRelationTargetClassId, classes, sourceClassId]);

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
      await queryClient.invalidateQueries({ queryKey: ["class-relations", variables.sourceClassId] });
      setClassRelationError(null);
      setClassRelationSuccess("Class relation created.");
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
      await queryClient.invalidateQueries({
        queryKey: ["object-relations", variables.sourceClassId, variables.sourceObjectId]
      });
      setObjectRelationError(null);
      setObjectRelationSuccess("Object relation created.");
    },
    onError: (error) => {
      setObjectRelationSuccess(null);
      setObjectRelationError(error instanceof Error ? error.message : "Failed to create object relation.");
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
      parsedSourceObjectId === null ||
      parsedObjectRelationTargetClassId === null ||
      parsedObjectRelationTargetObjectId === null
    ) {
      setObjectRelationError("Select source class/object and target class/object.");
      return;
    }

    createObjectRelationMutation.mutate({
      sourceClassId: parsedSourceClassId,
      sourceObjectId: parsedSourceObjectId,
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
        Failed to load class options.{" "}
        {classesQuery.error instanceof Error ? classesQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const selectedClass = classes.find((item) => item.id === parsedSourceClassId);
  const canCreateClassRelation = parsedSourceClassId !== null && parsedClassRelationTargetClassId !== null;
  const canCreateObjectRelation =
    parsedSourceClassId !== null &&
    parsedSourceObjectId !== null &&
    parsedObjectRelationTargetClassId !== null &&
    parsedObjectRelationTargetObjectId !== null;

  return (
    <div className="stack">
      <div className="card stack">
        <h3>Relation scope</h3>
        <div className="controls-row">
          <label className="control-field">
            <span>Source class</span>
            <select value={sourceClassId} onChange={(event) => setSourceClassId(event.target.value)}>
              <option value="">Select a class...</option>
              {classes.map((hubuumClass) => (
                <option key={hubuumClass.id} value={hubuumClass.id}>
                  {hubuumClass.name} (#{hubuumClass.id})
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Source object (for object-level relations)</span>
            <select
              value={sourceObjectId}
              onChange={(event) => setSourceObjectId(event.target.value)}
              disabled={!sourceObjects.length}
            >
              {!sourceObjects.length ? <option value="">No objects available</option> : null}
              {sourceObjects.map((objectItem) => (
                <option key={objectItem.id} value={objectItem.id}>
                  {objectItem.name} (#{objectItem.id})
                </option>
              ))}
            </select>
          </label>

          <div className="muted">
            {selectedClass
              ? `Namespace ${selectedClass.namespace.name} (#${selectedClass.namespace.id})`
              : "Choose a class to inspect and create relations."}
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <form className="card stack" onSubmit={onCreateClassRelation}>
          <div className="table-header">
            <h3>Create class relation</h3>
          </div>

          <label className="control-field">
            <span>Target class</span>
            <select
              value={classRelationTargetClassId}
              onChange={(event) => setClassRelationTargetClassId(event.target.value)}
              disabled={!classes.length}
            >
              {!classes.length ? <option value="">No classes available</option> : null}
              {classes.map((hubuumClass) => (
                <option key={hubuumClass.id} value={hubuumClass.id}>
                  {hubuumClass.name} (#{hubuumClass.id})
                </option>
              ))}
            </select>
          </label>

          {classRelationError ? <div className="error-banner">{classRelationError}</div> : null}
          {classRelationSuccess ? <div className="muted">{classRelationSuccess}</div> : null}

          <div className="form-actions">
            <button type="submit" disabled={createClassRelationMutation.isPending || !canCreateClassRelation}>
              {createClassRelationMutation.isPending ? "Creating..." : "Create class relation"}
            </button>
          </div>
        </form>

        <form className="card stack" onSubmit={onCreateObjectRelation}>
          <div className="table-header">
            <h3>Create object relation</h3>
          </div>

          <label className="control-field">
            <span>Target class</span>
            <select
              value={objectRelationTargetClassId}
              onChange={(event) => setObjectRelationTargetClassId(event.target.value)}
              disabled={!classes.length}
            >
              {!classes.length ? <option value="">No classes available</option> : null}
              {classes.map((hubuumClass) => (
                <option key={hubuumClass.id} value={hubuumClass.id}>
                  {hubuumClass.name} (#{hubuumClass.id})
                </option>
              ))}
            </select>
          </label>

          <label className="control-field">
            <span>Target object</span>
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

          {objectRelationError ? <div className="error-banner">{objectRelationError}</div> : null}
          {objectRelationSuccess ? <div className="muted">{objectRelationSuccess}</div> : null}

          <div className="form-actions">
            <button type="submit" disabled={createObjectRelationMutation.isPending || !canCreateObjectRelation}>
              {createObjectRelationMutation.isPending ? "Creating..." : "Create object relation"}
            </button>
          </div>
        </form>
      </div>

      <div className="grid cols-2">
        <div className="card table-wrap">
          <div className="table-header">
            <h3>Class relations</h3>
            <span className="muted">
              {classRelationsQuery.data
                ? `${classRelations.length} loaded`
                : parsedSourceClassId
                  ? "Waiting..."
                  : "No class"}
            </span>
          </div>

          {parsedSourceClassId === null ? (
            <div className="muted">Select a class to load class-level relations.</div>
          ) : classRelationsQuery.isLoading ? (
            <div>Loading class relations...</div>
          ) : classRelationsQuery.isError ? (
            <div className="error-banner">
              Failed to load class relations.{" "}
              {classRelationsQuery.error instanceof Error ? classRelationsQuery.error.message : "Unknown error"}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>From class</th>
                  <th>To class</th>
                </tr>
              </thead>
              <tbody>
                {classRelations.map((relation) => (
                  <tr key={relation.id}>
                    <td>{relation.id}</td>
                    <td>{relation.from_hubuum_class_id}</td>
                    <td>{relation.to_hubuum_class_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card table-wrap">
          <div className="table-header">
            <h3>Object relations (reachable objects)</h3>
            <span className="muted">
              {objectRelationsQuery.data
                ? `${objectRelations.length} loaded`
                : parsedSourceObjectId !== null
                  ? "Waiting..."
                  : "No source object"}
            </span>
          </div>

          {parsedSourceClassId === null ? (
            <div className="muted">Select a class first.</div>
          ) : parsedSourceObjectId === null ? (
            <div className="muted">Select a source object to load object-level relations.</div>
          ) : objectRelationsQuery.isLoading ? (
            <div>Loading object relations...</div>
          ) : objectRelationsQuery.isError ? (
            <div className="error-banner">
              Failed to load object relations.{" "}
              {objectRelationsQuery.error instanceof Error ? objectRelationsQuery.error.message : "Unknown error"}
            </div>
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
                {objectRelations.map((relation) => (
                  <tr key={relation.id}>
                    <td>{relation.id}</td>
                    <td>{relation.name}</td>
                    <td>{relation.hubuum_class_id}</td>
                    <td>{relation.namespace_id}</td>
                    <td>{relation.path.length ? relation.path.join(" -> ") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
