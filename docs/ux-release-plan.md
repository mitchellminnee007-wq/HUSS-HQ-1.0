# UX release — war after the next war

## Release decision

Requested on 2026-11-25: schedule the UX improvements below for the war after the next war, not for the upcoming war.

The user confirmed the current war is Able War 142. The fixed target is **Able War 144**. War 143 must not enable this package.

Status: implemented locally behind a default-closed release gate; not deployed or visually verified in Discord. Keep this package separate from the existing next-war features and their maintenance holds.

## Controls

- `/uxrelease status`: Commander-only status of the fixed target and member rollout.
- `/uxrelease preview`: private Commander preview. Actions use real server data and retain existing permission/maintenance checks. This is not a sandbox. Preview permission is rechecked on every interaction.
- `/uxrelease release confirm:True`: Commander-only activation. Requires a fresh successful Able poll (within 15 minutes) showing an active War 144 or later. It refuses War 142, War 143, an ended war, missing tracking or stale/error state. The release choice is stored in `data/ux-release.json` through the existing storage adapter.
- `/uxrelease hold`: return members to the original screens; existing UX sessions are blocked immediately. It does not undo saved user actions.

The gate defaults closed in every guild. Removing maintenance or advancing to War 143 cannot release it. There is no automatic activation. After explicit release, navigation stays released across restarts and subsequent wars until held again.

The new home replaces `/hub view`, `/me`, `/help`, `/onboarding view` and the shared hub's Open button only after release. Existing commands remain shortcuts. Private sessions last 14 minutes and are owner/guild-bound, held in memory without stored interaction tokens. After expiry/restart, reopen the hub.

Order, stockpile, manifest, squad and commendation actions reuse the existing domain handlers. Back navigation re-renders current data with current permissions. Order form validation failures offer a saved-input review with the current revision before resubmission. Event signups open the original operation/training panel; the UX does not claim actual attendance.

## Separate current-war fix

The user's subsequent shared-panel refresh request is implemented independently of War 144. See [shared-panel refresh](shared-panel-refresh.md). Do not postpone that fix behind this release gate.

## Scope and order

### 1. Navigation and direct actions

- Give members one HUSS Home entry point: My overview, Join activities, Logistics, Help & settings, plus authorized Officer tools. Keep existing slash commands as shortcuts.
- Update the existing private message when navigating; shared channel panels must continue to open private views.
- Provide consistent Back and Home actions. Preserve the previous filter and page on return.
- Open order, squad, shipment and request details directly from lists. Offer the appropriate claim, join-request, signup or response action without requiring another slash command.
- Replace command-only reminder settings with a selection control.

### 2. Onboarding and clarity

- Make interests, squad discovery, training, first-operation signup and optional-step skipping directly actionable from the checklist.
- Show the next useful onboarding step and use the selected interest to prioritize relevant activities.
- Highlight one primary action and the selected section. Hide unnecessary pagination on single-page views.
- Use readable status labels and concise summaries; offer additional details separately.
- Replace generic empty states with a contextual explanation and a useful next action.
- Give specific success confirmations. For stale or invalid forms, preserve entered values where feasible and provide a route to refresh/retry without bypassing validation.

### 3. Consistency fixes

- Merge operations and training into one chronologically sorted upcoming-events list.
- Label RSVP confirmation as intent to attend, not proof of actual attendance.
- Derive release/maintenance wording from actual availability instead of fixed "Next war" copy in the personal dashboard.
- Align the admin rollover explanation with the implemented 48-hour activity check and separate Commander confirmation.

## Acceptance checks before release

- Exercise new-member, verified-member, logistics and officer flows in Discord, including a narrow/mobile view.
- Reach a listed order or squad's action without typing another command.
- Navigate and return without accumulating private navigation messages or losing filters/pages.
- Check empty lists, one-page lists, expired interactions, stale forms and unavailable features.
- Recheck permissions for every action and preserve private inventory, request and officer visibility.
- Preserve inventory transaction rules, role boundaries, RSVP/attendance distinctions and existing maintenance gates.
- Validate each changed flow with focused tests; review release readiness before deploying this package for its target war.
