"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteApiV1ClassesByClassIdByObjectId,
  getApiV1Classes,
  getApiV1ClassesByClassIdByObjectId,
  getApiV1Namespaces,
  patchApiV1ClassesByClassIdByObjectId
} from "@/lib/api/generated/client";
import type { HubuumClassExpanded, HubuumObject, Namespace, UpdateHubuumObject } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";
import { readJsonFileAsPrettyText } from "@/lib/json-file";

type ObjectDetailProps = {
  classId: number;
  objectId: number;
};

async function fetchObject(classId: number, objectId: number): Promise<HubuumObject> {
  const response = await getApiV1ClassesByClassIdByObjectId(classId, objectId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load object."));
  }

  return response.data;
}

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

export function ObjectDetail({ classId, objectId }: ObjectDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataInput, setDataInput] = useState("{}");
  const [namespaceId, setNamespaceId] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const objectQuery = useQuery({
    queryKey: ["object", classId, objectId],
    queryFn: async () => fetchObject(classId, objectId)
  });
  const classesQuery = useQuery({
    queryKey: ["classes", "object-detail"],
    queryFn: fetchClasses
  });
  const namespacesQuery = useQuery({
    queryKey: ["namespaces", "object-detail"],
    queryFn: fetchNamespaces
  });

  useEffect(() => {
    if (initialized || !objectQuery.data) {
      return;
    }

    setName(objectQuery.data.name);
    setDescription(objectQuery.data.description ?? "");
    setDataInput(JSON.stringify(objectQuery.data.data, null, 2));
    setNamespaceId(String(objectQuery.data.namespace_id));
    setInitialized(true);
  }, [initialized, objectQuery.data]);
  const namespaces = namespacesQuery.data ?? [];

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateHubuumObject) => {
      const response = await patchApiV1ClassesByClassIdByObjectId(classId, objectId, payload, {
        credentials: "include"
      });

      if (response.status !== 200) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update object."));
      }

      return response.data;
    },
    onSuccess: async (updatedObject) => {
      const targetClassId = updatedObject.hubuum_class_id;
      await queryClient.invalidateQueries({ queryKey: ["object", classId, objectId] });
      await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
      await queryClient.invalidateQueries({ queryKey: ["objects", targetClassId] });
      setFormError(null);
      setFormSuccess("Object updated.");

      if (targetClassId !== classId) {
        router.replace(`/objects/${targetClassId}/${objectId}`);
        router.refresh();
      }
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update object.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1ClassesByClassIdByObjectId(classId, objectId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete object."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["objects", classId] });
      router.push("/objects");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete object.");
    }
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(dataInput);
    } catch {
      setFormError("Object data must be valid JSON.");
      return;
    }

    const parsedNamespaceId = Number.parseInt(namespaceId, 10);
    if (!Number.isFinite(parsedNamespaceId) || parsedNamespaceId < 1) {
      setFormError("Namespace ID is required.");
      return;
    }

    const payload: UpdateHubuumObject = {
      name: name.trim(),
      description: description.trim(),
      data: parsedData,
      hubuum_class_id: classId,
      namespace_id: parsedNamespaceId
    };

    updateMutation.mutate(payload);
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete object #${objectId}?`)) {
      return;
    }

    deleteMutation.mutate();
  }

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

  if (objectQuery.isLoading) {
    return <div className="card">Loading object...</div>;
  }

  if (objectQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load object. {objectQuery.error instanceof Error ? objectQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const objectData = objectQuery.data;
  if (!objectData) {
    return <div className="card error-banner">Object data is unavailable.</div>;
  }

  const className = (classesQuery.data ?? []).find((item) => item.id === objectData.hubuum_class_id)?.name ?? null;
  const hasNamespaceOptions = namespaces.length > 0;
  const hasNamespaceSelection = namespaces.some((namespace) => String(namespace.id) === namespaceId);

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Object</p>
        <h2>
          {objectData.name} (#{objectData.id})
        </h2>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="control-field">
            <span>Class</span>
            <input readOnly value={`${className ?? "Class"} (#${objectData.hubuum_class_id})`} />
          </label>

          <div className="control-field">
            <label htmlFor="object-detail-namespace">Namespace</label>
            {hasNamespaceOptions ? (
              <select
                id="object-detail-namespace"
                required
                value={hasNamespaceSelection ? namespaceId : ""}
                onChange={(event) => setNamespaceId(event.target.value)}
              >
                {!hasNamespaceSelection ? <option value="">Select a namespace...</option> : null}
                {namespaces.map((namespace) => (
                  <option key={namespace.id} value={namespace.id}>
                    {namespace.name} (#{namespace.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="object-detail-namespace"
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

          <label className="control-field control-field--wide">
            <span>Data (JSON)</span>
            <textarea
              rows={8}
              value={dataInput}
              onChange={(event) => setDataInput(event.target.value)}
              placeholder='{"hostname":"srv-web-01","env":"prod"}'
            />
            <input type="file" accept=".json,application/json" onChange={onDataFileChange} />
          </label>
        </div>

        <div className="muted">Class is fixed for existing objects.</div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {classesQuery.isError ? <div className="muted">Could not load class names. Showing class ID only.</div> : null}
        {namespacesQuery.isError ? (
          <div className="muted">Could not load namespaces automatically. Manual namespace ID entry is enabled.</div>
        ) : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete object"}
          </button>
        </div>
      </form>
    </section>
  );
}
