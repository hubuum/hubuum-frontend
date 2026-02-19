"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";

import {
  deleteApiV1ClassesByClassId,
  getApiV1Classes,
  getApiV1Namespaces,
  postApiV1Classes
} from "@/lib/api/generated/client";
import { CreateModal } from "@/components/create-modal";
import type { HubuumClassExpanded, Namespace, NewHubuumClass } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";
import { OPEN_CREATE_EVENT, type OpenCreateEventDetail } from "@/lib/create-events";

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
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

export function ClassesTable() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [namespaceId, setNamespaceId] = useState("");
  const [validateSchema, setValidateSchema] = useState(false);
  const [jsonSchemaInput, setJsonSchemaInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableSuccess, setTableSuccess] = useState<string | null>(null);
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "class-form"],
    queryFn: fetchNamespaces
  });
  const namespaces = namespacesQuery.data ?? [];
  const canCreateClass = namespaces.length > 0;

  useEffect(() => {
    if (namespaceId || !namespaces.length) {
      return;
    }

    setNamespaceId(String(namespaces[0].id));
  }, [namespaceId, namespaces]);

  const createMutation = useMutation({
    mutationFn: async (payload: NewHubuumClass) => {
      const response = await postApiV1Classes(payload, {
        credentials: "include"
      });

      if (response.status !== 201) {
        throw new Error(getApiErrorMessage(response.data, "Failed to create class."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      setName("");
      setDescription("");
      setJsonSchemaInput("");
      setValidateSchema(false);
      setFormError(null);
      setFormSuccess("Class created.");
      setCreateModalOpen(false);
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to create class.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async (classIds: number[]) => {
      const results = await Promise.all(
        classIds.map(async (id) => {
          const response = await deleteApiV1ClassesByClassId(id, {
            credentials: "include"
          });

          if (response.status !== 204) {
            throw new Error(`#${id}: ${getApiErrorMessage(response.data, "Failed to delete class.")}`);
          }
        })
      );
      return results.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "object-explorer"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "relations-explorer"] });
      setSelectedClassIds([]);
      setTableError(null);
      setTableSuccess(`${count} class${count === 1 ? "" : "es"} deleted.`);
    },
    onError: (error) => {
      setTableSuccess(null);
      setTableError(error instanceof Error ? error.message : "Failed to delete selected classes.");
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!canCreateClass) {
      setFormError("No namespaces available. You need namespace permissions before creating a class.");
      return;
    }

    const parsedNamespaceId = Number.parseInt(namespaceId, 10);
    if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
      setFormError("Namespace is required.");
      return;
    }

    let parsedJsonSchema: unknown;
    if (jsonSchemaInput.trim()) {
      try {
        parsedJsonSchema = JSON.parse(jsonSchemaInput);
      } catch {
        setFormError("JSON schema is not valid JSON.");
        return;
      }
    }

    const payload: NewHubuumClass = {
      name: name.trim(),
      description: description.trim(),
      namespace_id: parsedNamespaceId,
      validate_schema: validateSchema
    };

    if (parsedJsonSchema !== undefined) {
      payload.json_schema = parsedJsonSchema;
    }

    createMutation.mutate(payload);
  }

  const classes = classesQuery.data ?? [];
  const allSelected = classes.length > 0 && selectedClassIds.length === classes.length;

  useEffect(() => {
    if (!selectedClassIds.length) {
      return;
    }

    const existingIds = new Set(classes.map((item) => item.id));
    setSelectedClassIds((current) => current.filter((id) => existingIds.has(id)));
  }, [classes, selectedClassIds.length]);

  useEffect(() => {
    const onOpenCreate = (event: Event) => {
      const customEvent = event as CustomEvent<OpenCreateEventDetail>;
      if (customEvent.detail?.section !== "classes") {
        return;
      }

      setCreateModalOpen(true);
    };

    window.addEventListener(OPEN_CREATE_EVENT, onOpenCreate);
    return () => window.removeEventListener(OPEN_CREATE_EVENT, onOpenCreate);
  }, []);

  if (classesQuery.isLoading) {
    return <div className="card">Loading classes...</div>;
  }

  if (classesQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load classes. {classesQuery.error instanceof Error ? classesQuery.error.message : "Unknown error"}
      </div>
    );
  }

  function toggleAllClasses(checked: boolean) {
    if (checked) {
      setSelectedClassIds(classes.map((item) => item.id));
      return;
    }

    setSelectedClassIds([]);
  }

  function toggleClassSelection(classId: number, checked: boolean) {
    setSelectedClassIds((current) => {
      if (checked) {
        return current.includes(classId) ? current : [...current, classId];
      }
      return current.filter((id) => id !== classId);
    });
  }

  function deleteSelectedClasses() {
    if (!selectedClassIds.length) {
      return;
    }

    setTableError(null);
    setTableSuccess(null);

    const confirmed = window.confirm(`Delete ${selectedClassIds.length} selected class(es)?`);
    if (!confirmed) {
      return;
    }

    deleteMutation.mutate([...selectedClassIds]);
  }

  function renderCreateClassForm() {
    return (
      <form className="stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. server"
            />
          </label>

          <label className="control-field">
            <span>Namespace</span>
            <select
              required
              value={namespaceId}
              onChange={(event) => setNamespaceId(event.target.value)}
              disabled={!canCreateClass}
            >
              {!canCreateClass ? <option value="">No namespaces available</option> : null}
              {namespaces.map((namespace) => (
                <option key={namespace.id} value={namespace.id}>
                  {namespace.name} (#{namespace.id})
                </option>
              ))}
            </select>
          </label>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Class description"
            />
          </label>

          <label className="control-field control-field--wide">
            <span>JSON schema (optional)</span>
            <textarea
              rows={5}
              value={jsonSchemaInput}
              onChange={(event) => setJsonSchemaInput(event.target.value)}
              placeholder='{"type":"object","properties":{"name":{"type":"string"}}}'
            />
          </label>

          <label className="control-check">
            <input
              type="checkbox"
              checked={validateSchema}
              onChange={(event) => setValidateSchema(event.target.checked)}
            />
            <span>Validate objects against JSON schema</span>
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions">
          <button type="submit" disabled={createMutation.isPending || !canCreateClass}>
            {createMutation.isPending ? "Creating..." : "Create class"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <CreateModal open={isCreateModalOpen} title="Create class" onClose={() => setCreateModalOpen(false)}>
        {renderCreateClassForm()}
      </CreateModal>

      <div className="card table-wrap">
        <div className="table-header">
          <h2>Classes</h2>
          <div className="table-tools">
            <span className="muted">
              {classes.length} loaded
              {selectedClassIds.length ? ` • ${selectedClassIds.length} selected` : ""}
            </span>
            <button
              type="button"
              className="danger"
              onClick={deleteSelectedClasses}
              disabled={deleteMutation.isPending || selectedClassIds.length === 0}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete selected"}
            </button>
          </div>
        </div>
        {tableError ? <div className="error-banner">{tableError}</div> : null}
        {tableSuccess ? <div className="muted">{tableSuccess}</div> : null}
        <table>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  aria-label="Select all classes"
                  checked={allSelected}
                  onChange={(event) => toggleAllClasses(event.target.checked)}
                />
              </th>
              <th>ID</th>
              <th>Name</th>
              <th>Namespace</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((item) => (
              <tr key={item.id}>
                <td className="check-col">
                  <input
                    type="checkbox"
                    aria-label={`Select class ${item.name}`}
                    checked={selectedClassIds.includes(item.id)}
                    onChange={(event) => toggleClassSelection(item.id, event.target.checked)}
                  />
                </td>
                <td>{item.id}</td>
                <td>
                  <Link href={`/classes/${item.id}`} className="row-link">
                    {item.name}
                  </Link>
                </td>
                <td>
                  {item.namespace.name} (#{item.namespace.id})
                </td>
                <td>{item.description || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
