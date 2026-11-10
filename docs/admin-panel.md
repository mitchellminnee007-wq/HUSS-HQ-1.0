# HUSS admin dashboard

Use `/botpanel` in a private officer text channel. If **Admin Panel Channel** is configured, post it there. Set that channel through `/config set-channel` or the dashboard's Settings form. Posting still requires an Officer/Commander role and access to the slash command (Manage Server by default).

The shared message provides an overview. Navigation opens a private dashboard for the officer; switching pages does not change anyone else's view. Status refreshes when opening a page or clicking Refresh, rather than updating the shared message automatically.

- **Overview:** pending DM reviews, active screenshot sessions, open server tickets, kill tracker and rollover schedule.
- **Verifications:** oldest pending requests first, five per page, with direct links to the original review messages; publish the public verification panel.
- **Events:** existing operation and training creation forms.
- **War management:** activity checks, kill tracker and rollover controls. Manual rollover scheduling asks for confirmation. Activity checks require an explicit YES to schedule a rollover and preserve any existing schedule. A new kill tracker cannot replace an already active tracker.
- **Settings:** edit five main channels or five recruitment roles. Only Officers/Commanders with Manage Server may save changes. IDs and mentions are accepted; blank fields preserve current settings. Other options remain available through `/config`.

The admin and review channels must deny View Channel for @everyone. Check other role overwrites as well so only intended officers can read them.

After installing the updated code, restart the bot, register commands with `npm run deploy-commands`, and repost `/botpanel`. Existing action buttons remain compatible. Local tests use mocked Discord interactions; verify the posted dashboard and role/channel permissions in a test server before production use.
