import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1CollectionsByCollectionIdAncestors,
	putApiV1CollectionsByCollectionIdParent,
} from "@/lib/api/generated/client";

const CONCURRENT_HIERARCHY_ERROR =
	"The collection hierarchy changed or the selected parent is no longer valid. Refresh and try again.";

export async function moveCollectionToParent(
	collectionId: number,
	parentCollectionId: number,
): Promise<void> {
	if (parentCollectionId === collectionId) {
		throw new Error("A collection cannot be its own parent.");
	}

	const ancestorsResponse = await getApiV1CollectionsByCollectionIdAncestors(
		parentCollectionId,
		{
			credentials: "include",
		},
	);
	if (ancestorsResponse.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				ancestorsResponse.data,
				"Could not validate the selected parent collection.",
			),
		);
	}
	if (ancestorsResponse.data.some((ancestor) => ancestor.id === collectionId)) {
		throw new Error(
			"A collection cannot be moved under one of its descendants.",
		);
	}

	const moveResponse = await putApiV1CollectionsByCollectionIdParent(
		collectionId,
		{ parent_collection_id: parentCollectionId },
		{ credentials: "include" },
	);
	if (moveResponse.status !== 202) {
		const fallback = [400, 409, 412].includes(moveResponse.status)
			? CONCURRENT_HIERARCHY_ERROR
			: "Failed to move collection.";
		throw new Error(getApiErrorMessage(moveResponse.data, fallback));
	}
}
