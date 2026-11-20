# Shared rank permissions

HUSS uses configured role IDs for ranks and verified membership. Its `PERMISSIONS_REQUIRE_ROLE_IDS` setting disables rank-name fallback. Missing or deleted rank roles therefore deny access instead of granting it to a different role with the same name.

- `/config set-rank rank:Officer role:...` sets a canonical rank role. Manage Server permission is required. Each rank must have a distinct role. Commander updates also synchronize the squad/war Commander setting. No Discord member roles are changed by configuration.
- Officers may promote up to Hussar; Commanders may promote up to Officer. Members, Dragoons and squad leaders do not gain promotion rights.
- Promotions, demotions, warnings, discharge, officer panels, operations, training, tickets, kill counts, logistics and all existing consumers of `utils/ranks.js` share rank recognition.
- Existing explicit Manage Server and recruitment/trainer permissions remain feature-specific. Department leadership still only grants authority within its squad department/branch.
- Reaction-role panels cannot assign configured rank, qualification or squad leadership roles, including renamed roles.
- Other servers retain legacy name fallback until their IDs are configured and strict mode is enabled. A configured ID always takes precedence over a name.

Validation covers renamed roles, duplicate-name impostors, missing mappings, cross-server isolation, cleanup of renamed ranks and the existing promotion boundary matrix.
