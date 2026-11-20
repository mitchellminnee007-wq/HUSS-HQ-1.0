# Maintenance mode

Run commands in the server you want to affect. Settings are stored per server and survive restarts. Officer, Commander or Manage Server permission is required to change them.

- `/maintenance on target:Entire server reason:Updating the bot`
- `/maintenance on target:Orders reason:Fixing order processing`
- `/maintenance off target:Orders`
- `/maintenance status` — available to everyone.

Targets: entire server, stockpiles, orders, TTS, verification/tickets, operations, training (including certify/logitest), logistics tasks. Disabling server maintenance does not clear individual feature maintenance.

Affected slash commands, autocomplete, buttons, select menus and modal submissions are blocked for everyone, including officers. Maintenance controls and the status panel remain available. Stockpile maintenance also blocks orders because orders can change inventory. TTS/server maintenance disconnects TTS and clears speech; run `/tts join` again afterward. Verification DM uploads pause with a maintenance notice. Logistics message relaying pauses for a server under logistics/server maintenance.

Status panels display maintenance reasons after Refresh. This is a user-action pause, not a shutdown: background timers and already running actions can finish. It does not stop the VPS, other bots or scheduled background jobs. Reasons are public; do not include secrets.
