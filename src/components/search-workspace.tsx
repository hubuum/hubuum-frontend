"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { getApiV1ClassesByClassId } from "@/lib/api/generated/client";
import {
  createEmptyUnifiedSearchNext,
  createEmptyUnifiedSearchResults,
  DEFAULT_UNIFIED_SEARCH_LIMIT,
  fetchUnifiedSearch,
  fetchUnifiedSearchKindPage,
  type UnifiedSearchGroup,
  type UnifiedSearchKind,
  type UnifiedSearchNext,
  type UnifiedSearchResults
} from "@/lib/api/search";
import { normalizeSearchTerm } from "@/lib/resource-search";

type SearchGroupOption = {
  group: UnifiedSearchGroup;
  kind: UnifiedSearchKind;
  label: string;
};

type ClassContext = {
  className: string;
  namespaceId: number;
  namespaceName: string;
};

type SearchWorkspaceState = {
  key: string;
  appendedResults: UnifiedSearchResults;
  nextOverrides: Partial<UnifiedSearchNext>;
  loadingGroup: UnifiedSearchGroup | null;
  loadMoreErrors: Partial<Record<UnifiedSearchGroup, string>>;
};

const SEARCH_GROUPS: SearchGroupOption[] = [
  {
    group: "namespaces",
    kind: "namespace",
    label: "Namespaces"
  },
  {
    group: "classes",
    kind: "class",
    label: "Classes"
  },
  {
    group: "objects",
    kind: "object",
    label: "Objects"
  }
];

function formatTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function stringifyDataPreview(data: unknown): string {
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

function getSearchKindsFromParams(searchParams: URLSearchParams): UnifiedSearchGroup[] {
  if (!searchParams.has("kinds")) {
    return SEARCH_GROUPS.map((item) => item.group);
  }

  const rawValue = searchParams.get("kinds") ?? "";
  if (!rawValue.trim()) {
    return [];
  }

  const selectedKinds = new Set(
    rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  return SEARCH_GROUPS.filter((item) => selectedKinds.has(item.kind)).map((item) => item.group);
}

function getKindsParam(selectedGroups: UnifiedSearchGroup[]): string | null {
  if (selectedGroups.length === SEARCH_GROUPS.length) {
    return null;
  }

  return SEARCH_GROUPS.filter((item) => selectedGroups.includes(item.group))
    .map((item) => item.kind)
    .join(",");
}

function groupFromKind(kind: UnifiedSearchKind): UnifiedSearchGroup {
  const match = SEARCH_GROUPS.find((item) => item.kind === kind);
  return match ? match.group : "objects";
}

function mergeResults(baseResults: UnifiedSearchResults, appendedResults: UnifiedSearchResults): UnifiedSearchResults {
  return {
    namespaces: [...baseResults.namespaces, ...appendedResults.namespaces],
    classes: [...baseResults.classes, ...appendedResults.classes],
    objects: [...baseResults.objects, ...appendedResults.objects]
  };
}

async function fetchClassContextByIds(classIds: number[]): Promise<Record<number, ClassContext>> {
  const settled = await Promise.allSettled(
    classIds.map(async (classId) => {
      const response = await getApiV1ClassesByClassId(classId, {
        credentials: "include"
      });

      if (response.status !== 200) {
        return null;
      }

      return {
        classId,
        context: {
          className: response.data.name,
          namespaceId: response.data.namespace.id,
          namespaceName: response.data.namespace.name
        }
      };
    })
  );

  const contextById: Record<number, ClassContext> = {};
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) {
      continue;
    }

    contextById[result.value.classId] = result.value.context;
  }

  return contextById;
}

export function SearchWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = normalizeSearchTerm(searchParams.get("q"));
  const selectedGroups = useMemo(
    () => getSearchKindsFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const searchClassSchema = searchParams.get("search_class_schema") === "true";
  const searchObjectData = searchParams.get("search_object_data") === "true";
  const kindsParam = getKindsParam(selectedGroups);
  const searchStateKey = `${searchQuery}::${kindsParam ?? "all"}::${searchClassSchema ? "schema" : "plain"}::${
    searchObjectData ? "object-data" : "object-name"
  }`;
  const [searchWorkspaceState, setSearchWorkspaceState] = useState<SearchWorkspaceState>({
    key: "",
    appendedResults: createEmptyUnifiedSearchResults(),
    nextOverrides: {},
    loadingGroup: null,
    loadMoreErrors: {}
  });
  const activeSearchState =
    searchWorkspaceState.key === searchStateKey
      ? searchWorkspaceState
      : {
          key: searchStateKey,
          appendedResults: createEmptyUnifiedSearchResults(),
          nextOverrides: {},
          loadingGroup: null,
          loadMoreErrors: {}
        };

  const searchQueryResult = useQuery({
    queryKey: ["unified-search", searchQuery, kindsParam ?? "all", searchClassSchema, searchObjectData],
    queryFn: async () =>
      fetchUnifiedSearch({
        q: searchQuery,
        kinds: SEARCH_GROUPS.filter((item) => selectedGroups.includes(item.group)).map((item) => item.kind),
        limitPerKind: DEFAULT_UNIFIED_SEARCH_LIMIT,
        searchClassSchema,
        searchObjectData
      }),
    enabled: searchQuery.length > 0 && selectedGroups.length > 0
  });

  const mergedResults = useMemo(() => {
    const baseResults = searchQueryResult.data?.results ?? createEmptyUnifiedSearchResults();
    return mergeResults(baseResults, activeSearchState.appendedResults);
  }, [activeSearchState.appendedResults, searchQueryResult.data?.results]);

  const mergedNext = useMemo<UnifiedSearchNext>(() => {
    const baseNext = searchQueryResult.data?.next ?? createEmptyUnifiedSearchNext();
    return {
      namespaces:
        activeSearchState.nextOverrides.namespaces !== undefined
          ? activeSearchState.nextOverrides.namespaces
          : (baseNext.namespaces ?? null),
      classes:
        activeSearchState.nextOverrides.classes !== undefined
          ? activeSearchState.nextOverrides.classes
          : (baseNext.classes ?? null),
      objects:
        activeSearchState.nextOverrides.objects !== undefined
          ? activeSearchState.nextOverrides.objects
          : (baseNext.objects ?? null)
    };
  }, [activeSearchState.nextOverrides, searchQueryResult.data?.next]);

  const searchClassContext = useMemo(() => {
    const contextById: Record<number, ClassContext> = {};

    for (const classItem of mergedResults.classes) {
      contextById[classItem.id] = {
        className: classItem.name,
        namespaceId: classItem.namespace.id,
        namespaceName: classItem.namespace.name
      };
    }

    return contextById;
  }, [mergedResults.classes]);

  const unresolvedObjectClassIds = useMemo(() => {
    const missingIds = new Set<number>();

    for (const objectItem of mergedResults.objects) {
      if (!searchClassContext[objectItem.hubuum_class_id]) {
        missingIds.add(objectItem.hubuum_class_id);
      }
    }

    return Array.from(missingIds).sort((left, right) => left - right);
  }, [mergedResults.objects, searchClassContext]);

  const classContextQuery = useQuery({
    queryKey: ["unified-search-class-context", unresolvedObjectClassIds],
    queryFn: () => fetchClassContextByIds(unresolvedObjectClassIds),
    enabled: unresolvedObjectClassIds.length > 0
  });

  const classContextById = useMemo(() => {
    return {
      ...classContextQuery.data,
      ...searchClassContext
    };
  }, [classContextQuery.data, searchClassContext]);

  const totalLoadedResults =
    mergedResults.namespaces.length + mergedResults.classes.length + mergedResults.objects.length;

  function updateSearchRoute(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutator(params);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function toggleGroup(group: UnifiedSearchGroup, checked: boolean) {
    const nextGroups = checked
      ? [...selectedGroups, group]
      : selectedGroups.filter((currentGroup) => currentGroup !== group);
    const uniqueGroups = SEARCH_GROUPS.filter((item) => nextGroups.includes(item.group)).map((item) => item.group);

    updateSearchRoute((params) => {
      const nextKinds = getKindsParam(uniqueGroups);
      if (nextKinds === null) {
        params.delete("kinds");
        return;
      }

      params.set("kinds", nextKinds);
    });
  }

  function setAdvancedFlag(key: "search_class_schema" | "search_object_data", checked: boolean) {
    updateSearchRoute((params) => {
      if (checked) {
        params.set(key, "true");
        return;
      }

      params.delete(key);
    });
  }

  async function loadMore(group: UnifiedSearchGroup) {
    if (!searchQuery) {
      return;
    }

    const nextCursor = mergedNext[group];
    if (!nextCursor) {
      return;
    }

    const kind = SEARCH_GROUPS.find((item) => item.group === group)?.kind;
    if (!kind) {
      return;
    }

    setSearchWorkspaceState((current) => {
      const baseState =
        current.key === searchStateKey
          ? current
          : {
              key: searchStateKey,
              appendedResults: createEmptyUnifiedSearchResults(),
              nextOverrides: {},
              loadingGroup: null,
              loadMoreErrors: {}
            };
      const nextState = { ...baseState.loadMoreErrors };
      delete nextState[group];
      return {
        ...baseState,
        key: searchStateKey,
        loadingGroup: group,
        loadMoreErrors: nextState
      };
    });

    try {
      const nextPage = await fetchUnifiedSearchKindPage({
        q: searchQuery,
        kind,
        limitPerKind: DEFAULT_UNIFIED_SEARCH_LIMIT,
        cursorNamespaces: group === "namespaces" ? nextCursor : null,
        cursorClasses: group === "classes" ? nextCursor : null,
        cursorObjects: group === "objects" ? nextCursor : null,
        searchClassSchema,
        searchObjectData
      });

      setSearchWorkspaceState((current) => {
        const baseState =
          current.key === searchStateKey
            ? current
            : {
                key: searchStateKey,
                appendedResults: createEmptyUnifiedSearchResults(),
                nextOverrides: {},
                loadingGroup: null,
                loadMoreErrors: {}
              };
        const nextOverrides = {
          ...baseState.nextOverrides,
          [groupFromKind(nextPage.kind)]: nextPage.next
        };

        switch (nextPage.kind) {
          case "namespace":
            return {
              ...baseState,
              key: searchStateKey,
              loadingGroup: null,
              nextOverrides,
              appendedResults: {
                ...baseState.appendedResults,
                namespaces: [...baseState.appendedResults.namespaces, ...nextPage.results]
              }
            };
          case "class":
            return {
              ...baseState,
              key: searchStateKey,
              loadingGroup: null,
              nextOverrides,
              appendedResults: {
                ...baseState.appendedResults,
                classes: [...baseState.appendedResults.classes, ...nextPage.results]
              }
            };
          case "object":
            return {
              ...baseState,
              key: searchStateKey,
              loadingGroup: null,
              nextOverrides,
              appendedResults: {
                ...baseState.appendedResults,
                objects: [...baseState.appendedResults.objects, ...nextPage.results]
              }
            };
        }
      });
    } catch (error) {
      setSearchWorkspaceState((current) => {
        const baseState =
          current.key === searchStateKey
            ? current
            : {
                key: searchStateKey,
                appendedResults: createEmptyUnifiedSearchResults(),
                nextOverrides: {},
                loadingGroup: null,
                loadMoreErrors: {}
              };

        return {
          ...baseState,
          key: searchStateKey,
          loadingGroup: null,
          loadMoreErrors: {
            ...baseState.loadMoreErrors,
            [group]: error instanceof Error ? error.message : "Failed to load more results."
          }
        };
      });
    } finally {
      setSearchWorkspaceState((current) =>
        current.key === searchStateKey
          ? {
              ...current,
              loadingGroup: null
            }
          : current
      );
    }
  }

  function renderNamespaceTable() {
    return (
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Description</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {mergedResults.namespaces.map((namespace) => (
            <tr key={`namespace-${namespace.id}`}>
              <td>#{namespace.id}</td>
              <td>
                <Link href={`/namespaces/${namespace.id}`} className="row-link">
                  {namespace.name}
                </Link>
              </td>
              <td>{namespace.description || "-"}</td>
              <td>{formatTimestamp(namespace.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderClassesTable() {
    return (
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Namespace</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {mergedResults.classes.map((classItem) => (
            <tr key={`class-${classItem.id}`}>
              <td>#{classItem.id}</td>
              <td>
                <Link href={`/classes/${classItem.id}`} className="row-link">
                  {classItem.name}
                </Link>
              </td>
              <td>
                {classItem.namespace.name} (#{classItem.namespace.id})
              </td>
              <td>{classItem.description || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderObjectsTable() {
    return (
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Class</th>
            <th>Namespace</th>
            <th>Description</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {mergedResults.objects.map((objectItem) => {
            const classContext = classContextById[objectItem.hubuum_class_id];
            const classLabel = classContext?.className ?? `Class #${objectItem.hubuum_class_id}`;
            const namespaceId = classContext?.namespaceId ?? objectItem.namespace_id;
            const namespaceLabel = classContext?.namespaceName ?? `Namespace #${objectItem.namespace_id}`;

            return (
              <tr key={`object-${objectItem.hubuum_class_id}-${objectItem.id}`}>
                <td>#{objectItem.id}</td>
                <td>
                  <Link href={`/objects/${objectItem.hubuum_class_id}/${objectItem.id}`} className="row-link">
                    {objectItem.name}
                  </Link>
                </td>
                <td>
                  {classLabel} (#{objectItem.hubuum_class_id})
                </td>
                <td>
                  {namespaceLabel} (#{namespaceId})
                </td>
                <td>{objectItem.description || "-"}</td>
                <td className="search-data-cell">{stringifyDataPreview(objectItem.data)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function renderSection(group: UnifiedSearchGroup) {
    const option = SEARCH_GROUPS.find((item) => item.group === group);
    if (!option) {
      return null;
    }

    const items =
      group === "namespaces"
        ? mergedResults.namespaces
        : group === "classes"
          ? mergedResults.classes
          : mergedResults.objects;
    const nextCursor = mergedNext[group];
    const isLoadingMore = activeSearchState.loadingGroup === group;

    return (
      <section key={group} className="card search-section">
        <div className="search-section-header">
          <div className="search-section-heading">
            <h2>
              {option.label}: {items.length}
            </h2>
            {nextCursor ? (
              <button
                type="button"
                className="ghost search-load-more search-load-more--inline"
                onClick={() => loadMore(group)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </div>
        </div>

        {activeSearchState.loadMoreErrors[group] ? (
          <div className="error-banner">{activeSearchState.loadMoreErrors[group]}</div>
        ) : null}
        {group === "objects" && classContextQuery.isFetching ? (
          <div className="muted search-inline-note">Resolving class context for object results...</div>
        ) : null}

        {items.length > 0 ? (
          <div className="table-wrap search-table-wrap">
            {group === "namespaces"
              ? renderNamespaceTable()
              : group === "classes"
                ? renderClassesTable()
                : renderObjectsTable()}
          </div>
        ) : null}
      </section>
    );
  }

  function renderControls() {
    return (
      <div className="card search-toolbar">
        <div className="search-toolbar-row">
          <span className="search-toolbar-title">Search scope</span>
          <div className="search-toggle-grid search-toggle-grid--inline">
            {SEARCH_GROUPS.map((option) => (
              <label key={option.group} className="search-toggle">
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(option.group)}
                  onChange={(event) => toggleGroup(option.group, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
            <label className="search-toggle">
              <input
                type="checkbox"
                checked={searchClassSchema}
                onChange={(event) => setAdvancedFlag("search_class_schema", event.target.checked)}
              />
              <span>Class schema</span>
            </label>
            <label className="search-toggle">
              <input
                type="checkbox"
                checked={searchObjectData}
                onChange={(event) => setAdvancedFlag("search_object_data", event.target.checked)}
              />
              <span>Object JSON</span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  if (!searchQuery) {
    return (
      <section className="stack search-page">
        <header className="stack search-page-header">
          <p className="eyebrow">Search</p>
          <h2>Unified search</h2>
          <p className="muted search-summary">Use the top bar to search across namespaces, classes, and objects.</p>
        </header>

        {renderControls()}

        <div className="card empty-state search-empty-state search-empty-state--hero">
          Enter a search term in the top bar to start a unified search.
        </div>
      </section>
    );
  }

  return (
    <section className="stack search-page">
      <header className="stack search-page-header">
        <p className="eyebrow">Search</p>
        <h2>Results for "{searchQuery}"</h2>
        <p className="muted search-summary">
          {totalLoadedResults} loaded across {selectedGroups.length} kind{selectedGroups.length === 1 ? "" : "s"}.
          Up to {DEFAULT_UNIFIED_SEARCH_LIMIT} results are requested per kind on each fetch.
        </p>
      </header>

      {renderControls()}

      {selectedGroups.length === 0 ? (
        <div className="card empty-state search-empty-state">Select at least one result kind to run a unified search.</div>
      ) : searchQueryResult.isLoading ? (
        <div className="card search-status-card">Searching across Hubuum...</div>
      ) : searchQueryResult.isError ? (
        <div className="card error-banner search-status-card">
          Failed to load unified search results.{" "}
          {searchQueryResult.error instanceof Error ? searchQueryResult.error.message : "Unknown error"}
        </div>
      ) : (
        <div className="stack">
          {SEARCH_GROUPS.filter((option) => selectedGroups.includes(option.group)).map((option) => renderSection(option.group))}
        </div>
      )}
    </section>
  );
}
