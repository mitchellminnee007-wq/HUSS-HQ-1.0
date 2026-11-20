# War hub and member workflows

## Available this war

- `/onboarding view|interests|skip|reset`: verification, interests, squad membership, training qualifications and first operation signup. Optional steps can be skipped; verification cannot. Signup does not certify training or prove attendance.
  Successful member verification now sends an **Open onboarding** button in the approval DM and the private question ticket. The DM button opens a personal checklist with refresh and a link back to the server. Buttons are applicant-bound and recheck membership and maintenance. Ally approvals and rejected requests do not receive member onboarding. This applies to new approvals; past applicants are not bulk-messaged.

- `/hub view` opens a private, permission-filtered war hub. `/hub panel` lets officers post a shared entry point in their chosen channel. No inventory or private records are published in that shared entry message. The hub links to the existing order and stockpile browsers, recruiting squads, upcoming events and `/me`.
- `/hub reminders delivery:DM|Off|Operation channel` changes personal operation reminders. The existing 15-minute reminder has Confirm attendance, Running late and Withdraw buttons. These update the existing RSVP record, not qualifications or proof of attendance. Members must already be signed up and retain access to the source channel. Late status appears on the accepted roster.
- `/feedback submit` opens a form. `/feedback mine` and `/feedback view` show the reporter's own reports; officers can use `/feedback queue` and `/feedback update`. Statuses: Submitted, Investigating, Planned, Resolved. Reports remain private, with at most ten unresolved reports per member.
- `/absence set return:YYYY-MM-DD note:...` records absence through the chosen return day in Europe/Brussels. `/absence mine`, `/absence clear`, and officer-only `/absence list` manage notices. Commander rollover previews include counts of absent nonrespondents. Absence never adds an activity response or exempts a member from rollover.
- `/healthalerts on|off|status` manages grouped alerts in the configured private officer channel. Repeated errors (three per measured window), event-loop delay above 500 ms, or stale/failing enabled War API tracking trigger alerts. Identical alerts are grouped for 30 minutes, send attempts are at least five minutes apart, and recovery needs three consecutive clean checks. A stopped bot cannot send its own outage alert.

## Prepared for next war

These command groups remain under explicit next-war maintenance holds until an officer/Commander releases them. The status panel labels them with a clock, separately from maintenance or errors.

- `/debrief submit`: choose an accessible started operation, report outcome and lessons, and optionally suggest commendations. The operation creator, assigned squad leader/department leadership or an officer can submit. Another officer must approve or reject; source-channel access is checked on every read. Award suggestions require a separate normal nomination. Approved debriefs appear in `/wararchive` and their count is included in subsequently generated war-end summaries. Existing summary messages are not rewritten.
- `/squad-review submit|list|approve|reject`: squad progress and optional proposed war goal. Department leadership/High Command approval uses existing squad permission IDs. An approved future goal remains planned until that exact war starts according to the War API; activation archives the previous goal once. Both squad and squad-review maintenance must permit activation. No gameplay/resource tracking is added.
- `/notifications view|set|inbox`: operations, training, report updates and review updates. Operations/training default to channel reminders; report/review updates default off. DM delivery is opt-in. Server delivery for private report/review updates means a private inbox, never a public post. Preferences do not suppress mandatory verification or administrative messages outside these categories.
- `/wararchive war:<number> section:summary|goals|operations|awards|debriefs`: filters by stored Able war identity and current permissions. Unknown historical labels are not guessed. Operation snapshots are retained on subsequent changes/deletions from this release; earlier deleted operations cannot be recovered. Deleted/inaccessible source channels hide their operation/debrief content.

The officer approval queue includes independent debrief reviews and squad progress reviews when released. Department heads can access their squad requests without gaining officer award or verification powers.

## Storage and operational details

`community.json` uses the existing atomic storage adapter and is automatically included in a later SQLite migration. It contains preferences, private inboxes (last 50 updates), recent delivery deduplication (seven days), reports, absences, debriefs, operation snapshots and health-alert settings. Squad progress and planned goals remain in `squads.json`. No production SQLite switchover is part of this release.

DM attempts are claimed before sending to avoid duplicate delivery across retries/restarts. A failure or crash during the send can result in a missed DM; there is no public fallback or automatic retry storm. Failed deliveries appear in `/health`. Public event reminder posts remain visible when a member opts out, but the member is not pinged. Up to 75 channel participants are mentioned in each reminder to stay within Discord message limits.

HTTP 429 responses are tracked separately as throttling because the Discord client waits and retries them. The status panel shows yellow while these are in the observation window. Ten or more throttled responses in 15 minutes trigger an officer alert; non-429 errors remain in the purple error category. Startup also skips rewriting qualification-thread invite settings that are already correct.

To release next-war workflows, complete `/warsetup check`, resolve blockers, then explicitly remove holds for `debrief`, `squad-review`, `notifications`, and `wararchive`. Release existing `approvals`, `operation-team`, `tasklink`, and `help` as appropriate. Setup signoff never removes holds or resets members automatically.
