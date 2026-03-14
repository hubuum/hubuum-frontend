"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteApiV1ClassesByClassId,
  getApiV1Classes,
  getApiV1ClassesByClassId,
  getApiV1Namespaces,
  patchApiV1ClassesByClassId
} from "@/lib/api/generated/client";
import { JsonEditor } from "@/components/json-editor";
import type {
  HubuumClassExpanded,
  HubuumClassRelation,
  Namespace,
  UpdateHubuumClass
} from "@/lib/api/generated/models";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";

type ClassDetailProps = {
  classId: number;
};

async function fetchClass(classId: number): Promise<HubuumClassExpanded> {
  const response = await getApiV1ClassesByClassId(classId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load class."));
  }

  return response.data;
}

async function fetchNamespaces(): Promise<Namespace[]> {
  const response = await getApiV1Namespaces(undefined, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespaces."));
  }

  return response.data;
}

async function fetchClasses(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes({ limit: 250 }, {
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

export function ClassDetail({ classId }: ClassDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [namespaceId, setNamespaceId] = useState("");
  const [validateSchema, setValidateSchema] = useState(false);
  const [jsonSchemaInput, setJsonSchemaInput] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const classQuery = useQuery({
    queryKey: ["class", classId],
    queryFn: async () => fetchClass(classId)
  });
  const classesQuery = useQuery({
    queryKey: ["classes", "class-detail"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "class-detail"],
    queryFn: fetchNamespaces
  });
  const classRelationsQuery = useQuery({
    queryKey: ["class-relations", "detail", classId],
    queryFn: async () => fetchClassRelations(classId)
  });

  useEffect(() => {
    if (initialized || !classQuery.data) {
      return;
    }

    setName(classQuery.data.name);
    setDescription(classQuery.data.description ?? "");
    setNamespaceId(String(classQuery.data.namespace.id));
    setValidateSchema(classQuery.data.validate_schema);
    setJsonSchemaInput(
      classQuery.data.json_schema === undefined ? "" : JSON.stringify(classQuery.data.json_schema, null, 2)
    );
    setInitialized(true);
  }, [classQuery.data, initialized]);

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateHubuumClass) => {
      const response = await patchApiV1ClassesByClassId(classId, payload, {
        credentials: "include"
      });

      if (response.status !== 200) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update class."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["class", classId] });
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "object-explorer"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "relations-explorer"] });
      setFormError(null);
      setFormSuccess("Class updated.");
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update class.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1ClassesByClassId(classId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete class."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "object-explorer"] });
      await queryClient.invalidateQueries({ queryKey: ["classes", "relations-explorer"] });
      router.push("/classes");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete class.");
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

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

    const payload: UpdateHubuumClass = {
      name: name.trim(),
      description: description.trim(),
      namespace_id: parsedNamespaceId,
      validate_schema: validateSchema
    };

    if (parsedJsonSchema !== undefined) {
      payload.json_schema = parsedJsonSchema;
    }

    updateMutation.mutate(payload);
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete class #${classId}?`)) {
      return;
    }

    deleteMutation.mutate();
  }

  if (classQuery.isLoading) {
    return <div className="card">Loading class...</div>;
  }

  if (classQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load class. {classQuery.error instanceof Error ? classQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const classData = classQuery.data;
  if (!classData) {
    return <div className="card error-banner">Class data is unavailable.</div>;
  }

  const namespaceOptions = namespacesQuery.data ?? [];
  const hasNamespaceOptions = namespaceOptions.length > 0;
  const classes = classesQuery.data ?? [];
  const classNameById = new Map<number, string>();
  for (const item of classes) {
    classNameById.set(item.id, item.name);
  }
  const directRelations = classRelationsQuery.data ?? [];
  const relatedRelations = directRelations
    .map((relation) => ({
      relation,
      relatedClassId:
        relation.from_hubuum_class_id === classId ? relation.to_hubuum_class_id : relation.from_hubuum_class_id
    }))
    .sort((left, right) => renderClassLabel(left.relatedClassId).localeCompare(renderClassLabel(right.relatedClassId)));

  function renderClassLabel(relatedClassId: number) {
    const relatedClassName = classNameById.get(relatedClassId);
    return relatedClassName ?? `Class #${relatedClassId}`;
  }

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Class</p>
        <h2>
          {classData.name} (#{classData.id})
        </h2>
      </header>

      <section className="card stack">
        {classRelationsQuery.isLoading ? <div className="muted">Loading direct class relations...</div> : null}
        {classRelationsQuery.isError ? (
          <div className="error-banner">
            Failed to load class relations.{" "}
            {classRelationsQuery.error instanceof Error ? classRelationsQuery.error.message : "Unknown error"}
          </div>
        ) : null}
        {!classRelationsQuery.isLoading && !classRelationsQuery.isError ? (
          <>
            <div className="relations-toolbar">
              <div className="relations-toolbar-meta">
                <h3 className="relations-title">Relations: {directRelations.length}</h3>
              </div>
              <Link className="link-chip" href={`/relations/classes?classId=${classId}`}>
                Open relations
              </Link>
            </div>

            {directRelations.length === 0 ? (
              <div className="empty-state">No direct relations for this class yet.</div>
            ) : (
              <p>
                {relatedRelations.map(({ relation, relatedClassId }, index) => (
                  <span key={relation.id}>
                    {index > 0 ? ", " : null}
                    <Link href={`/classes/${relatedClassId}`}>{renderClassLabel(relatedClassId)}</Link>
                  </span>
                ))}
              </p>
            )}
            {classesQuery.isError ? <div className="muted">Could not load class names automatically. Showing IDs instead.</div> : null}
          </>
        ) : null}
      </section>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <div className="control-field">
            <label htmlFor="class-detail-namespace">Namespace</label>
            {hasNamespaceOptions ? (
              <select
                id="class-detail-namespace"
                required
                value={namespaceId}
                onChange={(event) => setNamespaceId(event.target.value)}
              >
                {namespaceOptions.map((namespace) => (
                  <option key={namespace.id} value={namespace.id}>
                    {namespace.name} (#{namespace.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="class-detail-namespace"
                required
                type="number"
                min={1}
                value={namespaceId}
                onChange={(event) => setNamespaceId(event.target.value)}
                placeholder={namespacesQuery.isLoading ? "Loading namespaces..." : "Enter namespace ID"}
                disabled={namespacesQuery.isLoading}
              />
            )}
          </div>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input required value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>

          <div className="control-field control-field--wide">
            <JsonEditor
              id="class-detail-json-schema"
              label="JSON schema (optional)"
              value={jsonSchemaInput}
              onChange={setJsonSchemaInput}
              placeholder='{"type":"object","properties":{"name":{"type":"string"}}}'
              mode="schema"
              rows={8}
              helperText="Use a JSON Schema object for object validation preview and backend enforcement."
            />
          </div>

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
        {namespacesQuery.isError ? (
          <div className="muted">Could not load namespaces automatically. Manual namespace ID input is enabled.</div>
        ) : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete class"}
          </button>
        </div>
      </form>
    </section>
  );
}
