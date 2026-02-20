"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { deleteApiV1ClassesByClassIdByObjectId, getApiV1Classes, getApiV1Namespaces } from "@/lib/api/generated/client";
import { CreateModal } from "@/components/create-modal";
import type { HubuumClassExpanded, HubuumObject, Namespace, NewHubuumObject } from "@/lib/api/generated/models";
import { OPEN_CREATE_EVENT, type OpenCreateEventDetail } from "@/lib/create-events";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { readJsonFileAsPrettyText } from "@/lib/json-file";

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

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

function stringifyData(data: unknown): string {
  if (data === null || data === undefined) {
    return "-";
  }

  if (typeof data === "string") {
    return data.length > 96 ? `${data.slice(0, 96)}...` : data;
  }

  try {
    const json = JSON.stringify(data);
    return json.length > 96 ? `${json.slice(0, 96)}...` : json;
  } catch {
    return "[unserializable]";
  }
}

export function ObjectsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const classesQuery = useQuery({
    queryKey: ["classes", "object-explorer"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "object-form"],
    queryFn: fetchNamespaces
  });
  const selectedClassId = searchParams.get("classId") ?? "";
  const [namespaceId, setNamespaceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataInput, setDataInput] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<number[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    if (selectedClassId || !classesQuery.data?.length) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("classId", String(classesQuery.data[0].id));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [selectedClassId, classesQuery.data, pathname, router, searchParams]);

  const parsedClassId = useMemo(() => {
    const value = Number.parseInt(selectedClassId, 10);
    return Number.isFinite(value) ? value : null;
  }, [selectedClassId]);
  const classes = classesQuery.data ?? [];
  const namespaces = namespacesQuery.data ?? [];
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
  const selectedClass = classes.find((item) => item.id === parsedClassId);

  const objectsQuery = useQuery({
    queryKey: ["objects", parsedClassId],
    queryFn: async () => fetchObjectsByClass(parsedClassId ?? 0),
    enabled: parsedClassId !== null
  });
  const createMutation = useMutation({
    mutationFn: async (payload: NewHubuumObject) => {
      const response = await fetch(`/api/classes/${payload.hubuum_class_id}/objects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      const responsePayload = await parseJsonPayload(response);

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(responsePayload, "Failed to create object."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["objects", parsedClassId] });
      setName("");
      setDescription("");
      setDataInput("{}");
      setFormError(null);
      setFormSuccess("Object created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to create object.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async (payload: { classId: number; objectIds: number[] }) => {
      const results = await Promise.all(
        payload.objectIds.map(async (objectId) => {
          const response = await deleteApiV1ClassesByClassIdByObjectId(payload.classId, objectId, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(`#${objectId}: ${getApiErrorMessage(response.data, "Failed to delete object.")}`);
          }
        })
      );
      return { classId: payload.classId, count: results.length };
    },
    onSuccess: async ({ classId: deletedClassId, count }) => {
      await queryClient.invalidateQueries({ queryKey: ["objects", deletedClassId] });
      setSelectedObjectIds([]);
      setTableError(null);
      setTableSuccess(`${count} object${count === 1 ? "" : "s"} deleted.`);
    },
    onError: (error) => {
      setTableSuccess(null);
      setTableError(error instanceof Error ? error.message : "Failed to delete selected objects.");
    }
  });

  useEffect(() => {
    if (!namespaces.length) {
      setNamespaceId("");
      return;
    }

    const hasSelectedNamespace = namespaces.some((namespace) => String(namespace.id) === namespaceId);
    if (hasSelectedNamespace) {
      return;
    }

    if (selectedClass) {
      const classNamespace = namespaces.find((namespace) => namespace.id === selectedClass.namespace.id);
      if (classNamespace) {
        setNamespaceId(String(classNamespace.id));
        return;
      }
    }

    setNamespaceId(String(namespaces[0].id));
  }, [namespaceId, namespaces, selectedClass]);

  useEffect(() => {
    if (!selectedClassId) {
      setSelectedObjectIds([]);
      setTableError(null);
      setTableSuccess(null);
      return;
    }

    setSelectedObjectIds([]);
    setTableError(null);
    setTableSuccess(null);
  }, [selectedClassId]);

  const objects = Array.isArray(objectsQuery.data) ? objectsQuery.data : [];
  const allSelected = objects.length > 0 && selectedObjectIds.length === objects.length;

  useEffect(() => {
    if (!selectedObjectIds.length) {
      return;
    }

    const existingIds = new Set(objects.map((objectItem) => objectItem.id));
    setSelectedObjectIds((current) => current.filter((objectId) => existingIds.has(objectId)));
  }, [objects, selectedObjectIds.length]);

  useEffect(() => {
    const onOpenCreate = (event: Event) => {
      const customEvent = event as CustomEvent<OpenCreateEventDetail>;
      if (customEvent.detail?.section !== "objects") {
        return;
      }

      setCreateModalOpen(true);
    };

    window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
    return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!selectedClass || parsedClassId === null) {
      setFormError("Select a class before creating an object.");
      return;
    }

    const parsedNamespaceId = Number.parseInt(namespaceId, 10);
    if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
      setFormError("Namespace is required.");
      return;
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(dataInput);
    } catch {
      setFormError("Object data must be valid JSON.");
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      data: parsedData,
      hubuum_class_id: selectedClass.id,
      namespace_id: parsedNamespaceId
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

  function toggleAllObjects(checked: boolean) {
    if (checked) {
      setSelectedObjectIds(objects.map((objectItem) => objectItem.id));
      return;
    }

    setSelectedObjectIds([]);
  }

  function toggleObject(objectId: number, checked: boolean) {
    setSelectedObjectIds((current) => {
      if (checked) {
        return current.includes(objectId) ? current : [...current, objectId];
      }
      return current.filter((id) => id !== objectId);
    });
  }

  function deleteSelectedObjects() {
    if (parsedClassId === null || !selectedObjectIds.length) {
      return;
    }

    setTableError(null);
    setTableSuccess(null);

    const confirmed = window.confirm(`Delete ${selectedObjectIds.length} selected object(s)?`);
    if (!confirmed) {
      return;
    }

    deleteMutation.mutate({
      classId: parsedClassId,
      objectIds: [...selectedObjectIds]
    });
  }

  function renderNamespace(value: number): string {
    const namespaceName = namespaceNameById.get(value);
    return namespaceName ? `${namespaceName} (#${value})` : `#${value}`;
  }

  function renderCreateObjectForm() {
    async function onDataFileChange(event: FormEvent<HTMLInputElement>) {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";

      if (!file) {
        return;
      }

      try {
        const jsonText = await readJsonFileAsPrettyText(file);
        setDataInput(jsonText);
        setFormError(null);
      } catch (error) {
        setFormSuccess(null);
        setFormError(error instanceof Error ? error.message : "Failed to read object data file.");
      }
    }

    return (
      <form className="stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. srv-web-01"
              disabled={!selectedClass}
            />
          </label>

          <div className="control-field">
            <span>Namespace</span>
            {namespaces.length > 0 ? (
              <select
                required
                value={namespaceId}
                onChange={(event) => setNamespaceId(event.target.value)}
                disabled={!selectedClass}
              >
                {namespaces.map((namespace) => (
                  <option key={namespace.id} value={namespace.id}>
                    {namespace.name} (#{namespace.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                type="number"
                min={1}
                value={namespaceId}
                onChange={(event) => setNamespaceId(event.target.value)}
                placeholder={namespacesQuery.isLoading ? "Loading namespaces..." : "Enter namespace id"}
                disabled={!selectedClass || namespacesQuery.isLoading}
              />
            )}
          </div>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Object description"
              disabled={!selectedClass}
            />
          </label>

          <label className="control-field control-field--wide">
            <span>Data (JSON)</span>
            <textarea
              rows={6}
              value={dataInput}
              onChange={(event) => setDataInput(event.target.value)}
              placeholder='{"hostname":"srv-web-01","env":"prod"}'
              disabled={!selectedClass}
            />
            <input
              type="file"
              accept=".json,application/json"
              onChange={onDataFileChange}
              disabled={!selectedClass}
            />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {namespacesQuery.isError ? (
          <div className="muted">Could not load namespaces automatically. Falling back to manual namespace ID entry.</div>
        ) : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createMutation.isPending || !selectedClass}>
            {createMutation.isPending ? "Creating..." : "Create object"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <CreateModal open={isCreateModalOpen} title="Create object" onClose={() => setCreateModalOpen(false)}>
        {renderCreateObjectForm()}
      </CreateModal>

      <div className="card table-wrap">
        <div className="table-header">
          <h3>Objects</h3>
          <div className="table-tools">
            <span className="muted">
              {objectsQuery.data ? `${objects.length} loaded` : parsedClassId ? "Waiting..." : "No class"}
              {selectedObjectIds.length ? ` • ${selectedObjectIds.length} selected` : ""}
            </span>
            <button
              type="button"
              className="danger"
              onClick={deleteSelectedObjects}
              disabled={deleteMutation.isPending || selectedObjectIds.length === 0 || parsedClassId === null}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete selected"}
            </button>
          </div>
        </div>
        {tableError ? <div className="error-banner">{tableError}</div> : null}
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}

        {parsedClassId === null ? (
          <div className="muted">Select a class to load its objects.</div>
        ) : objectsQuery.isLoading ? (
          <div>Loading objects...</div>
        ) : objectsQuery.isError ? (
          <div className="error-banner">
            Failed to load objects. {objectsQuery.error instanceof Error ? objectsQuery.error.message : "Unknown error"}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select all objects"
                    checked={allSelected}
                    onChange={(event) => toggleAllObjects(event.target.checked)}
                  />
                </th>
                <th>ID</th>
                <th>Name</th>
                <th>Namespace</th>
                <th>Description</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((objectItem) => (
                <tr key={objectItem.id}>
                  <td className="check-col">
                    <input
                      type="checkbox"
                      aria-label={`Select object ${objectItem.name}`}
                      checked={selectedObjectIds.includes(objectItem.id)}
                      onChange={(event) => toggleObject(objectItem.id, event.target.checked)}
                    />
                  </td>
                  <td>{objectItem.id}</td>
                  <td>
                    <Link href={`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`} className="row-link">
                      {objectItem.name}
                    </Link>
                  </td>
                  <td>{renderNamespace(objectItem.namespace_id)}</td>
                  <td>{objectItem.description || "-"}</td>
                  <td>{stringifyData(objectItem.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
