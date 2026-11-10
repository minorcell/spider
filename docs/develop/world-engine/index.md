# World simulation engine

## What changes in the game

An apple currently leaves the ground-object collection when the spider picks it up. Ground physics and the tether code then apply different rules to the same object. A tethered apple should still collide with a stone or the nest, roll on release, and retain its bite progress and age. The same behaviors should work for another registered food without a new path through the engine. [Current world data](../../../src/shared/state.ts) · [Current session](../../../src/shared/sim/session.ts)

This proposal defines one integrated redesign of the simulation core, its browser adapter, and its save format. The island remains continuous terrain. Existing movement, sight, water, gait, tool calls, local persistence, and cloud sync are part of the contract. Apple behavior uses six bites and the smaller physical and visual size described below.

## Ownership and dependencies

| Owner           | Authoritative state                                                                        | Contract                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| World           | Terrain, clock, entity identity, relationships, population rules and marks                 | [World](./module_World.ts)                                                  |
| Physics space   | Position, orientation, velocity, contact results and the spatial representation of tethers | [Physics](./module_Physics.ts)                                              |
| Runtime entity  | Per-instance behavior state such as completed bites, lifetime thresholds and hunger        | [Entity](./module_Entity.ts)                                                |
| Content catalog | Shared definitions and factories keyed by stable namespaced ID                             | [Content](./module_Content.ts) · [Registry](./base.ts)                      |
| Action executor | Command admission, arbitration, active action progress and terminal results                | [Action](./module_Action.ts)                                                |
| Browser host    | Animation timing, visibility, tool promises, write leases, and checkpoints                 | [Host example](./feature_BrowserHost.ts) · [Snapshot](./module_Snapshot.ts) |

World is the only writer at the public boundary. It owns the physics writer and provides actions with a scoped interaction interface. An entity can change its own behavior state and propose a motion. Physics commits the actual pose. Terrain, fixed scenery, dynamic objects, and the driven spider enter the same spatial queries. Motion, visibility, and selection can filter different shapes from those queries.

The world uses one ID index. A tether is a relation between two IDs. Static, dynamic, and driven bodies differ in how they respond to forces and controller inputs. A driven body still queries and collides with the rest of the space. Its leg solver and visual rig can consume support and contact results without owning the body transform. Terrain generation and rendering continue to use the height field; body and visibility queries derive their geometry from that same terrain and the entity definitions.

The engine exposes committed projections. UI, Agent, and rendering receive those values and events. They cannot mutate live entities or call physics writers. A view may share read data within one publication; consumers that need an independent copy use the snapshot boundary. Three.js objects remain in the browser's model and animation code.

## What one world update guarantees

[World step example](./feature_WorldStep.ts) shows the calls and the order in which their effects become visible. These are runtime semantics.

- One fixed step advances simulation by **1/60 second**. The browser supplies one wall timestamp for a batch of steps. It runs at most three steps per animation callback and discards excess accumulated time. Needs and respawn advance with the steps that actually ran. A hidden page or held write lease suspends advancement. Resume reconciles real-time expiry before movement can run.
- Expiry is processed before movement and action settlement. Then the world advances population timers, admits eligible actions, collects proposed motion, solves contacts and constraints, and settles actions against the committed physics state. Readers and save requests see the result only after the transaction.
- Commands have a stable ID and one terminal event. For each actor, the most recently submitted user command supersedes older work when admitted. An autonomous command can run only while the actor is idle and autonomy is allowed. The browser reserves the actor while handling a user turn, including time spent waiting for the model. Cancel is a world transaction that advances neither clock. A cancelled command cannot commit another bite or change a tether.
- Removal detaches every relation involving the removed ID and retires unfinished commands that refer to it. The resulting events and view are published together. The final bite completes its own command before removal invalidates any other references. A target expiring at the same update as a due bite is removed before that bite and grants no nutrition.
- A visibility or lease change discards the animation accumulator. Each completed world update delivers its events even if drawing is throttled. The host resolves a tool promise by command ID from the same committed frame it uses to compose the tool response.

## Interaction examples and decisions

### Carrying is a constraint

When the user picks up a reachable object, the executor checks that it is live, tetherable and available. An actor can hold up to seven tethers. The world adds a relation from a mount on the carrier to the target, using their committed poses. The solver applies tension when stretched and leaves the tether slack otherwise. The fruit remains in the spatial index with its own collision body. It can hit a wall, be held against it or slide around it as the carrier moves.

A plain release removes the constraint and preserves pose and velocity. The existing `drop` tool requests placement in front, and `store` requests a valid position inside the nest. Both use the same collision query and detach only after placement is accepted. A blocked placement retains the tether. The return value and sound follow the committed result. [Release and bite example](./feature_Interactions.ts)

The tether computes a spring-damper impulse at the mount. Apply that impulse, gravity, and buoyancy to the target before sweeping its proposed motion through terrain and entity colliders. Resolve velocity at contact so resting and sliding behave the same with or without a tether. A wall hit never triggers a second position update from the action layer. The driven spider supplies its mount trajectory and uses the same space to solve its own movement. Reuse the existing support, flotation, and loose-body contact math through these interfaces. [Tether impulse example](./feature_TetherPhysics.ts) · [Existing loose-body solver](../../../src/shared/sim/physics.ts)

### Content and behaviors are registered independently

At startup a world registers entity factories, item definitions, placement policies and population rules. Definitions are shared and immutable once the world starts. `DroppedItem` owns per-fruit progress and lifetime and exposes a food capability when its definition supplies one. `Spider` owns its needs and control behavior. The action executor depends on these capabilities and instance IDs. The model registry resolves the appearance ID separately.

The apple uses a sphere of radius 0.1944, mass 0.025, and the current proposed model scale of 0.54. Its six bites take half a simulated second each, with 10 points of hunger relieved per completed bite. Hunger starts at 25, rises one point per six simulated seconds up to 100, and allows idle foraging at 60. Nearby fresh food and food already tethered to the spider take priority over a path toward a visible fruit. The common reach and visibility logic applies to the same world view used by Agent tools. The executor schedules each bite at an integer tick boundary by rounding its duration up to a whole step. It revalidates the actor, target, freshness, and reach at that boundary. Partial progress inside an interrupted bite is discarded.

New apples last 720 seconds of device time and spoil during the last 90 seconds. Stagger the initial batch in 24-second increments so the first group does not disappear together. Tethering, placing, or partial eating preserves a fruit's deadline. The world population rule caps ground apples at 20 and attempts a spawn after 24 active seconds below that cap. At the cap, reset the countdown to the full interval. Failed placement consumes an attempt, so reload cannot reroll it. The seed, rule ID, and attempt counter select each attempt's random stream. [Apple definition and second-food example](./feature_RegisterContent.ts)

### Save/load has a distinct ownership boundary

The world checkpoint saves the ID allocator, simulation time, bodies, instance data, tethers, population counters, and marks. The browser's existing checkpoint envelope owns sequence, owner, lease, and pending instruction text. It also manages the existing checkpoint cadence. Semantic changes such as completed bites, removals, and tether changes are dirty events. Idle motion still uses checkpoint coalescing. A saved pending instruction can be offered to the user after restart; in-flight commands and promises belong to the current session.

The new local envelope uses format 4 and the cloud envelope uses format 2 under the existing world key. Both accept the currently shipped formats on read. Compare local checkpoints using the existing sequence and timestamp rules. Cloud writes retain lease ownership and ETag preconditions. An unsupported format or unrecognized type leaves the existing checkpoint intact and blocks a replacement from that input. An older client encountering a newer cloud envelope follows its existing parse-error path for an existing object. Stale ETags prevent a pre-upgrade writer from replacing that object.

For older saves, keep entity IDs, the stored world seed, marks, position and orientation. Rebuild scenery with the existing compatibility rules. Merge ground and carried entries into one index and reconstruct the saved order of tethers. Carrying can influence rest lengths; reconstruction uses that order and saved positions. Preserve old bite fractions, translating one or two completed bites from the three-bite format into two or four. A legacy apple without a deadline receives its staggered initial deadline when a compatible checkpoint is first restored. A saved deadline takes precedence. Preserve saved hunger and timers when present, and use the starting value for records that predate hunger.

Decode and build a candidate world before publishing it, changing the active host, or writing a new checkpoint. Validate duplicate IDs, missing endpoints, registered types, numeric fields, and the controlled actor. When the browser has write authority, reconcile real-time expiry on the candidate before publishing its first authoritative frame. For a cloud adoption, commit the accepted checkpoint and its memories in the same IndexedDB transaction. Publish the new world and refresh the browser recovery copy after that commit. A failed restore retains the last good checkpoint and memories. [Restore and legacy apple example](./feature_Restore.ts) · [Existing local format](../../../src/shared/sim/snapshot.ts) · [Existing cloud reconciliation](../../../src/client/cloud/engine.ts)

## Acceptance scenarios

| Situation                                                                                                      | Observable result                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push an apple, attach a tether, pull it into a wall, and release                                               | The body keeps its ID, collider and velocity state. The wall blocks it while tethered. Releasing it applies no teleport or reset.                                                                     |
| An apple rots before the next bite, expires as the last bite becomes due, or disappears while being approached | The action returns `spoiled` or `stale-target` as appropriate. Only earlier committed bites affect hunger. The view and events agree about presence and tether state.                                 |
| Finish eating a held apple                                                                                     | The last bite grants nutrition once, the command succeeds once, and the apple and tether disappear in the same publication.                                                                           |
| Submit a user command during a foraging action                                                                 | The autonomous command terminates, no subsequent autonomous bite commits, and the user's result arrives through the same command channel.                                                             |
| Save on Monday, reopen Friday                                                                                  | Apples with expired real deadlines disappear before the first authoritative frame. The saved hunger and population countdown resume from their stored values. Include held and partially eaten fruit. |
| Load malformed data or a checkpoint with an unknown type                                                       | No partial candidate or writes replace the previous world. The user receives an actionable failure.                                                                                                   |
| Register the pear scenario                                                                                     | Only definitions and appearance are added. Shared physics, actions, persistence, and simulation support the different bite count, nutrition and time domain.                                          |
| Compare existing behavior and performance                                                                      | Exercise current tools, land and water locomotion, sight and restore against the existing tests. Compare the current frame, route, and snapshot benchmarks and measure event dispatch separately.     |

## Reviewing the proposal

The TypeScript modules are the proposed interfaces. The `feature_*.ts` files are reviewable examples of calls and transactions against those interfaces. The examples type-check together and are separate from the application build.

```sh
pnpm exec tsc -p docs/develop/world-engine/tsconfig.json
```

The documentation format follows Builder's routing and editor designs, which keep contracts and worked interactions together. [Builder routing proposal](https://github.com/goplus/builder/pull/1799) · [Builder editor proposal](https://github.com/goplus/builder/pull/1087)
