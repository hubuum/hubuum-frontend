# Private login backgrounds

Place private login artwork in this directory for local development. Supported
formats are AVIF, JPEG, PNG, and WebP.

The image files are deliberately ignored by Git and excluded from the container
build context. The application discovers them at runtime. Production containers
should mount the corresponding private directory read-only at
`/app/login-backgrounds`.
