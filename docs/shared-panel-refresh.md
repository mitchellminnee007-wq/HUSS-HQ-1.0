# Shared-panel refresh — current war

This fix is independent of the War 144 UX gate.

- Admin dashboard navigation/Refresh updates its existing message in the private officer channel. If the channel becomes visible to everyone, refresh refuses to publish updated officer information.
- Squad directory navigation/Refresh updates the shared message with approved public squad information. Opening a squad's details still opens a private view. Private squad navigation updates that private message.
- Published vote Refresh results updates the clicked result message without making a new private copy. Ballots and officer controls remain private. Existing automatic vote refresh remains active.
- Shared admin, status and squad panels refresh automatically approximately once per minute while the bot is online. References are saved through the storage adapter in `data/shared-panels.json`; they survive restarts. Missing/deleted messages are removed from tracking. Failed edits retry on later cycles; unchanged content is skipped.
- New admin/status panels register immediately. Existing admin/status panels register when their Refresh button is clicked once after deployment. Existing stored squad directories are discovered automatically. This does not scan server message history or recreate deleted panels.
- Stockpile/order/manifest entry panels intentionally open permission-filtered private browsers; those are not public inventory dashboards. Their existing private live refresh is preserved.

Deploy the changed modules and restart the bot to apply the current-war fix. Register slash commands to make `/uxrelease` available; that command does not release the War 144 package by itself. No deployment or live Discord validation was performed during local implementation.

Local regression command: `node --test scripts/test-panel-ux.cjs tests/war-vote.test.js tests/war-vote-flow.test.js tests/community-features.test.js tests/squad-warflow.test.js`.
