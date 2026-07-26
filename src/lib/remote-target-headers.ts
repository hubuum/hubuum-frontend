const TRANSPORT_CONTROLLED_HEADERS = new Set([
	"connection",
	"content-length",
	"host",
	"http2-settings",
	"keep-alive",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export function assertRemoteTargetHeaderAllowed(
	header: string,
	label = "Headers template",
): void {
	if (TRANSPORT_CONTROLLED_HEADERS.has(header.trim().toLowerCase())) {
		throw new Error(
			`${label} cannot set the transport-controlled ${header.trim()} header.`,
		);
	}
}

export function validateRemoteTargetHeaders(
	headers: Readonly<Record<string, unknown>>,
): void {
	for (const header of Object.keys(headers)) {
		assertRemoteTargetHeaderAllowed(header);
	}
}
