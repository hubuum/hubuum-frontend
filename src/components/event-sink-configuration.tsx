"use client";

import { JsonEditor } from "@/components/json-editor";
import { useConfirm } from "@/lib/confirm-context";
import {
	customizeWebhookPreset,
	type EventSinkFormState,
} from "@/lib/event-sink-form";
import {
	WEBHOOK_TARGETS,
	WEBHOOK_TARGET_LABELS,
	type WebhookTarget,
} from "@/lib/webhook-presets";

const guides = {
	slack: {
		url: "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/",
		instructions:
			"In your Slack app, enable Incoming Webhooks, add a webhook to the workspace, and choose its channel.",
	},
	mattermost: {
		url: "https://docs.mattermost.com/integrations-guide/incoming-webhooks.html",
		instructions:
			"In Mattermost, open Integrations → Incoming Webhooks, add a webhook, and choose its channel. Lock it to that channel for a fixed destination.",
	},
	discord: {
		url: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
		instructions:
			"In Discord, open Server Settings → Integrations → Webhooks and create a webhook for a text channel.",
	},
};

export function EventSinkConfiguration({
	state,
	onChange,
	disabled,
}: {
	state: EventSinkFormState;
	onChange: (state: EventSinkFormState) => void;
	disabled: boolean;
}) {
	const confirm = useConfirm();
	const target = state.kind === "webhook" ? state.webhookTarget : "custom";
	const guide = target === "custom" ? null : guides[target];

	async function changeTarget(next: WebhookTarget) {
		if (next === target) return;
		if (next === "custom") {
			onChange(customizeWebhookPreset(state));
			return;
		}
		if (
			target === "custom" &&
			(state.configInput.trim() !== "{}" ||
				state.deliveryPolicyInput.trim() ||
				state.secretRef.trim())
		) {
			if (
				!(await confirm({
					title: `Use ${WEBHOOK_TARGET_LABELS[next]} defaults?`,
					description:
						"This replaces the current payload, response rules, bearer secret, and delivery spacing. The saved sink changes only when you save the form.",
					confirmLabel: "Use defaults",
				}))
			)
				return;
		}
		onChange({ ...state, webhookTarget: next, deliveryIntervalInput: "1000" });
	}

	return (
		<div className="stack">
			{state.kind === "webhook" ? (
				<label className="control-field">
					<span>Webhook target</span>
					<select
						value={target}
						disabled={disabled}
						onChange={(event) =>
							void changeTarget(event.target.value as WebhookTarget)
						}
					>
						{WEBHOOK_TARGETS.map((value) => (
							<option key={value} value={value}>
								{WEBHOOK_TARGET_LABELS[value]}
							</option>
						))}
					</select>
				</label>
			) : null}
			{guide && target !== "custom" ? (
				<>
					<ol className="muted">
						<li>
							{guide.instructions}{" "}
							<a href={guide.url} target="_blank" rel="noreferrer">
								{WEBHOOK_TARGET_LABELS[target]} setup guide
							</a>
						</li>
						<li>
							Ask your server administrator to store the complete webhook URL in
							the delivery workers’ secret source, then enter its secret name
							below.
						</li>
						{target === "discord" ? (
							<li>
								Include <code>wait=true</code> in the stored URL’s query string
								so Discord confirms message creation. This setup is for regular
								text channels.
							</li>
						) : null}
						<li>
							After saving, select this sink in a collection’s event
							subscription. Its destination will be filled in automatically.
						</li>
					</ol>
					<label className="control-field">
						<span>Webhook URL secret name</span>
						<input
							required
							value={state.urlSecretRef}
							disabled={disabled}
							onChange={(event) =>
								onChange({ ...state, urlSecretRef: event.target.value })
							}
							placeholder={`ops_${target}_webhook`}
							aria-describedby="webhook-url-secret-help"
							autoComplete="off"
						/>
						<span id="webhook-url-secret-help" className="field-note">
							Enter a secret name such as ops_chat_webhook. Keep the webhook URL
							in the server’s secret source.
						</span>
					</label>
					<label className="control-field">
						<span>Minimum spacing between messages (ms)</span>
						<input
							type="number"
							required
							min={1}
							max={86400000}
							step={1}
							value={state.deliveryIntervalInput}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...state,
									deliveryIntervalInput: event.target.value,
								})
							}
						/>
					</label>
					<p className="field-note">
						Messages contain the event summary. Rate limits pause delivery;
						temporary failures retry.{" "}
						{target === "discord"
							? "Messages are limited to 1,900 characters and automatic mentions are disabled."
							: "Successful delivery requires HTTP 200 and an “ok” response."}
					</p>
					<button
						type="button"
						className="ghost"
						disabled={disabled}
						onClick={() => onChange(customizeWebhookPreset(state))}
					>
						Customize configuration
					</button>
				</>
			) : (
				<>
					<label className="control-field">
						<span>
							{state.kind === "webhook"
								? "Bearer token secret reference (optional)"
								: "Secret reference"}
						</span>
						<input
							value={state.secretRef}
							disabled={disabled}
							onChange={(event) =>
								onChange({ ...state, secretRef: event.target.value })
							}
							placeholder="event-webhook-secret"
						/>
						<span className="field-note">
							Reference an externally managed secret; do not enter secret
							values.
						</span>
					</label>
					<JsonEditor
						id="event-sink-config"
						label="Configuration JSON"
						value={state.configInput}
						onChange={(configInput) => onChange({ ...state, configInput })}
						mode="data"
						rows={9}
						disabled={disabled}
						helperText="Transport-specific configuration is validated by the backend."
					/>
					<details>
						<summary>Delivery policy</summary>
						<label className="control-field">
							<span>Delivery policy JSON</span>
							<textarea
								rows={3}
								value={state.deliveryPolicyInput}
								disabled={disabled}
								onChange={(event) =>
									onChange({
										...state,
										deliveryPolicyInput: event.target.value,
									})
								}
								placeholder={'{"min_interval_ms": 1000}'}
							/>
							<span className="field-note">
								Leave blank to keep the current policy. Enter null to disable
								delivery spacing.
							</span>
						</label>
					</details>
				</>
			)}
		</div>
	);
}
