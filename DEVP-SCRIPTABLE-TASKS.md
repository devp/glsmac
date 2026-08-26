# Scriptable tasks (GLSMAC_data/default)

Derived from `TODO` grep across `GLSMAC_data/default/*.gls.js` + README roadmap. Test-target notes assume the headless runner (`./build/bin/GLSMAC --gse-tests --gse-tests-script FILE.gls.js --quiet`) and `test.assert()` harness — see [[test-infra-gap]] below for what's missing to actually run them.

## Easy (small, isolated, cosmetic/mechanical)

| Task | Location | Test target |
|---|---|---|
| `lobby.gls.js` top:0 mystery offset | `ui/styles/lobby.gls.js:43` | Visual only, no script-level assertion |
| color required else breaks | `ui/styles/lobby.gls.js:52` | Visual only |
| `.lines.remove()` should be `.lines.clear()` | `tile_preview.gls.js:97`, `object_preview.gls.js:66` | Visual only (UI widget state) |
| non-bold font looks bad | `popup/base_screen.gls.js:55` | Visual only |
| vertical centering broken | `popup/base_screen/bottom_bar/middle_area.gls.js:34` (`align: 'top center'`) | Visual only — **caveat:** `ALIGN_VCENTER = ALIGN_TOP\|ALIGN_BOTTOM` (`src/ui/geometry/Geometry.h:50`), so `'top center'` already bitwise-equals `'center'` — swapping the string is a no-op, not the fix. Traced the centering formula (`Geometry.cpp:363-366`) and it looks structurally correct for this object; didn't confirm an actual visible bug without running it. Repro in-game before assuming this is a one-line fix — may be a `m_height`-captured-before-text-is-set timing issue (`text` set later at `middle_area.gls.js:122`, not in the initial literal) rather than an align typo |
| resize event doesn't fire while hidden | `info_panels.gls.js:53` | Visual only |
| menu entry const capture | `menu.gls.js:78` | Visual only |
| difficulty_level scoping workaround | `select_difficulty_level.gls.js:4` | Visual only |
| objects_list active-border async workaround | `objects_list.gls.js:220` | Visual only |
| `0.0 - ...` / `0 - 1` cleanup | `resource.gls.js:91,188` | Style only, no behavior change expected — assert output identical before/after if touching `find_best_or_worst_tiles` |

Most of this tier is UI/CSS — not unit-testable through GSE headless mode (no DOM/render assertions in the harness). Good onboarding tickets regardless.

## Blocked on engine (looks scriptable, isn't)

| Task | Location | Why it's actually a C++ fix |
|---|---|---|
| Fix `+=` broken on property | `resources.gls.js:65` (`result.ENERGY = result.ENERGY + 1`) | Root cause is `src/gse/runner/Interpreter.cpp:562-659` — the `MATH_OP`/`MATH_OP_BEGIN` macros backing every compound-assign op (`+=`, `-=`, `*=`, `/=`, `%=`, also `++`/`--`) call `EvaluateVarName()` → `EvaluateVariable()` (`Interpreter.cpp:1083-1088`), which hard-asserts the LHS is `Operand::OT_VARIABLE` and throws `REFERENCE_ERROR` otherwise. `result.ENERGY` is a member-access expr (`Operand::OT_EXPRESSION`), not a plain variable, so `+=` throws. Plain `=` (`OT_ASSIGN`, `Interpreter.cpp:451-457`) has a separate `OT_EXPRESSION` branch that evaluates the target as a reference and calls `WriteByRef` — that's why the workaround (`=` instead of `+=`) works and nothing in `.gls.js` can fix this. Real fix: give `MATH_OP`/`MATH_OP_BEGIN` the same `OT_EXPRESSION`/`WriteByRef` branch `OT_ASSIGN` already has. Affects every compound-assign op on object/array members, not just this one call site. **Test target (once fixed, C++ side):** add a `gse::tests` case (or `GLSMAC_data/tests/*.gls.js`) asserting `obj.prop += 1` on both an object member and an array element; regression-test in `resources.gls.js`: mock `game.get_tm().on()`, call the captured `get_tile_resources` callback with a river tile, assert `ENERGY == 1` after switching the workaround back to real `+=` |
| `width:210` ignored on base-screen buttons | `popup/base_screen/buttons.gls.js:16` (class `base-screen-popup-bottom-button` extends `game-popup-button`) | Not a simple property typo — root cause is a stick-bit collision in `src/ui/geometry/Geometry.cpp:55-114`. `left`/`right`/`width` are mutually exclusive via `STICK_LEFT`/`STICK_RIGHT`/`STICK_WIDTH` bitflags; `SetRight()` (`Geometry.cpp:85-95`) collaterally clears `STICK_LEFT|STICK_WIDTH` whenever `STICK_LEFT` is currently set, not just when width itself conflicts. Parent class `game-popup-button` sets **both** `left:padding` and `right:padding` (`popup/popup.gls.js:72-76`) — already over-constrained on the horizontal axis before the subclass's `width:210` (`buttons.gls.js:16`) or the instance's own `left:3` (`buttons.gls.js:20-26`) enter the picture. Compounding factor: both `ui::properties_t` (`src/ui/Types.h:26`) and `gse::value::object_properties_t` (`src/gse/value/Types.h:14`) are `std::map<std::string,...>`, so every `.gls.js` object literal applies **alphabetically by key**, not in declaration order — true of every `.set({...})`/factory call in the UI layer, not just this file. Whether `width:210` survives depends on exact interleaving of the class property cascade (`Class::UpdateObject` → `Object::SetPropertyFromClass`, `Object.cpp:788-804`) against when the instance's manual `left`/`width` get registered into `m_manual_properties` (the guard meant to protect them, `Object.cpp:794`) — traced multiple plausible timings from static reading, they don't agree, so the exact trigger point (`Object.cpp:~448-470`) is still unconfirmed. **Not scriptable** — real fix is either not setting both `left` and `right` on `game-popup-button`, or fixing the manual-properties guard timing so the class cascade can't collaterally clear stick bits the instance already set. Confirming the precise trigger needs a temp `Log()` in `Geometry::SetLeft/SetRight/SetWidth` + rebuild + run, not done yet. |
| `_hover`/`_active` without class | `mini_map.gls.js:73,141`, `popup/base_screen/bottom_bar/middle_area.gls.js:47` | Confirmed structural, not a `.gls.js` fix. Hover/active state is 100% class-driven: `Object::AddModifier`/`RemoveModifier` (`src/ui/dom/Object.cpp:611-621`) only walks `m_classes`, calling `Class::AddObjectModifier`. The `_hover`/`_active` → subclass routing (`s_name_to_modifier`) exists only in `src/ui/Class.cpp:9-15,314-324` — `Object.cpp` has no equivalent path for reading `_hover`/`_active` off an object's own instance literal directly. Real fix: add a modifier-property path on `Object` itself (new C++), so inline `_hover:{...}`/`_active:{...}` work on any object without requiring a named class first. |

## Medium (real logic, room to explore)

| Task | Location | Test target |
|---|---|---|
| Fungus-tile resource yields (3 stubs) | `resources.gls.js:41,57,74` | New `GLSMAC_data/tests/resources.gls.js`: mock `game.get_tm().on()` to capture the `get_tile_resources` callback, call it with fake `e.tile` objects (`features.xenofungus: true`, varying `rockiness`/`moisture`/`bonuses`), assert NUTRIENTS/MINERALS/ENERGY per case |
| Tech-based resource limitations | `resources.gls.js:95` | Same harness, add `e.tile` + fake tech-state input, assert yields clamped once a tech gate exists |
| Reuse terraforming logic for base-tile floor | `resources.gls.js:79` | Same harness: assert `get_base() != null` branch floor values (`NUTRIENTS>=2`, `MINERALS>=1`, `ENERGY>=1or2`) stay correct after refactor — this path is implemented today with **zero** test coverage, cheap first test to write |
| Base energy/ecodamage placeholders | `popup/base_screen.gls.js:142-143` | UI-bound, needs base-screen data mock — lower priority to unit test |
| Base "producing" line stub | `object_preview.gls.js:116` | UI-bound |
| Talents logic in base pop growth | `bases.gls.js:116` | Needs fake `base`/`pop` objects once talents land — assert growth delta per talent type |
| Base production-value formula | `bases.gls.js:30` (`get_tile_score`) | Pure function: fake `base.get_owner()` + `tile.get_resources()` returning canned `{NUTRIENTS,MINERALS,ENERGY}`, assert weighted score. **Pin current formula (`N*3+M*2+E`) as a baseline test before changing it** so the diff is provable |
| Base supported-units accounting | `bases.gls.js:212` | Fake base + unit list, assert count/limit once implemented |
| `game_settings` event: support all fields | `game/event/game_settings.gls.js:33,35` | Fake `e.data` with known + unknown field, assert known fields update and unknown fields rejected (pin today's silent-drop behavior first, then flip once "support all fields" lands) |
| Excessive unwork/work event churn | `resource.gls.js:150` | Counter-based test: mock event bus, assert `work`/`unwork` fire count for a given tile-reassignment sequence, catch regressions in the optimization |
| `world/default.gls.js` mapgen pass | `game/world/default.gls.js:19` | Needs `tm` mock (map width/height, tile placement) — blocked on [[test-infra-gap]] |
| Tile hint text stubs | `tile_preview.gls.js:111,113,115` | UI-bound |
| Rules/faction selection step | `select_rules.gls.js:6,7,11,12,16` | UI-bound, needs mainmenu step-flow mock |
| Multiplayer game settings screen | `game_settings.gls.js:31,44` (UI file, not the event file) | UI-bound |
| `psych.gls.js` / `support.gls.js` panels | both `:9` | UI-bound |

## Difficult / blocked

| Task | Location | Why blocked | Test target |
|---|---|---|---|
| Non-native combat, marine, bombardment | `attack_unit.gls.js:5,14,18,27,64,68,74` | `is_native` hardcoded true; bombardment hard-rejected at validate | `get_unit_attack_power`/`get_unit_defence_power` aren't exported — pull them into the return object first so tests can reach them, then: assert land vs non-land multiplier, morale 0..6 sweep, **as a baseline before the non-native branch is added**. Separately: `validate()` has 8 distinct rejection paths (same-tile, locked×2, immovable, no-movement, land-attacks-water, water-attacks-land, artillery-direct) — currently 0 assertions on any of them, cheap to add now regardless of the TODO |
| Roads movement modifier | `move_unit.gls.js:8` | Depends on tile road-state existing | Once implemented: fake tile with `features.road`, assert movement cost reduction |
| ZOC | `move_unit.gls.js:88` | New rule, multi-tile design | Fake tile + adjacent enemy unit, assert move rejected/allowed per ZOC rule once defined |
| Non-native unit flag (move+attack) | `move_unit.gls.js:2,27` | Same root cause as combat | Shared fixture once flag exists — reuse across move + attack test files |
| Rollback correctness in multiplayer | `attack_unit.gls.js:178` | Needs real multiplayer run, not scriptable in isolation | Not GSE-testable; needs manual 2-client repro |
| `advance_turn` rollback (`#print` stub) | `advance_turn.gls.js:21` | Rollback semantics undefined | Define semantics first — no test target until then |
| `game/game.gls.js` refactor into modules | `game/game.gls.js:3` | Structural, cross-cutting | Not itself testable, but is the natural time to backfill tests for whatever it exposes as it splits into modules |
| Fungus/terraforming full logic | `resources.gls.js:79,91` | No `terraform` event registered in `events.gls.js` — needs C++ side first | Same harness as other `resources.gls.js` cases once the event exists |

## Suggested tasks beyond the TODOs (from README roadmap)

v0.4 target: turns, scout/former/colony-pod units, recycling tanks, centauri ecology tech, land bases, farm/mine/solar terraforming, combat, conquest victory.

- **Farm/mine/solar terraforming as an actual tile-improvement action** — `resources.gls.js` only reads tile state, nothing writes it. No event hook exists yet — same C++ blocker as fungus/terraforming above. Raise on Discord before starting.
- **Conquest victory condition** — check whether any win-condition event exists; if not, scriptable once base elimination is tracked. Test target: fake `bm` with all-but-one-player's bases removed, assert victory event fires.
- **Centauri Ecology tech gate** on nutrient/mineral bonuses — same piece of work as `resources.gls.js:95` tech-based limitations.
- **Recycling tank building effect** on `bases.gls.js` production math — same shape as the `get_tile_score` TODO. Not confirmed as an existing stub; grep `bases.gls.js` for building-effect hooks before picking up.

Didn't verify the last four against confirmed TODO markers — inferred from roadmap text.

## Test infra gap {#test-infra-gap}

From prior investigation (`DEVP-NOTES.md`):

- `GLSMAC_data/tests/*.gls.js` run via `--gse-tests`, registered in `src/gse/tests/Tests.cpp`/`Scripts.cpp`. Real `test.assert()` coverage exists only for GSE language features (types, functions, scopes, exceptions, includes, async, gc) — **zero coverage of `GLSMAC_data/default/` game logic**.
- Pure-logic/data files (no engine-bound API calls) parse and run standalone under `--gse-tests-script FILE.gls.js` — confirmed for `rules.gls.js`, `factions.gls.js`, `resources.gls.js`, `units.gls.js`, `intro.gls.js`. This is necessary but not sufficient: parsing clean doesn't assert on behavior, since `resources.gls.js`'s `configure()` only registers a callback, it doesn't invoke it.
- No `game`/`um`/`bm`/`tm` mocks exist in `src/gse/tests/mocks/` (only a `test` mock). Anything taking `(game)` and calling engine-bound methods can't be exercised headless at all today.
- **Cheap path forward** (what most rows above rely on): most of the flagged functions are either pure (`get_tile_score`, `get_pending_growth`) or register a single callback (`resources.gls.js configure()`, `game_settings.gls.js`) — these need only a hand-rolled object literal mock (`{ get_tm: () => ({ on: (name, fn) => { captured = fn } }) }`), not a full engine mock. Worth writing a small shared `GLSMAC_data/tests/mocks.gls.js`-style helper for this pattern before starting the resource/combat test files above.
- **Expensive path** (needed for `bases.gls.js` talent/growth logic, `world/default.gls.js`, ZOC): a real fake game object per `DEVP-NOTES.md`'s suggestion (`src/gse/tests/mocks/`, C++ side) — worth it only if touching `default/game/` becomes frequent.

## README Amendment

### Contributions: scriptable tasks, ready for work

These are gaps in `GLSMAC_data/default/*.gls.js` that are self-contained (no engine/C++ changes needed) and ready to pick up:

- **Terraforming tile-resource logic** — `resources.gls.js` (fungus tiles, terraforming modifiers, tech-based limits all stubbed, search for `TODO`)
- **Combat power/damage formulas** — `game/event/attack_unit.gls.js` (native-unit-only placeholder math; no non-native units, no bombardment, no marine attacks)
- **Base stats placeholders** — `ui/parts/game/popup/base_screen.gls.js` (energy/ecodamage hardcoded to 0)
- **`game/game.gls.js` refactor into modules** — structural cleanup, not a feature, but a good way to learn the codebase

Note: original SMAC's exact formulas aren't in this repo (no disassembly, see Copyright disclaimer below) — you'll need to source them yourself (community wiki, strategy guide, or testing against real SMAC).

If your task needs a mechanic with no event hook yet (production, tech/research, terraforming-as-an-action) — check `GLSMAC_data/default/game/events.gls.js` first; if it's not registered there, it needs a new event wired on the C++ side before it's scriptable. Ask on Discord before starting one of these.
