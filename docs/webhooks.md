# Chat webhooks

Administrators can choose **Slack**, **Mattermost**, or **Discord** in
**Admin → Events → Create sink → Webhook target**. Each setup supplies a message
template, acknowledgement rules, retries, and one-second delivery spacing.
The server stores an ordinary `webhook` sink; the target choice is only a console
setup aid. These presets require Server `v0.0.17` or newer.

## Connect a destination

1. Create an incoming webhook in your chat service and choose its channel.
2. Ask your server administrator to store the complete HTTPS webhook URL in the
   delivery workers' secret source. For Discord, include `wait=true` in the URL's
   query string so it confirms message creation. Use a regular text channel;
   forum and media channels need custom thread settings.
3. Create a sink, select its target, and enter the **Webhook URL secret name**.
   This is an alias such as `ops_chat_webhook`, not the URL itself. The default
   environment secret source resolves that alias from
   `HUBUUM_EVENT_SINK_SECRET_OPS_CHAT_WEBHOOK`; the file source resolves
   `event-sink/ops_chat_webhook` relative to `HUBUUM_SECRET_FILE_ROOT`.
4. Save the sink. On a collection page, create an **Event subscription**, select
   the sink, and choose the events to deliver. The Routing step uses the sink's
   destination automatically, with no second URL to enter.

The server must run fan-out and delivery workers, and each delivery worker must
resolve the same secret alias. The console does not provision external secrets
or enable server workers. See the [server webhook setup guide](https://github.com/hubuum/hubuum/blob/v0.0.17/docs/webhook_notifications.md)
for environment/file setup, private Mattermost destinations, system subscriptions,
and preview/test-delivery commands. Saving a sink does not send a test message.

| Target | Message | Successful acknowledgement |
| --- | --- | --- |
| Slack | Event summary in `text` | HTTP 200 and trimmed body `ok` |
| Mattermost | Event summary in `text` | HTTP 200 and trimmed body `ok` |
| Discord | Event summary in `content`, truncated to 1,900 characters; automatic mentions disabled | HTTP 200 with `wait=true` |

Templates JSON-escape the summary and include a `[TEST]` marker during server
previews/tests. All presets honor HTTP 429 cooldowns and retry HTTP 408, 500,
502, 503, and 504. Adjust spacing for the destination's limits and traffic from
other senders. See the provider guides for
[Slack](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/),
[Mattermost](https://docs.mattermost.com/integrations-guide/incoming-webhooks.html),
and [Discord](https://docs.discord.com/developers/resources/webhook#execute-webhook).

## Customize or edit

Choose **Customize configuration** to carry the generated configuration into the
JSON editor. This preserves the template, URL secret name, acknowledgement rules,
and delivery spacing. The separate bearer-token secret reference is for services
that need HTTP bearer authentication; the three chat presets use only the secret
URL.

Existing sinks open as **Custom webhook**, preserving their saved settings.
Applying a preset to custom settings requires confirmation before replacing them.
Canceling the sink dialog leaves the saved sink unchanged. Delivery policy JSON
can adjust pacing; leave it blank to keep the current policy, or enter `null` to
remove it.

Subscriptions retain task-kind filters configured through the API when edited
in the console. System subscriptions and provider test delivery remain available
through the server API; the console presets configure collection notifications.
