# Shipping manifests

Shipping manifests group up to 10 complete, unstarted orders into a truck, freighter, train or convoy shipment. They are manually managed planning records, not live Foxhole telemetry or vehicle-capacity calculations.

## Officers and logistics staff

1. Post `/manifest panel` in your logistics channel. Everyone opens a private browser filtered by access.
2. Use `/manifest create name:Supply run route:Origin → destination mode:truck`. The creator is shipment leader. Optional `visibility:officers` is available to officers only.
3. Use `/manifest link shipment:<choose name> order:<choose item>`. Search suggestions avoid typing IDs. An order may belong to only one active manifest, and must have no pickup, production or delivery recorded yet.
4. Use `/manifest unlink` before departure to remove cargo, provided none of that order is in transit.
5. Depart through the panel or `/manifest depart` after every linked order has been fully picked up/produced. Complete after all linked cargo is delivered or reported lost. Any loss closes the shipment as Completed with losses.
6. `/manifest cancel shipment:<name> reason:...` closes the manifest without cancelling orders or changing stock. First deliver, return or report the loss of any cargo in transit.

## Members

- Open the shared panel, or `/manifest list`. Choose a shipment; History lists closed ones.
- **Join crew** joins as Crew. `/manifest crew shipment:<name> role:Driver` selects Driver, Crew or Escort. Use Leave crew to withdraw. Up to 20 crew including the leader.
- Select cargo to open its existing order controls. Claim and record real pickup/production, partial delivery, return or cargo loss. Only the order's assigned worker or logistics staff can change cargo; crew membership does not grant extra order permissions.
- Refresh the manifest to see current order quantities. Use Back to return to the shipment browser.

## Inventory, access and maintenance

Order actions remain the only inventory-changing actions. Linking, departing and completing a manifest never reserve or deduct stock again. Each cargo line shows its own units and destination; quantities with different units are not combined.

A manifest is visible only if the viewer may access every linked order's source and destination. Linking restricted cargo can hide an otherwise member-visible shipment. Shared panels expose no cargo details. Permissions are checked again on every action. Shipment history survives restarts in the existing logistics data store; mutations are recorded in the audit log.

`/maintenance on target:Shipping manifests reason:...` pauses the new feature. Orders or Stockpiles maintenance also pauses manifests. Individual order actions remain available during manifest-only maintenance. `/botstatus` includes the manifest feature.
