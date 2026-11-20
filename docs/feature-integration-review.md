# Feature integration review

Based on the current local source; these proposals are not all implemented.

## Already connected
- Stockpile pickup, delivery, return and loss run through logistics-store transactions. Delivery to a configured destination updates recorded inventory. Manifests link orders and enforce visibility inherited from their stockpiles. Do not introduce a second inventory-writing path.
- Member profiles include rank, qualifications, event signups, commendations and now squads.
- War lifecycle connects the Able API, kill-count archive, announcement summary, activity response roster, Commander preview and rollover. Squad goals default to the recorded current war label.
- New squad/war interactions use the central maintenance gate; status includes their availability and war polling health.

## Recommended next changes, in priority order
1. **One permission service using configured role IDs.** ranks.js resolves some roles by ID but getMemberRank still matches names; killcount and several legacy commands have their own name checks. Migrate without widening member or squad-leader privileges. Validate every existing role mapping first. Preserve Officer -> Hussar, Commander -> Officer promotion limits.
2. **Canonical war IDs across records.** Logistics and commendations use free-text war labels while reports mostly use date windows. Store shard + API war ID on new records; retain historical labels and ask for review of ambiguous migrations. A new campaign should archive views, never silently delete open cargo/orders or squad goals.
3. **Keep /logitask as a WHL bridge, link it to internal /order records.** They currently have separate stores and completion rules. Add an optional stable externalTaskId/orderId link and show both statuses. External completion must not alter stockpile inventory without an explicit confirmed delivery.
4. **Shared panel update queue.** Squad directory refresh is wired to mutations; logistics panels mostly refresh on interaction. Publish domain events after successful commits and debounce affected order/stockpile/manifest panels. Retry Discord failures without replaying inventory changes. Show last updated time.
5. **Squads -> operations and training.** Optional squad IDs, squad RSVP shortcuts and qualifications shown when assigning roles. Keep RSVP distinct from attendance; never automatically award commendations based on signups. Existing squad commendations capture a separate selected roster, so add a saved-squad selector with a frozen recipient snapshot rather than changing old awards.
6. **One officer work queue.** Aggregate pending verification, allies, squads and commendations while each feature retains its own authorization and decision rules. Avoid a generic 'approve everything' action. Give members a separate 'my requests and tasks' panel.
7. **Transactional storage and job persistence.** Multiple features synchronously read/write JSON and some legacy readers silently return empty data on parse failure. Move to SQLite with a backup/migration plan, guild-scoped transactions, schema versions and a durable notification outbox. Keep one scheduled-job runner for reminders/war checks and persist delivery state.
8. **Measure before scaling.** Track Discord REST failures, panel queue depth, event-loop lag, API freshness, TTS synthesis latency and queue wait. Current status mainly measures loaded commands, not end-to-end health. Keep the TTS worker warm while joined as requested; profile its memory separately from the bot before considering another VPS.

## Suggested rollout
Permission consistency and canonical war identity first; panel queue and task links next; squad/event integration and consolidated dashboards after that. Back up data and test permission boundaries, stale buttons, duplicate events and restart recovery at every step. Preserve private stockpile codes and officer-only visibility in all new views.
