# Hubuum web frontend

The web frontend provides browser access to a Hubuum server. Its backend for
frontend keeps bearer tokens on the server; the browser uses a session cookie.
Valkey supplies shared session storage for multiple frontend replicas.

## Choose your starting point

- **Deploy it:** follow the [Compose quick start](quickstart-compose.md), then
  review [configuration](setup.md) and [observability](observability.md).
- **Choose versions:** check the [server compatibility record](compatibility.md)
  before pairing frontend and server releases.
- **Develop it:** use the [development setup](development.md) and
  [local sandbox](local-sandbox.md), then run the
  [authenticated browser tests](authenticated-browser-testing.md).

## Work with Hubuum

The server documentation explains the shared
[data model, permissions, and workflows](https://hubuum.github.io/hubuum/).
Access in the frontend follows the permissions assigned by your administrator.
For terminal or programming interfaces, visit the
[CLI and client libraries](https://hubuum.github.io/).

The documentation is a static website. Deploy the Next.js frontend itself using
its application deployment instructions; GitHub Pages hosts these guides only.
