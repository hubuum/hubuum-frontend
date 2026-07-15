export type RelationsRouteView = "classes" | "objects" | null;

export type RelationsContextVisibility = {
	showClass: boolean;
	showObject: boolean;
};

export function getRelationsContextVisibility(
	relationsView: RelationsRouteView,
	classView: string | null,
): RelationsContextVisibility {
	const showObject = relationsView === "objects";
	const showClass =
		showObject || (relationsView === "classes" && classView === "connected");

	return { showClass, showObject };
}
