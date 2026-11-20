# Bot status panel

- `/botstatus view`: private snapshot for members.
- `/botstatus panel`: shared panel; Officer, Commander or Manage Server required.
- **Refresh status** updates an existing panel to the latest layout; no repost needed.
- **Maintenance & releases** opens a private explanation of paused features and upcoming releases. 🕒 **Next war** identifies planned releases separately from yellow maintenance; planned releases alone do not turn the overall status yellow. The existing next-war holds remain enforced until released.
- **Health details** opens private diagnostics, with Officer/Commander permissions checked on every click.

The panel groups community, logistics and administration features and shows available, maintenance and attention counts. Green means loaded and available, yellow means maintenance, reconnecting or delays, purple means recorded errors, and red means disconnected or a missing module. An outage takes priority over the purple overall indicator; recent errors still appear in the health field. Intentional maintenance is distinguished from errors. TTS in maintenance is labelled “Available shortly”. Availability is not an end-to-end permissions check.

Diagnostics show the last five failed Discord requests in the 15-minute window: HTTP status, safe endpoint category and time. Counters are process-wide for REST. No URLs, tokens, IDs, response bodies or message content are retained. Safe error summaries also go to the process log. Older errors cannot be reconstructed from a counter alone. Samples reset on restart.

This is an on-demand snapshot, not an external uptime monitor. The timestamp identifies the last update. An offline bot cannot refresh its own message.
