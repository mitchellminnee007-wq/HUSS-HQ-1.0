# Cargo loss reporting

Open an order directly or through a manifest's cargo selector. Choose **Report cargo loss**, enter the quantity in that order's units, and give a reason/location. A screenshot link may be included in the note.

Alternatively use `/order update id:<choose order> action:loss quantity:4 note:Truck destroyed near bridge`.

Only the assigned order worker or logistics staff can report a loss. Quantity must be a positive whole number no greater than cargo currently in transit. The report records the actor, quantity, timestamp and note in order history and the audit log. Old modal submissions cannot be applied again after an order changes.

Loss reduces in-transit cargo and increases the separate Lost total. Pickup already removed these goods from the source, so reporting loss never deducts them again, returns them, or credits the destination. Lost quantities count against the original order amount. Remaining uncollected cargo stays reserved; replacement goods require a new order and reservation.

When delivered plus lost equals the requested quantity, the order closes as **Completed with losses**, not Delivered. Losses also appear on the manifest checklist. Once all linked orders have been accounted for, Complete closes the manifest as **Completed with losses** if any cargo was lost. Old records without a Lost field are treated as zero losses.
