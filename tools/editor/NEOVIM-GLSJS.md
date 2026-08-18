# gls.js editor support — spec

Scope: `.gls.js` (GSE — GLSMAC's embedded script language) is JS-*shaped* but not
JS. Goal: real syntax highlighting in neovim, zero LSP/formatter attach, plus a
few affordances. Three repos touched: this one (facts + fork lives here or a
sibling repo), a new tree-sitter grammar fork, and `~/.config/nvim` (dotfiles).

## Decisions

- Highlighting: fork `tree-sitter-javascript`, don't hand-roll a grammar from
  scratch — GSE is JS syntax plus one addition (`#`-prefixed builtins), not a
  different language.
- Custom parser/language name: `gls_js` (not `javascript`) — must not shadow
  the real JS/TS parser used elsewhere in the dotfiles.
- Filetype: `glsjs` (not `javascript`) — this is the single lever. Every
  server in `lua/plugins/lsp.lua` (`tsgo`, `eslint`, ...) attaches via
  nvim-lspconfig's default `filetypes` list, which is keyed off
  `vim.bo.filetype`. `glsjs` isn't in any of those lists → nothing attaches,
  no exclusion code needed. Same story for `conform.lua`'s
  `formatters_by_ft` (prettier won't run — arguably correct anyway, prettier
  will likely choke on `#foo(...)` since it's not valid JS to its parser
  either, untested).
- Wire highlighting via core `vim.treesitter.language.register()` +
  `parser/gls_js.so` dropped on runtimepath, not nvim-treesitter's
  parser-registry API. Their `nvim-treesitter` is pinned to `branch = "main"`
  (their own comment: "the rewrite" — API still moving). Core API is stable
  and this feature doesn't need `:TSUpdate` auto-management.

## Task A — fork tree-sitter-javascript for `#builtin` syntax

Verified root cause (`src/gse/parser/JS.h:98-109`, `src/gse/context/Context.cpp:123`):
`#` is not special lexer punctuation — it's an accepted identifier-leading
char, reserved by convention for engine builtins (`Context::CreateBuiltin`
auto-prefixes every native with `#`). Upstream tree-sitter-javascript only
allows a bare `#ident` inside `class_body` (private fields) — `#main(...)` at
top level is an `ERROR` node today.

1. `git clone https://github.com/tree-sitter/tree-sitter-javascript
   tree-sitter-gls-js` (local dir is fine, no need to publish).
2. In `grammar.js`: add
   ```js
   builtin_identifier: $ => /#[A-Za-z_][A-Za-z0-9_]*/,
   ```
   and add `$.builtin_identifier` to the `primary_expression` choice list.
   `call_expression`'s `function` field already accepts any
   `primary_expression`, so `#main(fn)` / `#include('x')` / `#typeof(x)`
   should parse as ordinary call expressions with no further grammar changes.
3. `tree-sitter generate`, then acceptance check:
   ```sh
   tree-sitter parse GLSMAC_data/default/main.gls.js GLSMAC_data/default/factions.gls.js \
     GLSMAC_data/default/game/world/test.gls.js GLSMAC_data/tests/*.gls.js | grep ERROR
   ```
   Pass = empty output, across every real file in the tree, not just the
   ones already spot-checked in chat — that's the actual bar, not "compiles."
4. `tree-sitter build -o gls_js.so` (or `tree-sitter build --wasm` if going
   the wasm-parser route instead — `.so` is simpler for a local-only setup).
5. `queries/highlights.scm`: start from upstream's, add
   ```scm
   (builtin_identifier) @function.builtin
   ```
   Check `factions.gls.js:22` (`#uppercase(f[0])`) and `intro.gls.js` render
   sane — that's a builtin used as a plain call target, not `#main`'s
   trailing-callback pattern, worth eyeballing both shapes.

Effort: half day if this is a first tree-sitter-grammar edit, mostly DSL
ramp-up; the change itself is additive and localized, low collision risk with
existing JS constructs. Real risk is `#` needed in more grammar positions
than "call target" (object key? destructuring?) — the `grep ERROR` pass over
every file above is what catches that, don't skip it.

Fallback if the fork stalls: classic regex `syntax match` layered over
`javascript.vim` (`syntax include @JS syntax/javascript.vim` +
`syntax match glsBuiltin "#\w\+"`). ~30 min, no grammar/build toolchain,
worse (no fold/indent benefit on those nodes, doesn't fix ERROR-node
misdetection for LSP-adjacent tools) — treat as a stopgap, not the target.

## Task B — neovim wiring

**1. `lua/config/syntax.lua`** — extend the existing pattern table:
```lua
vim.filetype.add({
  extension = { mmd = "markdown" },
  filename = { ["Dockerfile"] = "dockerfile" },
  pattern = {
    [".*.yml.example"] = "yaml",
    [".*%.gls%.js"] = "glsjs",   -- new
  },
})
```
Verify after reload: `:lua print(vim.filetype.match({ filename = "main.gls.js" }))` → `glsjs`.

**2. Same file (or a new `lua/plugins/language-glsjs.lua` if you'd rather keep
the one-file-per-concern convention) — one FileType autocmd, no plugin dep:**
```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "glsjs",
  callback = function()
    vim.treesitter.language.register("gls_js", "glsjs")
    vim.treesitter.start(0, "gls_js")
    vim.bo.commentstring = "// %s"        -- lost along with ftplugin/javascript.vim
    vim.opt_local.iskeyword:append("#")   -- so `#main` is one word for *, ciw, cmp
  end,
})
```
Requires `gls_js.so` from Task A somewhere on runtimepath under `parser/`
(e.g. `~/.local/share/nvim/site/parser/gls_js.so`) and
`queries/gls_js/highlights.scm` similarly under `site/queries/gls_js/`.

**3. LSP / formatter: no new code.** `glsjs` never appears in
`plugins/lsp.lua`'s `vim.lsp.enable(...)` server filetypes or
`conform.lua`'s `formatters_by_ft` — that absence *is* the mechanism. One
rule to keep it that way: never add `glsjs` to any server's `filetypes`
override, and never add a catch-all `*` formatter/linter later without
excluding it explicitly.

**4. `iskeyword`/`commentstring` above are the two easy-to-miss losses** from
not being filetype `javascript` — you lose all of
`$VIMRUNTIME/ftplugin/javascript.vim` (comments, matchpairs, etc), not just
LSP/treesitter. Both are one-liners once you know to look for them; nothing
else in there matters for GSE.

## Task C — other affordances worth trying

- **Diagnostics from the real compiler**, not just highlighting. `GLSMAC
  --gse-tests --gse-tests-script <file> --quiet` already gives `file:line`
  errors for reference/parse errors (confirmed working on arbitrary paths,
  see prior turns). Start manual, not automatic:
  ```lua
  vim.api.nvim_create_user_command("GlsCheck", function()
    vim.system({ "./build/bin/GLSMAC", "--gse-tests",
      "--gse-tests-script", vim.fn.expand("%"), "--quiet" },
      { text = true }, function(out)
        -- parse "!!! TEST FAILED: ..." + the following "\tat FILE:LINE:" line
        -- into quickfix (setqflist) here, then :copen
      end)
  end, {})
  ```
  Confirm the exact two-line error shape against real output before writing
  the parser — don't guess the regex from memory of one example. Promote to
  a `BufWritePost` autocmd later only if the manual command earns its keep;
  autosaving a shell-out adds save-latency and race-with-editing risk for no
  proven benefit yet.
- **`gf` on `#include('game/game')`** — set `vim.opt_local.path` to include
  `GLSMAC_data/default` and adjust `includeexpr`/`isfname` so `gf` resolves
  the quoted path + implicit `.gls.js` suffix relative to that root. Nice
  quality-of-life, low priority, cut if it fights the include-string quoting.
- **Indent/textobjects**: not touched by the grammar edit (only added an
  expression-level rule) — should inherit correctly from upstream JS as-is.
  Verify once, don't build anything preemptively.

## Open questions (flagged, not guessed)

- Confirmed builtin-side operators exist — `OT_PUSH` (`arr :+ val` /
  `arr[] = val`), `OT_POP`, `OT_ERASE`, `OT_RANGE`, `OT_AT`, `OT_CHILD`
  (`src/gse/program/Types.h:42-47`) — but only `:+`/`[]=` push syntax was
  confirmed against real source (`JS.cpp:912`, `GLSMAC_data/tests/async.gls.js`).
  Pop/erase/range/at surface syntax wasn't traced — grep
  `GLSMAC_data/tests/*.gls.js` for real usage before relying on any of them,
  including in the cheatsheet below.
- Whether `#` needs grammar support anywhere besides "call target" (object
  key, destructuring target, etc) — the `grep ERROR` pass in Task A step 3 is
  the actual test, not a code-read guess.

---

# GSE vs JS mindset — cheatsheet

| | JS | GSE (`.gls.js`) |
|---|---|---|
| Keywords | ~40 reserved words | Only: `return break continue throw let const true false null undefined if else while for try catch switch case default`. No `var`, `function`, `class`, `new`, `import`, `export`, `async`, `await`. (`JS.h:98-148`) |
| Functions | `function`/arrow both | Arrow only: `let f = (a, b) => { ... };`. No hoisting — declare before use. |
| Modules | `import`/`export` | `#include('path')` returns whatever that file's top-level `return` produced; call the result yourself. (`main.gls.js:1-4`) |
| `+` coercion | Anything stringifies (`1+'2'==='12'`) | Strict — both sides must match type (int+int, float+float, string+string). Array `+` **concatenates**; object `+` **merges** (throws on duplicate key). Anything else throws `operation_not_supported`. (`Interpreter.cpp:522-543`) |
| Truthy/falsy | `0`, `''`, `null`, `[]` (no) all coerce | **None.** `if`/`while`/ternary require an actual `Bool` — `if (arr)` or `if (str)` throws `TYPE_ERROR`. Always compare explicitly. (`Interpreter.cpp:1076-1077`) |
| `this` | dynamic, many footguns | Context-bound inside callables, same idea as JS. Nothing special found here — don't over-solve it. (`Context.cpp:13,48`) |
| async | promises / event loop / microtasks | No promises. `#async(ms, callback)` = repeating timer: callback returning `true` reschedules after `ms`, `false` stops. Nested `#async` calls create child scopes tied to the parent's lifetime (cooperative, not microtask-queued) — see the parent/child example at `GLSMAC_data/tests/async.gls.js:33-73`. Different mental model, don't reach for `await`-shaped intuitions. |
| Array push | `.push(x)` | `arr :+ x` or `arr[] = x`. No method-call form seen. |
| `null`/`undefined` | both exist, both loose | Both exist as distinct types here too — not a JS difference, confirmed same shape (`value/Null.h`, `value/Undefined.h`, `#typeof()` returns the type name string). |
| `#` prefix | private class fields only | Namespace marker for **engine builtins** (`#main`, `#include`, `#typeof`, `#sizeof`, `#to_string`, `#is_defined`, `#uppercase`, ...) — every `Context::CreateBuiltin` call auto-prepends it. Nothing to do with privacy. |
| Testing | describe/it frameworks | `test.assert(cond)` — only exists inside the GSE test harness (`GLSMAC_data/tests/`, run via `--gse-tests`), not available in real game/`default/` scripts. |

Biggest trap switching from JS headspace: **no implicit coercion, no
truthiness.** Every `if (x)` that isn't already a `Bool` is a compile-time
habit that becomes a runtime `TYPE_ERROR` here.
