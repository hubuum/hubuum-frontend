import { readMountedLoginBackground } from "@/lib/login-backgrounds";

type LoginBackgroundRouteContext = {
	params: Promise<{
		fileName: string;
	}>;
};

export async function GET(
	_request: Request,
	context: LoginBackgroundRouteContext,
) {
	const { fileName } = await context.params;
	const background = await readMountedLoginBackground(fileName);
	if (!background) {
		return new Response(null, { status: 404 });
	}

	return new Response(background.bytes, {
		headers: {
			"Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
			"Content-Length": String(background.bytes.byteLength),
			"Content-Type": background.contentType,
			ETag: background.etag,
			"Last-Modified": background.lastModified,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
