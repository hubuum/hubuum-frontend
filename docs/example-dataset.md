# Explore the Atlas example inventory

Use the same small inventory as the server documentation and the other Hubuum
interfaces. Atlas demonstrates **classes, objects, relations, and access** with
four classes and ten connected objects.

## Load the shared dataset

Use the [server v0.0.18 Atlas guide](https://hubuum.github.io/hubuum/v0.0.18/getting-started/example-dataset/)
to load the inventory into an evaluation server and grant your account access.
This matches this release's server target. The server guide owns the downloads,
model, permissions, and expected data. Import adds the dataset atomically;
**restoring its backup replaces all application data**.

Use the case-sensitive names `Service`, `Server`, `Location`, and `Context`.
Resolve numeric IDs from responses; they vary between installations.

## Follow the model in the browser

Connect the frontend to the server containing Atlas and sign in normally.
The browser continues to use the frontend's session and BFF; no API token
needs to be pasted into browser storage.

1. Open the classes and inspect **Service**. Its schema requires owner, tier,
   and environment. Compare it with **Context**, which has no schema.
2. Open **Atlas** in Service. Its owner is Platform and its environment is
   production. Then open **web-01** in Server and inspect its hostname,
   capacity, and cost data.
3. Inspect Atlas's object relations: web-01, web-02, Research notes, and
   Migration checklist. Their classes connect through the Service–Server
   and Service–Context class relations.
4. Inspect **Research notes** and **Migration checklist** in Context. Their
   different JSON shapes coexist without a required schema.
5. Inspect the Server class's monthly_cost computed field. Once background
   computation finishes, web-01's value is 50 in fictional cost units.

Use these same records when making screenshots or demonstrating a workflow.
Changes made through the frontend affect the shared evaluation server, so
restore the demo backup when you need the documented starting point again.

The existing [local sandbox](local-sandbox.md) starts with the larger functional
corpus for broad frontend testing. It does not automatically select Atlas.
Use an evaluation deployment for the walkthrough, or import Atlas alongside
the sandbox's existing data. A sandbox reset restores its original corpus.

## Relations and access

Use a non-admin account in `atlas-readers` to read the full inventory, or one
in `atlas-operators` to maintain Server/Location objects in the operations child.
Other memberships and token scopes affect the result. See the canonical
[relationships](https://hubuum.github.io/hubuum/v0.0.18/getting-started/example-dataset/#relations-connect-the-instances)
and [permission checks](https://hubuum.github.io/hubuum/v0.0.18/getting-started/example-dataset/#explore-collection-permissions)
for expected results and cleanup.
