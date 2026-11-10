# DM verification

Verification and Ally Request buttons now start a DM conversation. Officer Question continues to create a private server ticket. Existing ticket channels and their controls remain available.

## Setup

1. Restart the bot with the updated code and register commands with `npm run deploy-commands` to expose the new configuration choices.
2. Use `/config set-channel`, setting **Verification Review Channel**, to select a private text channel. If unset, **Officer Channel** is used. Deny View Channel for @everyone; grant access only to the intended reviewers. The bot needs View Channel, Send Messages, Read Message History, Embed Links and Attach Files there.
3. Configure **Verified Member Role**, **Cadet Role**, **Ally Role** and **Unverified Role** using `/config set-role`. When unset, the bot looks for roles named Member, Cadet, Ally and unverified.
4. Give the bot Manage Roles and place its highest role above every role it must add or remove.
5. Repost the public panel using `/ticketpanel` or the bot panel to show the new instructions. Old panel buttons also use the new flow.

The code enables DirectMessages and the Channel partial. Keep the existing Guild Members and Message Content intents enabled for this bot.

## Flow

- The applicant selects Verification or Ally Request in the server.
- The bot sends instructions and the F1 example by DM. Blocked DMs produce instructions to enable them and retry.
- The applicant attaches one PNG, JPEG or WebP image, at most 8 MB. Ally requests also require the clan/group name in the same message.
- The bot copies the attachment to a review message in the private review channel. Officers use Accept or Reject; rejection requires a reason. Applicants cannot review themselves.
- Acceptance gives Member + Cadet for membership, or Ally for allies, and removes unverified. Membership also removes Ally, Former Member and Former collie when present. Existing higher ranks are preserved and do not get Cadet.
- Decisions are recorded in the review panel and sent to the applicant by DM. Failed DMs do not undo the decision. A rejected applicant can start again.
- Acceptance also creates a private Officer Question ticket for follow-up questions, or reuses that applicant's existing question ticket. Its link appears in the review panel and confirmation DM. The bot needs permission to create/manage ticket channels. If ticket creation fails after roles were granted, the request stays pending: fix channel permissions and retry Accept; role changes are safe to retry.

Recruitment Officers (configured role, otherwise the role name), Officers, Commanders and members with Manage Server may review both types. Restrict review-channel visibility accordingly.

There is one active request per user across servers to avoid ambiguous DM uploads. Upload sessions expire after 24 hours and can be cancelled by sending `cancel`. Submitted requests remain pending until reviewed. Request state persists in `data/verification-requests.json` across restarts; keep this file with the bot's persistent data. The upload and decision locks assume one bot process, consistent with the current deployment.

## Validation

Run `node --test tests/verification.test.js`. These are local tests with simulated Discord interactions. Before rollout, verify in a test server: blocked/open DMs, member and ally submissions, image rendering in the review panel, Accept/Reject, role hierarchy failure, and applicant notifications.
