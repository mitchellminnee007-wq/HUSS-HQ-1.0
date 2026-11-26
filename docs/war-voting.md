# Next-war voting

`/warvote panel` posts a reusable War Planning panel. Members open the current vote or browse history; officers open guided setup from the same panel. `/warvote create` now opens that setup privately instead of publishing immediately.

Choose War goal, Deployment, or Custom. Complete a form with the question, 2–5 choices (one per line), optional context and a duration (default 72 hours, maximum 14 days). Review the destination and preview, edit if needed, then press Publish vote. Only the draft owner can publish/edit/discard it. The full voting window starts at publication, not draft creation. Drafts persist across restarts.

Verified members open a private ballot and select an option from a dropdown. Their current choice is shown; they may change or withdraw it before closing. Current membership and channel visibility are checked on every action. Public results show percentage bars and totals, not voter names; voter IDs are stored internally to prevent duplicate votes. Votes survive restarts.

Use Refresh or `/warvote status` for results. Public totals and deadline state refresh within a minute when Discord is reachable. `/warvote close` or Officer controls asks for confirmation before closing early. One open vote per server. Ties and zero-vote outcomes are explicit. `/warvote history` lists the latest 25 accessible published votes and decisions; older records remain stored. My drafts lists private drafts and publication attempts requiring attention.

The result is advisory. After voting closes, the configured Commander role can record the chosen option and an explanation via Officer controls. This is shown separately from the member recommendation and can only be recorded once. The bot does not automatically change squad goals, operations, or war lifecycle data. Run a goal vote first and a location vote afterwards. Deployment candidates must be checked against next-war starting conditions.

Suggested goal choices:
- Combined-arms frontline: one sector, coordinated infantry, armour and artillery operations.
- Naval task force: coastal protection, escorts and planned landing support.
- Logistics backbone: reliable supply for one agreed frontline sector.
- Defensive stronghold: one maintained position, reserve supplies and quick response.
- Training and recruitment: bring new members into squads and regular operations.

Candidate regions (not confirmed next-war deployments): Heartlands/Blemish for a land-based focus; Terminus/Therizo for a coastal/naval focus; Westgate for a western coastal focus. Inspect actual ownership, routes, industry and allied plans before selecting a base.
