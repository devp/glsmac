# local devp notes

needed to fix/remove old 2020 cxx version
sudo mv /Library/Developer/CommandLineTools/usr/include/c++ /Library/Developer/CommandLineTools/usr/include/c++.bak
after brew, cmake cmd -- make -C build -j8 (parallel)
brew install ninja ccache
rm -rf build
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_COMPILER_LAUNCHER=ccache
ninja -C build
sdl issues
ai trying vs sdl issues on mac
llm got mac build working

-----

(headless run happy path)

./build/bin/GLSMAC --gse-tests --gse-tests-script PATH/TO/FILE.gls.js --quiet

- Parses+runs any .gls.js, not just files in GLSMAC_data/tests/. Verified: rules.gls.js, factions.gls.js, resources.gls.js, units.gls.js, intro.gls.js all run clean standalone.
- main.gls.js / uidemo.gls.js fail outside real game: GSEReferenceError: Variable '#main' is not defined — engine registers #main only under real quickstart, not test harness. So pure logic/data files test fine standalone; anything calling engine-bound APIs needs the real game running.
- Errors report file:line, so still useful signal even on the ones that fail for missing engine bindings — parse/reference errors surface same way.
- --gse-prompt-js gives interactive REPL for one-off snippet checks.
- Full functional pass (with real #main, UI, etc) needs --quickstart — opens SDL window, not headless.

Test suite

Yes — GLSMAC_data/tests/*.gls.js, run via --gse-tests (no script arg = whole suite: types, functions, scopes, exceptions, includes, async, gc, benchmarks). Uses built-in test.assert(). Registered in src/gse/tests/Tests.cpp / Scripts.cpp, alongside C++-side GSE/Parser/Runner unit tests.

Gap: GLSMAC_data/default/*.gls.js (actual game logic) not covered by this suite at all — no assertions on faction/resource/unit data, no CI hook found for them.

LSP/linter value

Repo-wide grep: no .vim, .tmLanguage, or editor syntax defs for .gls.js — none exist. Editors likely treat it as plain JS, which'll misfire on GLSMAC-specific syntax (#main, #typeof, etc — hash-prefixed builtins aren't valid JS).

Given iteration loop is already ~instant (--gse-tests-script on one file), an LSP's main win wouldn't be the run-cycle — it'd be:
- correct syntax highlighting (kill false-positive JS errors)
- catch undefined-var/typo before you even run (parser already gives good file:line on run, so marginal)

Highest leverage single thing: a TextMate/tmLanguage grammar for .gls.js, not a full LSP.

(neovim)

1. Filetype → javascript
vim.filetype.add({ pattern = { ['.*%.gls%.js'] = 'javascript' } })
Gets you treesitter highlighting, indent, textobjects, folding for free — syntax is JS-close enough. Caveat: #main(...), #include(...), #uppercase(...) (hash-prefixed builtins) aren't valid JS tokens — treesitter-javascript will mark those as ERROR nodes (usually just odd highlight color, not broken parse of surrounding code). Only ~handful of these per file per grep above, tolerable.

2. Real diagnostics: wrap the binary as a linter via nvim-lint
Error format's exactly file:line:col — parser output already gives that. Custom linter def:
require('lint').linters.gls = {
  cmd = './build/bin/GLSMAC',
  args = { '--gse-tests', '--gse-tests-script', '$FILENAME', '--quiet' },
  stdin = false,
  ignore_exitcode = true,
  parser = require('lint.parser').from_pattern(
    '%[(.-):(%d+):(%d+)%]%s+(.+)',  -- adjust to actual error line format
    { 'file', 'lnum', 'col', 'message' }
  ),
}
require('lint').linters_by_ft = { javascript = { 'gls' } }  -- or gate on .gls.js pattern
Run on save (BufWritePost autocmd calling require('lint').try_lint()). No real LSP exists or is worth building — this gets you the same file:line feedback loop without leaving the editor. Note real error format was GSEReferenceError: ... \n\tat FILE:LINE: ... in my earlier test — check exact format before wiring the pattern, it wasn't a clean single-line [file:line:col].

3. Skip full LSP. Semantic completion/hover would need real GLSMAC API knowledge (Faction/Unit/etc classes) nothing currently encodes outside C++ source — not worth building for personal project scope.

...

No test.assert() here — misleading filename. Not a unit test, it's a map-population script ("for testing purposes" comment). Populates random units/bases when game runs — a manual playtest fixture, not part of --gse-tests suite (lives outside GLSMAC_data/tests/, and takes (game) — needs real running game, can't run headless like earlier examples).

Real asserts only exist in GLSMAC_data/tests/*.gls.js via test.assert().

Currently mocks only inject test object (test.assert) — no game/um/bm/tm mocks. So anything under default/game/ that takes (game) (rules, events, unit spawning logic) can't run standalone at all, headless or otherwise — only real --quickstart exercises it, and that's manual/visual, not assertable.

To close it: extend src/gse/tests/mocks/ with a fake game object (stub get_players(), get_um(), get_bm(), get_tm(), event(), random, etc, returning canned/deterministic data), then add a GLSMAC_data/tests/ script that calls those default/game/*.gls.js entry points with the mock and asserts on results. Same pattern as Test::AddMocks, just a second mock module.

Scope call: worth it if you're touching default/game/ logic often; skip if changes there are still infrequent/exploratory — --quickstart + eyeballing may stay cheaper than building+maintaining game-state mocks.

-----

REMINDER: standard glsjs working loop (red-green-refactor)

.gls.js files are plain data, read fresh off disk each run — no compile/cache step, no C++ rebuild needed for script-only changes.

1. red/green on pure logic/data files (rules, factions, resources, units, intro, etc): edit script, rerun
   ./build/bin/GLSMAC --gse-tests --gse-tests-script PATH/TO/FILE.gls.js --quiet
   add/adjust test.assert() calls, iterate — fast, headless, no window.
2. for anything touching engine-bound stuff (#main, game/um/bm/tm, event()) that the headless mock can't fake: just launch real game
   ./build/bin/GLSMAC --quickstart
   change picked up next launch, no rebuild — confirm behavior in-game (manual/visual, not assertable yet, see mocks gap above).
3. refactor once green, rerun same command to confirm still green.
4. whole-suite check before calling it done: --gse-tests with no script arg (runs GLSMAC_data/tests/* built-in suite).

-----

BUG: compound-assign (+=, -=, *=, /=, %=, also ++/--) on object/array members throws — C++ fix, not gls.js

Symptom: `result.ENERGY += 1` in GLSMAC_data/default/resources.gls.js:65 throws REFERENCE_ERROR. Workaround in that file today: `result.ENERGY = result.ENERGY + 1`.

Root cause: src/gse/runner/Interpreter.cpp:562-659. Every compound-assign op (OT_INC_BY +=, OT_DEC_BY -=, OT_MULT_BY, OT_DIV_BY, OT_MOD_BY) is generated by the MATH_OP / MATH_OP_BEGIN macros (this block, second definition — there's an earlier MATH_OP for unary ++/-- at line ~490-560, separately #undef'd). Each macro body opens with:
  EvaluateVarName(ctx, ep, expression->a)  -- line 564 / 573 / 593
  → EvaluateVariable (line 1083-1088): hard-asserts operand->type == Operand::OT_VARIABLE, else throws REFERENCE_ERROR "Expected variable, found: ..."

`result.ENERGY` parses to Operand::OT_EXPRESSION (member access), not OT_VARIABLE → throw.

Compare plain `=` (OT_ASSIGN, line 451-457): has its own Operand::OT_EXPRESSION case — evaluates target as reference via EvaluateExpression, then WriteByRef(ctx, ..., target, result). That's the path that needs to exist for compound-assign too and doesn't.

Fix shape (not yet written — hand-write from here):
- Need MATH_OP/MATH_OP_BEGIN's variable-read and variable-write steps to go through the same OT_EXPRESSION/WriteByRef path OT_ASSIGN already has, not just EvaluateVarName+ctx->GetVariable/UpdateVariable.
- WriteByRef signature/behavior: see line 455 call site + its definition (grep WriteByRef in Interpreter.cpp) — takes a resolved reference target + value.
- Reading the current value for the op (a->type checks etc) needs the equivalent "evaluate as reference, deref" path (EvaluateExpression + Deref, same as OT_ASSIGN's target eval), not ctx->GetVariable which only works for named vars.
- Affects 5 call sites (INC_BY/DEC_BY/MULT_BY/DIV_BY/MOD_BY) + arguably OT_INC/OT_DEC (++/-- , separate earlier macro block ~line 490-560, same EvaluateVarName dependency) — fix once, ideally shared with OT_ASSIGN's branch rather than re-duplicated per macro (see "why macros" note below).
- MOD_BY is float-int only today regardless (MATH_OP_BEGIN, no _F variant) — separate, smaller gap, not in scope unless you want it.

Blame history (git blame confirms — not a regression, asymmetric since day one):
- Both OT_ASSIGN's OT_EXPRESSION branch AND EvaluateVariable's OT_VARIABLE-only ASSERT originate in the same commit: 7a419fb18 (2023-12-24, "GSE: interpreter runner (+ test) mostly done") — first interpreter commit. `=` and `+=` never agreed, ever.
- 70fcd15fc (2024-01-17, "fixes, converted remaining asserts into gse exceptions") only turned the pre-existing ASSERT(operand->type == OT_VARIABLE) into the current thrown REFERENCE_ERROR — same restriction, not new.
- Later touches to these exact lines are all incidental churn, never revisited the gap itself: 19619332d (2025-01-30, stacktraces/ep param), edde1258a (2025-02-19, Value→raw pointer for GC), 17524d9ce (2025-02-20, GC space plumbing), a643935bb (2025-03-25, newgc mt fixes), f0a84c727 (2026-01-11, added VT_INT type-check in MATH_OP).
- `git log --grep` across src/gse for compound-assign/+=/member-assign: nothing. Never filed as an issue.

Why macros, and the cost of that here: this switch-over-opcode style (macro-generated near-identical case bodies) is normal for hand-rolled interpreters (cf. CPython ceval.c), and this file scopes macros tightly (#define right before use, #undef right after — not leaked). But it's exactly why the OT_ASSIGN fix never propagated to compound-assign: the shared EvaluateVarName call lives inside macro text, textually distant from OT_ASSIGN's case body, so "does this op support member targets" isn't visible at any single call site without mentally expanding the macro. A shared helper function (template or plain, taking a BinaryOp) would make both paths converge naturally instead of silently diverging.

Test target once fixed (see SCRIPTABLE-TASKS.md "Blocked on engine" row for resources.gls.js:65): assert obj.prop += 1 and arr[i] += 1 both work (gse::tests C++ case or GLSMAC_data/tests/*.gls.js); regression-check resources.gls.js by mocking game.get_tm().on() to capture the get_tile_resources callback, call with a river tile, assert ENERGY == 1 after swapping the workaround back to real +=.
