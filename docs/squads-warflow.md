# Squads and Able war lifecycle

## Members
- `/squad list` opens the directory. Choose a squad to see its roster, goal and recruitment status.
- `/squad create` submits a unique name, department, leader and goal for approval. Frontline also requires Army, Navy or Air.
- `/squad join` requests membership; an existing invitation is accepted immediately. `/squad leave` also withdraws a request.
- `/squad history` shows previous goals. `/memberinfo` now includes approved squad memberships.

## Leaders and department leadership
- Leaders manage their own squads with `/squad invite`, `kick`, `edit`, `transfer`, `goal` and `delete`.
- `/squad review` lists requests you can decide. `/squad approve` accepts/rejects creation, membership, goal or deletion requests.
- Squad leaders decide membership. Department leadership or Commander decides creation, new goals and deletion. A leader must transfer leadership before leaving.
- Deletion requires both a confirmed request and confirmed approval. Deleted squads and audit records remain stored; department leadership can view their goal history.
- Commander can publish `/squad panel`. It refreshes on squad changes; buttons open private views with current permissions.
- Squad leadership does not grant Discord officer roles. No squad or membership caps. No production/resource/gameplay tracking.

## War lifecycle
Able is polled every five minutes. API errors and scheduled end times do not trigger war end. Matching existing kill counts are adopted without clearing submissions. New campaigns get new kill-count panels, with completed counts archived.

At a confirmed war end, a summary is posted in the configured announcement channel and the officer channel receives an activity approval request. A Commander runs `/warflow activity confirm:True` or uses its approval button. This clears old Active roles and posts a new 48-hour check in announcements. Responses are recorded separately from roles.

After both 48 hours since war end and the activity response window have elapsed, `/warflow preview` shows the impact and offers a Commander-specific confirmation valid for ten minutes. Rollover does not run automatically. Inactive allies only lose Ally; their other roles remain unchanged and neither Unverified nor Former Member is added, even if they also hold Member. Other inactive non-bot members other than the server owner lose editable roles and receive Unverified and Former Member. Officers must respond too. Review the preview before confirming.

`/warflow status` shows API errors and pending work. `/warflow recover confirm:True` releases interrupted starts/runs for explicit review; it never automatically retries role changes. `/warflow reconcile confirm:True` archives a conflicting manual kill count and synchronizes the current API war. Use only after checking the status. Legacy rollover commands cannot execute a reset, and legacy activity panels cannot modify the managed roster.

Configured announcement channel: `1386227881235185674`. Approval channel: existing officer channel. Role IDs are configured per server. No member reset or activity check is executed during deployment.

## Operational limits
- Discord messages and local JSON cannot form a single database transaction. Message nonces reduce duplicate sends; durable action states prevent automatic retries of destructive work after a crash. Recover interrupted actions explicitly.
- A completely missed war end is flagged, not invented. The public API exposes the current campaign only.
- Summaries count linked manual kill reports and approved awards at publication time. They are not live gameplay telemetry.
- Activity buttons reject late responses even if the original announcement is still visible.
- Stored data survives restarts. Only one HUSS process should write these JSON stores.
