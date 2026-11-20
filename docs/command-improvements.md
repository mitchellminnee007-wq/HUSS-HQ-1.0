# Command improvements

- Promotion: only Officer and Commander roles can promote. Officers can promote up to Hussar; Commanders up to Officer. Dragoon and ordinary Member roles do not grant promotion rights. Hussar/Hussars spellings are accepted.
- Warnings: only members below the issuing officer's rank can be warned. One oldest eligible warning expires after 30 days, then at most one per following 30-day period. The periodic check runs daily, so expiry may occur up to a day later. Old voting buttons no longer remove warnings. Discharge preserves warning history.
- `/memberinfo`: rank, qualifications and stored accepted event RSVPs. Warning totals are visible only to officers. RSVPs do not prove attendance.
- `/setup-check`: check configuration, roles and important channel permissions without changing them.
- `/certify`: Trainers, Officers or Commanders record pass/revocation with a reason. Configure Trainer and qualification roles through `/config`. Self-certification is disallowed.
- `/warreport`: current/last completed tracked war, reported kills, stored signups, completed logistics tasks and delivered orders. Completed-war history starts with this release.
- `/auditlog`: officer-only, paginated records for instrumented rank/warning, certification, ticket close, logistics, manual rollover and kill-reset actions. It is not a complete Discord audit log and has no historical backfill.
- Rollover now uses `/warflow`: Commander approval starts a full 48-hour activity check, followed by a separate preview and confirmation. Legacy automatic schedules cannot execute. Required roles must be manageable before changes begin. See `squads-warflow.md`.
- Kill count: starting a new war cannot overwrite an active war, old panels/forms cannot update the current war, and resets require confirmation. Completed wars are retained.
- Activity checks created after this update persist their deadlines across restarts. Rosters are paginated. Clearing activity roles requires confirmation.
- Ticket closure requires confirmation, captures all paginated messages in a local HTML transcript, and stops before deletion if transcript generation or configured log delivery fails. Attachment links can later expire; attachment binaries are not archived.
- Logistics task forms use Discord's five-row maximum. Attachment-only messages can be relayed. `/logitest` requires a separate configured test forum in the configured WHL guild.
- Event forms recheck permissions and validate calendar dates and future start times. Reminder delivery is marked complete only after a successful send.
- Reaction-role setup rejects privileged, configured protected and qualification roles. Configuration accepts ticket categories and validates channel types.
- Training cleanup previews by default; confirmation archives duplicate active threads. Application clearing also previews by default. It does not revoke earned qualification roles.
- Locations support autocomplete and region searches. Feature initialization runs once.

Run `/setup-check`, configure optional Trainer/Logistics/qualification roles, and open the Logistics page on `/botpanel`. Existing dashboard messages gain the new page when refreshed; repost `/botpanel` if desired.

Validation uses local mocked Discord interactions and isolated domain tests. Real permission overwrites, the Discord role hierarchy and in-game movements still require correct server setup and user input.
