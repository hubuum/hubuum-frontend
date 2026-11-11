export const BACKEND_REVISION_HEADER = "x-hubuum-backend-revision";

let browserRevision: string | undefined;
export function setBrowserBackendRevision(revision: string | undefined): void {
	browserRevision = revision;
}
export function getBrowserBackendRevision(): string | undefined {
	return browserRevision;
}
