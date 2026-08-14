export const EVENT_ENTITY_TYPES = [
	"collection",
	"class",
	"object",
	"class_relation",
	"object_relation",
	"task",
	"template",
	"remote_target",
	"user",
	"group",
] as const;

export const EVENT_ACTIONS = [
	"created",
	"updated",
	"deleted",
	"failed",
	"succeeded",
	"cancelled",
] as const;

export const EVENT_ACTOR_KINDS = [
	"user",
	"service_account",
	"system",
	"worker",
] as const;
