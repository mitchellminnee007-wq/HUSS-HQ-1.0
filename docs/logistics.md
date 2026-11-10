# Stockpiles and logistics orders

The bot is a manual register. It never reads private inventory, moves goods, refreshes a reserve stockpile in Foxhole, or verifies a delivery screenshot. Record real counts and movements in Discord after checking the game.

## Access and setup

Officers and Commanders can manage stockpiles and create orders. You can additionally assign **Logistics Role** through `/config set-role`. Verified members can view stock and claim orders; only the assigned worker or logistics staff can update an order. Allies cannot access this register.

Choose **Members** or **Officers only** when creating a stockpile. Officer-only stockpiles and their linked orders are hidden from members, including the additional Logistics role. Only Officers/Commanders can create officer-only stockpiles or change visibility. Existing stockpiles keep member visibility until changed with `/stockpile visibility stockpile:<choose name> access:officers`.

Reserve access codes are required when creating a reserve stockpile. Public stockpiles do not require a code. Codes are available only to logistics staff who can view that stockpile, through an ephemeral `/stockpile code` reply. Codes do not appear in lists, the dashboard or the audit log. They are stored in the local bot data file, so server administrators and backups can access them.

## Member-facing browser

Staff can post `/stockpile panel` in a member-accessible channel. Its **Open stockpiles** button opens a private, role-filtered browser for each person. The shared message contains no inventory, codes or private stockpile names. Every authorized member can use it independently.

`/stockpile list` also opens the browser directly. Choose a name from the dropdown, filter by unit, and use **Previous**, **Next**, **Refresh** or **All stockpiles**. Staff see **Import contents**, **View code**, **Set code** and **Update timer** for reserve stockpiles. Imported zero rows stay hidden.

`/stockpile view` needs no ID: it opens the only accessible stockpile, or offers the browser if several exist. Other stockpile commands use a `stockpile` autocomplete field: type a name/location and choose a result. `/order create` also suggests source/destination stockpiles by name. Suggestions and every interaction recheck current access.

## Stockpile workflow

1. `/stockpile create`: enter name, location, building (depot, seaport or aircraft depot), public/reserve access, shard/war label and visibility. Include `code` for a reserve stockpile. Use the same shard/war label for related stockpiles.
2. `/stockpile count`: choose its name, item, unit and the total physically counted quantity. Reserved goods still present at the source belong in that count.
3. `/stockpile refresh`: enter the remaining reserve timer observed in game, in hours. This records an estimate only. Perform the actual refresh in Foxhole.
4. `/stockpile set-code`: replace the reserve code. `/stockpile code` retrieves it privately for staff with access.
5. `/stockpile list` and `/stockpile view` show reported stock, reservations and available quantities. Use `page` for larger lists.
6. `/stockpile archive confirm:True` hides an obsolete stockpile while retaining history. Finish or cancel linked orders first.

Units are distinct: crates, loose items, vehicles and shippable crates. The bot does not convert them or impose game-specific storage limits. Use consistent item names; exact matches in the bundled item catalogue are normalized.

## Import an export

After creating a stockpile, or from `/stockpile view stockpile:<choose name>`, click **Import contents**. Upload the original UTF-8 `.txt` or `.csv` export (maximum 256 KB), or paste a short list of `Item (Crate),quantity` rows. Choose one input method. Full exports exceed the 4,000-character text field, so use the upload field for them.

The full export must retain its location/timestamp header and five sections separated by blank lines: item crates, vehicles, crated vehicles, uncrated shippables, crated shippables. Uncrated shippables use the `items` unit; vehicle/shippable crates use `shippable_crates`. No crate-to-item conversion occurs.

Review the target stockpile, source header and row counts, then select **Confirm import**. Listed quantities are replaced, including zeros. Unlisted items, the reserve code and settings remain unchanged. Reserved quantities cannot exceed the imported stock; resolve conflicting orders first. If inventory/orders change during the preview, import again. Previews expire after ten minutes or a bot restart. Nothing is written before confirmation.

The inventory view hides zero-count rows but imports retain them. Imports and visibility are checked again when submitting and confirming; members cannot import inventory.

## Order workflow

Staff can post `/order panel` in a member-accessible channel. **Open orders** opens a private browser for each member, filtered by stockpile access. The shared panel contains no private order details.

Choose **Active orders**, **My orders** or **Completed / cancelled**, then select an order. Use the buttons to claim it, record pickups/production, deliver, return goods or cancel with a reason. Updates require the assigned worker or logistics staff. Forms recheck access and reject submissions if the order changed while they were open. Only eligible actions are shown; goods in transit must be delivered/returned before cancellation.

`/order list` and `/order view` open the same browser. The optional order selection in `/order view`, and the selection in `/order claim` or `/order update`, support autocomplete by item or destination. Staff still create new orders with `/order create`.

1. Staff use `/order create` for transport, frontline supply or production. Transport/frontline supply require a source with sufficient unreserved stock. Production has no source. Optionally select a registered destination to credit its inventory after delivery.
2. Members use `/order list`, `/order view` and `/order claim`.
3. `/order update action:pickup` removes goods from recorded source stock and marks them in transit. For production use `action:produce` after manufacturing the goods.
4. `action:deliver` records a full or partial delivery. Include a note identifying the recipient/location or linking evidence. A registered destination receives the delivered quantity.
5. `action:return` puts undelivered goods back into the source register. `action:cancel` requires a reason and no goods in transit. Remaining reservations are released.

Example: a source has 100 crates. An order for 60 reserves 60 and leaves 40 available. Picking up 40 leaves 60 physically present, with 20 still reserved. Delivering 25 credits 25 to the destination and leaves 15 in transit. Returning those 15 leaves 75 at the source, of which 35 remain reserved for the unfinished order.

`/botpanel` has a Logistics page with active orders, registered stockpiles and reported timers within six hours or overdue. Refresh the dashboard to update those figures. There are no automatic expiry DMs. Existing `/logitask` WHL requests remain separate; link them in order notes where useful.

## References

- [Foxhole Wiki: Stockpile](https://foxhole.wiki.gg/wiki/Stockpile)
- [Foxhole Wiki: Reserve Stockpile](https://foxhole.wiki.gg/wiki/Reserve_Stockpile)
- [Foxhole Wiki: Logistics](https://foxhole.wiki.gg/wiki/Logistics)
- [Official Foxhole War API](https://github.com/clapfoot/warapi/blob/master/README.md): public war/map data; no private stockpile inventory endpoint.

The wiki motivated the workflow, not an automatic game integration. Timer values are entered from the game rather than hardcoded from potentially outdated wiki limits.

## Item search

The item fields in /order create and /stockpile count offer autocomplete. Type part of an item name or catalogue category and select the exact name. Suggestions combine the bundled catalogue with names imported into stockpiles you can access. For transport/frontline orders, selecting a source and unit first restricts suggestions to available inventory and displays its quantity. Production uses catalogue/imported names without reserving a source. The catalogue is bundled, not a live feed of all Foxhole items.

