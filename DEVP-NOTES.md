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

performance note:

Biggest cost — state thrashing per draw call
graphics/opengl/actor/Mesh.cpp:272-281 (also Sprite.cpp:111) — every actor draw does full bind→draw→unbind-to-0: glUseProgram(sp)...glUseProgram(0), same for texture, VBO/IBO. No dirty-check against currently-bound state across actors. Actor list z-sorted (Scene.cpp:214) but not grouped by shader/texture — so order doesn't help either. This is the classic 2D-engine perf killer: driver overhead scales with state-change count, not fill rate. Fix = track last-bound program/texture/buffer globally, skip redundant calls, sort draw list by shader then texture within z-layer.
