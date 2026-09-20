export function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.style.display = "none";
	try {
		document.body.append(link);
		link.click();
	} finally {
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
