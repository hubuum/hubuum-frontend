# Explore the Atlas example inventory

Use the same small inventory as the server documentation and the other Hubuum
interfaces. Atlas demonstrates **classes, objects, relations, and access** with
four classes and ten connected objects.

## Load the shared dataset

Follow the server's [Atlas dataset guide](https://hubuum.github.io/hubuum/main/getting-started/example-dataset/)
to download and import the inventory into an evaluation server. Atlas is initially
available in the explicitly selected development edition. When a server release
includes it, use that release's documentation and downloads. Pin a release or
exact server commit for repeatable tests; do not copy a second fixture into this
repository.

The import aborts atomically on name collisions and contains no passwords,
tokens, users, or group memberships. Its separate backup replaces all application
data and is intended for resetting a disposable demo installation. The server
guide owns the loading, restore, compatibility, and checksum instructions.

| Class | Objects to explore | Schema and authority |
| --- | --- | --- |
| Service | Atlas, Beacon | Enforced schema; maintained in Hubuum |
| Server | web-01, web-02, worker-01 | Enforced schema; reference inventory data |
| Location | Oslo, Bergen | Schema-free; reference facilities data |
| Context | Research notes, Migration checklist, Capacity observation | Schema-free; locally maintained notes and an upstream observation |

A class defines a resource type and its schema policy. Its objects hold the
individual JSON records. Source ownership is independent of schema policy:
`data.source` is example metadata, not automatic synchronization or write
protection.

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

Atlas runs on web-01 and web-02; their locations are Oslo and Bergen. Atlas
also links to Research notes and Migration checklist. Class relations define
which resource types connect; object relations connect these specific instances.

The example creates empty atlas-readers and atlas-operators groups. A principal
assigned only to atlas-readers can read all ten objects without changing them.
A principal assigned only to atlas-operators can read and maintain the five
Server/Location objects in atlas-demo-operations, but cannot read the service
catalogue in its parent collection. Test these differences with non-admin
accounts and an unscoped token; other memberships and token scopes affect access.

For exact data, expected relationships, and checksums, return to the server's
[canonical dataset guide](https://hubuum.github.io/hubuum/main/getting-started/example-dataset/).
The server corpus tests verify import and restore, schemas, permissions,
computed values, filters, and pagination. Each client retains its own compatibility
and integration tests; the example does not change its supported server target.
