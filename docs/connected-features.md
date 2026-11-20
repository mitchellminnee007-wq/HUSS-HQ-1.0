# Connected features and war rollout

## Available during War 142

- `/me`: private dashboard for squad recruitment, your orders/shipments, upcoming events, training/qualifications and requests. Pages are filtered by current access; private event channels and officer stockpiles stay hidden. Qualification-board signups are not certifications.
- Private stockpile/order/manifest browsers refresh after committed logistics changes, with a short debounce, and recheck permissions. Sessions remain live for up to 14 minutes, then reopen/Refresh; restart clears subscriptions. No interaction tokens are written to disk. Shared entry panels retain their privacy-safe layout.
- Canonical war metadata (`warRef`, with Able + API ID + number) connects matching stockpiles, linked orders, manifests, nominations and squad goals. New operations and dated training events capture their current war. Old labels are retained; unknown labels and old unlinked orders are not guessed. Current/last war reports prefer IDs with a documented date fallback for older unlinked records.
- Training prerequisites, certification and operation readiness read the same configured qualification roles. A trainer still needs to assess a member; nothing auto-certifies from a signup.
- New verification follow-up tickets provide dashboard, recruiting-squad, training and task buttons. Ally applicants do not gain member access from these buttons.
- Existing squads remain available so the active squad and pending request are not interrupted.

## Prepared for next war: squad-operation coordination

`/operation-team assign operation:<choose> squad:<choose> qualification:<optional>` lets officers assign one approved squad and a recommended qualification to an existing operation. `/operation-team unassign` removes the association. Leaders/department leadership of the linked squad and officers can use `/operation-team roster` to review paginated RSVPs and live qualification status. `/operation-team briefing` posts an invitation in the existing operation channel, without pings, at most once per hour. Members RSVP individually. No new officer permissions, automatic attendance or certifications are granted.

This new feature is held in maintenance for next-war rollout. Existing operations and squads remain available independently. At release time an officer/Commander can use `/maintenance off target:Squad operation coordination`; it does not automatically enable itself at war start. Squad or Operations maintenance also pauses this integration.

Existing TTS maintenance is preserved. Public announcement wording: “TTS will be available shortly.”

War-end summaries and Commander-approved activity/rollover remain active under their existing policy. No activity check, rollover, message broadcast or member role change is executed as part of deployment.
