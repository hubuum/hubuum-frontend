"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchResourceOption } from "@/lib/api/resource-options";

export function SearchResourceContext({
	kind,
	id,
}: {
	kind: "class" | "collection";
	id: number;
}) {
	const query = useQuery({
		queryKey: ["resource-option", kind, String(id)],
		queryFn: ({ signal }) => fetchResourceOption(kind, String(id), signal),
		staleTime: 60_000,
	});
	return (
		<Link href={`/${kind === "class" ? "classes" : "collections"}/${id}`}>
			{query.data?.name ??
				(query.isError
					? "Name unavailable"
					: kind === "class"
						? "Class"
						: "Collection")}{" "}
			(#{id})
		</Link>
	);
}
