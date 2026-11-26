# Next-war platform tools

The UX package requested on 2026-11-25 is planned separately for the **war after the next war**, not this rollout. See [UX release plan](ux-release-plan.md) for scope and release conditions.

## Rollout

**This war:** `/health` (officers) adds measured Discord REST errors/rate-limit waits, interaction acknowledgement p95, event-loop p95, Node memory, TTS wait/synthesis p95, live panel failures and overdue upcoming event reminders. `/botstatus` shows a public recent-health indicator. Samples are bounded, in-memory, and reset on restart; no message text, tokens or private request evidence is recorded. REST counters are process-wide. This is observability, not automated repair or an offline uptime monitor.

`/warsetup check war:143` is available to Commander for preparation. It checks core roles/channels, API freshness, unresolved cargo, squad goals, maintenance and storage mode. `/warsetup signoff war:143 confirm:True` records review after fresh checks. It never launches a war, resets roles, cancels orders or releases maintenance. Advisories can be acknowledged; blocking configuration errors must be fixed.

**Prepared behind maintenance for next war:**
- `/approvals`: one private officer queue for verification, allies, squads and commendations. Verification opens the original screenshot review; commendations open the original decision controls; squad requests open their details and retain department approval rules. Self-review and recipient exclusions remain. No bulk approval.
- `/tasklink link order:<choose> task:<choose>`, `/tasklink view`, `/tasklink unlink confirm:True`: associates existing WHL tasks and internal orders, with access to both checked. One external task may have multiple item orders. Linking never creates deliveries, deducts stock, completes external tasks or copies hidden order data into WHL. It is an association and combined progress view, not two-way status automation.
- `/help`: a role-aware guide with member, logistics, events/training and officer sections. Shows maintenance availability and directs legacy rollover users to `/warflow`.

Existing TTS and squad-operation maintenance remains unchanged. Release the staged command targets individually when ready.

## SQLite rollout and recovery

The compatibility adapter stores existing JSON documents and audit text in SQLite, preserving their schemas. This first migration is not a normalized table for every member/order. State writes and atomic replacements use SQLite transactions; logistics and commendation domain transactions use `BEGIN IMMEDIATE`. Files such as images, model files and HTML transcripts remain on disk. Run a single HUSS writer process. Existing asynchronous workflows still need their own stale-state guards.

The backend is opt-in through `HUSS_STORAGE_MODE=sqlite`. Production stays on JSON this war. SQLite startup refuses an absent, incomplete or unhealthy migration. Node 22's bundled `node:sqlite` is used; it reports an experimental-feature warning on the installed runtime.

At the next-war maintenance window:
1. Stop only `huss-hq-bot`; take a full code/data backup.
2. Run `/opt/huss-node-runtime/bin/node scripts/storage.js migrate` from the bot directory. This creates `data/huss.sqlite`, imports root `.json` and `.jsonl` stores transactionally, and preserves originals. It refuses an already initialized database. Do not reuse the rehearsal database or a stale pre-war snapshot.
3. Run `node scripts/storage.js check` using the same runtime.
4. Set `HUSS_STORAGE_MODE=sqlite` in the bot environment and restart HUSS. Verify `/health`, command availability, representative state and write/read behavior before ending maintenance.
5. Use `node scripts/storage.js backup data/huss.sqlite /absolute/new-backup.sqlite` for consistent SQLite backups. Do not copy only the main database file while WAL writes are active.

For rollback **after any SQLite writes**, stop HUSS and export current SQLite state into a fresh directory with `node scripts/storage.js export data/huss.sqlite /absolute/new-export-directory`. Back up current files, restore the exported documents, and only then switch the environment back to JSON. Never turn off SQLite and resume stale original JSON files. Existing original backups are for historical recovery, not an automatic rollback of newer writes.

Migration and export paths are operator tools, not Discord commands. Commander checklist signoff does not perform migration or restart the process.
