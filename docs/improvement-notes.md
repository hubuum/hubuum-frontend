# Improvement Notes

These are the improvement areas identified from the current frontend and `openapi.json`.
We will work through them in parts.

## 1. JSON editing UX

Priority: first

- Replace raw JSON textareas with a reusable editor.
- Add JSON formatting actions.
- Add schema-aware validation preview for object payloads when the selected class has a schema.
- Add schema summary and better syntax error localization for class schema editing.

## 2. Permissions and IAM coverage

- Add UI for class permissions.
- Add UI for per-user namespace permissions.
- Add namespace access checks and effective access views.
- Add user token/session visibility and management.
- Add auth/session validation tooling where useful.

## 3. List scalability

- Add pagination, search, sort, and filters for large lists.
- Reduce client-side loading of full collections where targeted backend queries are possible.
- Revisit N+1 fetching patterns in admin and relations views.

## 4. Relations UX

- Improve class and object relation visualization.
- Add better path exploration and target filtering.
- Expose more of the transitive-relation capabilities from the API contract.

## 5. Contract mismatches and backend coordination

- Align group update behavior with the documented `UpdateGroup` contract.
- Review endpoints where the UI has to compensate for undocumented or inconsistent behavior.
- Keep generated client usage aligned with the actual backend responses.

## 6. Destructive flows and interaction polish

- Replace browser confirm dialogs with proper confirmation modals.
- Add better empty states, loading states, and mutation feedback.
- Add dirty-state handling where form edits can be lost.

## 7. Operational dashboard

- Expand statistics beyond basic counts and DB metrics.
- Add recent changes, health indicators, and operational guidance.

## 8. Test coverage

- Add integration coverage for auth, proxying, permissions, and core mutation flows.
- Add focused component coverage around complex editors and permission screens.
