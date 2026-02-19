"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteApiV1NamespacesByNamespaceId,
  getApiV1NamespacesByNamespaceId,
  patchApiV1NamespacesByNamespaceId
} from "@/lib/api/generated/client";
import type { Namespace, UpdateNamespace } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";

type NamespaceDetailProps = {
  namespaceId: number;
};

async function fetchNamespace(namespaceId: number): Promise<Namespace> {
  const response = await getApiV1NamespacesByNamespaceId(namespaceId, {
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load namespace."));
  }

  return response.data;
}

export function NamespaceDetail({ namespaceId }: NamespaceDetailProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const namespaceQuery = useQuery({
    queryKey: ["namespace", namespaceId],
    queryFn: async () => fetchNamespace(namespaceId)
  });
  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateNamespace) => {
      const response = await patchApiV1NamespacesByNamespaceId(namespaceId, payload, {
        credentials: "include"
      });

      if (response.status !== 202) {
        throw new Error(getApiErrorMessage(response.data, "Failed to update namespace."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespace", namespaceId] });
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      setFormError(null);
      setFormSuccess("Namespace updated.");
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to update namespace.");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await deleteApiV1NamespacesByNamespaceId(namespaceId, {
        credentials: "include"
      });

      if (response.status !== 204) {
        throw new Error(getApiErrorMessage(response.data, "Failed to delete namespace."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["namespaces"] });
      router.push("/namespaces");
      router.refresh();
    },
    onError: (error) => {
      setFormSuccess(null);
      setFormError(error instanceof Error ? error.message : "Failed to delete namespace.");
    }
  });

  useEffect(() => {
    if (initialized || !namespaceQuery.data) {
      return;
    }

    setName(namespaceQuery.data.name);
    setDescription(namespaceQuery.data.description ?? "");
    setInitialized(true);
  }, [initialized, namespaceQuery.data]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    updateMutation.mutate({
      name: name.trim(),
      description: description.trim()
    });
  }

  function onDelete() {
    setFormError(null);
    setFormSuccess(null);
    if (!window.confirm(`Delete namespace #${namespaceId}?`)) {
      return;
    }

    deleteMutation.mutate();
  }

  if (namespaceQuery.isLoading) {
    return <div className="card">Loading namespace...</div>;
  }

  if (namespaceQuery.isError) {
    return (
      <div className="card error-banner">
        Failed to load namespace. {namespaceQuery.error instanceof Error ? namespaceQuery.error.message : "Unknown error"}
      </div>
    );
  }

  const namespaceData = namespaceQuery.data;
  if (!namespaceData) {
    return <div className="card error-banner">Namespace data is unavailable.</div>;
  }

  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Namespace</p>
        <h2>
          {namespaceData.name} (#{namespaceData.id})
        </h2>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <div className="form-grid">
          <label className="control-field">
            <span>Name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="control-field control-field--wide">
            <span>Description</span>
            <input required value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>

        {formError ? <div className="error-banner">{formError}</div> : null}
        {formSuccess ? <div className="muted">{formSuccess}</div> : null}

        <div className="form-actions form-actions--spread">
          <button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="danger" onClick={onDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Deleting..." : "Delete namespace"}
          </button>
        </div>
      </form>
    </section>
  );
}
