import { Permissions } from "@/lib/api/generated/models";

export type ScopeGroup = {
	label: string;
	scopes: Permissions[];
};

export const SCOPE_GROUPS: ScopeGroup[] = [
	{
		label: "Collections (namespaces)",
		scopes: [
			Permissions.ReadCollection,
			Permissions.UpdateCollection,
			Permissions.DeleteCollection,
			Permissions.DelegateCollection,
		],
	},
	{
		label: "Classes",
		scopes: [
			Permissions.CreateClass,
			Permissions.ReadClass,
			Permissions.UpdateClass,
			Permissions.DeleteClass,
		],
	},
	{
		label: "Objects",
		scopes: [
			Permissions.CreateObject,
			Permissions.ReadObject,
			Permissions.UpdateObject,
			Permissions.DeleteObject,
		],
	},
	{
		label: "Class relations",
		scopes: [
			Permissions.CreateClassRelation,
			Permissions.ReadClassRelation,
			Permissions.UpdateClassRelation,
			Permissions.DeleteClassRelation,
		],
	},
	{
		label: "Object relations",
		scopes: [
			Permissions.CreateObjectRelation,
			Permissions.ReadObjectRelation,
			Permissions.UpdateObjectRelation,
			Permissions.DeleteObjectRelation,
		],
	},
	{
		label: "Templates",
		scopes: [
			Permissions.CreateTemplate,
			Permissions.ReadTemplate,
			Permissions.UpdateTemplate,
			Permissions.DeleteTemplate,
		],
	},
	{
		label: "Remote targets",
		scopes: [
			Permissions.CreateRemoteTarget,
			Permissions.ReadRemoteTarget,
			Permissions.UpdateRemoteTarget,
			Permissions.DeleteRemoteTarget,
			Permissions.ExecuteRemoteTarget,
		],
	},
	{
		label: "Audit and events",
		scopes: [Permissions.ReadAudit, Permissions.ManageEventSubscription],
	},
];

export const ALL_SCOPES: Permissions[] = SCOPE_GROUPS.flatMap(
	(group) => group.scopes,
);
