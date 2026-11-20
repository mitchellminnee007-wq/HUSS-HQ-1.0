# HUSS regiment commendations

Regiment awards are independent of Foxhole's in-game commendations, rank promotions and Discord permissions. They never add roles or grant access. The seven categories are Winged Hussar's Cross, Combat Valor, Field Leadership, Guardian Angel, Brother in Arms, Instructor's Badge and Campaign Service.

## Members

Use `/commendation nominate member:<person> award:<category> reason:<contribution>`.

- Nominate a verified regiment member, not yourself or a bot.
- Optional `war` defaults to the tracked current war (otherwise Not specified).
- Optional `evidence` accepts an HTTPS screenshot/message link. Access to the linked source still depends on Discord/external permissions. Evidence is visible only to the nominator and officers; citations become public when approved.
- `/commendation mine` shows your nominations and any questions from reviewers. Open the nomination and use **Provide information** to respond. This first version uses the panel for updates, not automatic DMs.
- `/commendation hall` lists active approved awards chronologically. Choose an award to see its citation, war, date and approving officer.
- `/memberinfo` shows the member's latest five active awards and total. The Hall contains the full list.

## Officers and Commanders

- `/commendation panel` posts the shared Hall of Honours entry panel. Browsers open privately; review permissions are rechecked on every action.
- `/commendation review` opens pending requests. Use **Approve**, **Reject** or **Request details**. An officer cannot review their own nomination or an award for themselves. No administrator bypass is provided.
- Rejection and requests for information require a reason. Approval is disabled until the nominator responds to an information request.
- `/commendation history` includes approved, rejected and revoked entries.
- `/commendation announce entry:<choose> channel:<channel>` explicitly posts an approved award once. It includes the approved citation, not private evidence or review discussion. It does not ping anyone.

New final approvals now automatically queue an announcement in the configured honours announcement channel, falling back to the war announcements channel. The Winged Hussar's Cross queues only after the second independent approval. Existing approved awards are not backfilled. The saved announcement is shared with the manual announce command, preventing duplicate publication; corrections and revocations can update that same message.

Publication starts immediately after acknowledging approval, with a restart-safe queue checked every minute. Ordinary permission/configuration failures retry no sooner than five minutes later without undoing approval. The bot requires View Channel, Send Messages, Embed Links, Attach Files and Read Message History. An interrupted send is recovered by checking recent bot messages for its nomination marker; uncertain sends that cannot be confirmed stop for manual inspection rather than posting duplicates. Staff can see pending publication status in the nomination detail. Announcements never ping recipients or expose private evidence/review discussion.
- `/commendation correct entry:<choose> note:<why> reason:<corrected citation>` changes the citation while retaining its previous text in history.
- `/commendation revoke entry:<choose> note:<why>` withdraws an award without deleting history. An independent officer must perform corrections/revocations too. The Hall and member profiles exclude revoked awards. The bot also attempts to update the saved announcement and reports if it cannot.

Duplicate active nominations for the same recipient/category/war are blocked; each nominator may have at most ten open nominations. Review decisions are saved synchronously before replying, so another reviewer cannot overwrite a completed decision. Outdated forms require reopening. Entries are stored per server in `data/commendations.json` with atomic replacement, and actions are recorded in the existing audit log.

Use `/maintenance on target:Regiment commendations reason:...` to pause the feature in a server. Status panels include it. Previously posted panels and announcements are snapshots; refresh/reopen the Hall for current data.

## Extended honours features

### Two-officer approval

New or still-pending Winged Hussar's Cross nominations need two different, independent Officers/Commanders to approve. The first approval stays pending and the panel shows 1/2. Neither the nominator nor any recipient may vote. Asking for information clears existing approvals, so both reviewers must approve the clarified nomination. Already-approved legacy awards remain valid. Other award categories still need one independent officer.

### Squad awards

Run `/commendation squad name:<crew> award:<category> reason:<public citation>`, then select 2–20 verified members with the roster picker. You cannot include yourself. The form expires after 15 minutes or a restart. The submitted roster is fixed and all its recipients are excluded from review. An approved squad award is one Hall entry and appears on each recipient's member profile. Correct/revoke applies to the whole award. Duplicate active nominations for any overlapping recipient/category/war are blocked.

### Review reminders

By default, servers with a configured officer channel receive a count-only reminder for pending nominations idle for at least 3 days, at most once every 24 hours. Needs-information nominations are excluded. No pings, names, evidence or citations are sent. The scheduler checks every 15 minutes, pauses during server/commendation maintenance, and persists the last successful reminder time across restarts. No configured officer channel means reminders stay inactive until configured.

`/commendation reminders enabled:true channel:<officer-channel> after-days:3 interval-hours:24` changes these settings. Use `enabled:false` to disable. Allowed thresholds: 1–30 days and 6–168 hours. Officers only.

### End-of-war summaries

`/commendation summary war:<choose>` privately shows paginated approved awards, unique recipients and squad awards for that war. Default: last completed tracked war, then current tracked war. War labels match case-insensitively; pending/rejected/revoked awards and private evidence are excluded. This is an on-demand end-of-war report, not an automatic broadcast.

Officers can add `channel:<destination>` to publish it. Repeating the command for the same war/channel updates the saved post instead of posting another. Summary buttons browse and refresh current approved records. Publication requires Send Messages, Embed Links and Attach Files.

### Artwork

The shared Hall, award views, announcements, summaries and profiles with awards use the bundled crimson/charcoal/gold HUSS honours artwork. Profiles retain the member avatar. No blue is used. The image is stored at `assets/commendations/huss-honours.png`; attachments are sent directly to Discord, not loaded from an external image service.
