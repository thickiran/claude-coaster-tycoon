# AGENTS.md

Guide for AI agents (Claude Code, Codex, Cursor, …) working with this repo. Humans: see [README.md](README.md).

## What this is

A Claude Code **mod** (a plugin of function hooks): while Claude Code works, every tool call builds part of a RollerCoaster Tycoon-style theme park in a pane. Finished rides get test runs, guests ride them, and parks compete on an opt-in global leaderboard that runs only on GitHub (gists plus an Action). No server, no dependencies, no build step.

## If a user asks you to install it

Run these in the user's terminal (or have them type the slash forms in Claude Code):

```bash
claude plugin marketplace add thickiran/claude-coaster-tycoon
claude plugin install coaster-tycoon@claude-coaster-tycoon
```

Slash forms: `/plugin marketplace add thickiran/claude-coaster-tycoon`, then `/plugin install coaster-tycoon@claude-coaster-tycoon`.

Then tell them:
- **Start a new Claude Code session.** The park pane opens on its own; `/park` reopens it.
- **Give Claude any task with tool calls** and the crews build.
- **`/park join`** enters the leaderboard. It needs `gh auth login`, and only game stats plus the park name are shared.
- **If no pane ever appears,** their Claude Code build may not have plugin function hooks yet (early access).

To try a local checkout without installing: `claude --plugin-dir plugins/coaster-tycoon`.

## Repo map

```
.claude-plugin/marketplace.json     the marketplace listing (one plugin)
plugins/coaster-tycoon/             the mod itself
  .claude-plugin/plugin.json        manifest: name, version, types contract
  hooks/hooks.json                  names the hooks module
  hooks/register.tsx                ALL hooks and every function that touches `$`
  hooks/sim.ts                      pure simulation: rides, layouts, trains, guests, money
  hooks/vector.ts                   desktop renderer: isometric SVG (vector)
  hooks/draw.ts                     terminal renderer: pixel buffer → half-block Raster cells
  hooks/board.ts                    leaderboard stats, score formula, helpers
  types/index.d.ts                  $.state contract (tick, view, board)
leaderboard/registry.json           GitHub user → gist id (written by the Action)
leaderboard/leaderboard.json        the ranking the mod fetches (written by the Action)
scripts/update-leaderboard.mjs      the Action's script: registers joins, ranks parks
scripts/update-leaderboard.test.mjs its tests
scripts/preview.mjs                 renders a simulated park to SVG, offline
.github/workflows/leaderboard.yml   runs the script every 20 min and on join issues
```

## Check your work

```bash
npm test            # leaderboard tests + offline render + plugin and marketplace validation
npm run preview     # writes preview.svg: a park after 6 simulated turns; LOOK at it
```

`npm test` needs Node ≥ 22.18 (it runs the `.ts` files directly) and the `claude` CLI on PATH. For a visual change, render a preview and view it (`qlmanage -t -s 1400 preview.svg` on macOS makes a PNG). A change isn't done until the preview looks right.

## How it works

- **Hooks** (`register.tsx`): `tool.call` → `toolCalled(world, tool, model)` lays track; `turn.step` records which model each loop uses (main or a subagent), which picks the crew; `turn.complete` finishes or crash-tests builds; a 150 ms `$.clock.every` steps the simulation and bumps the `tick` atom, which redraws the pane (`ui.render` on `Pane`).
- **Crews by model** (`tierOf` in `sim.ts`): `haiku` → small flat rides, `sonnet` → family rides, anything else → big coasters. Each tier builds one ride at a time, in parallel.
- **The map grows.** It is `gridW(w)` × 13 tiles: a boulevard on row 6, with columns of two 4×5 plots, one either side (`slotAt(i)`: column `i / 2`, above the boulevard when `i` is even). A park opens with `COLS_START` (4) columns. When `place()` finds no room, `expand()` buys the next column, up to `COLS_MAX` (12, so 24 plots). Only a full-size park demolishes, and then only the crew's own weakest ride. A flat ride takes half a plot. The guest cap and arrival rate scale with `w.cols`.
- **Big parks on the desktop:** past 6 columns, `renderSvg(w, 6)` draws a window that pans along the park with the camera, instead of shrinking it. The ground is a few patterned shapes drawn in tile coordinates through a projection `transform`, and each coaster is one sprite, which keeps a full-size park's SVG under the 131072-character limit (`npm run preview -- --turns 25` checks it).
- **Saving:** `$.store` key `park:<git root or cwd>` holds one park per project; key `account` holds `{ user, gist }` after `/park join`. `SAVE_VERSION` in `sim.ts`: bumping it discards every saved park, so bump only on breaking changes.
- **Leaderboard:** `/park join` uses the user's `gh` to create a public gist (`park.json`, `{ v, parks: { <id>: ParkStats } }`) and files a `[park] join: <user>` issue. The Action checks the gist's owner is the issue's author, records it in `registry.json`, and every 20 minutes rebuilds `leaderboard.json` from all gists. The mod pushes stats every 10 minutes and fetches the board every 5.

## Rules that will bite you

1. **`$` only in top-level functions of `register.tsx`.** `claude plugin validate` refuses `$` passed to anything that isn't a function declared at the top of that file. `sim.ts`, `vector.ts`, `draw.ts` and `board.ts` must stay pure: no `$`.
2. **No Node, no DOM in hooks.** The module runs in its own sandbox; reach files, processes and the network through `$` (`$.fs`, `$.process.run`, `$.http.fetch`). Web APIs (`crypto.subtle`, `TextEncoder`) are fine. Don't use TypeScript parameter properties or enums (type stripping can't remove them).
3. **Render hooks never write state.** Write from a Button's `onPress`, a timer or another event (`update($, atom, fn)`).
4. **Svg is at most 131072 characters.** `npm run preview` prints the size. Reuse shapes with `<use href>` (see `DEFS` in `vector.ts`).
5. **Elements differ per surface.** `Raster` is terminal-only; `Svg` is desktop, VS Code and mobile only. `ui.render` branches on `e.surface`.
6. **The score formula lives in two places:** `score()` in `hooks/board.ts` and in `scripts/update-leaderboard.mjs`. Change both, and the test.
7. **Treat leaderboard input as hostile.** Issue bodies and gists are untrusted. The script extracts only a gist id, clamps every number, cleans names and recomputes the score. Never interpolate issue text into the workflow's shell.
8. **Share nothing new without saying so.** `parkStats()` is the complete list of what leaves a user's machine. Adding a field changes the privacy promise in the README.

## Common tasks

**Add a flat ride:** add a `FlatSpec` to `SMALL_FLAT` or `MEDIUM_FLAT` in `sim.ts`, add a `case` to `drawKind()` in `vector.ts` with a draw function (copy `carousel` or `twist`; `P(x, y, h)` projects tile coordinates and height to the screen, and `ctx.phase` animates). The terminal gets a generic look from `drawFlat()` in `draw.ts` for free.

**Add a coaster type:** add a `TrackSpec` to `BIG` or `MEDIUM_TRACK` in `sim.ts` (height range, loops, corkscrews, layouts, cars). Rendering is automatic.

**Add a track layout:** add a case to `layoutPath()` in `sim.ts`: a closed path in plot coordinates (u 0–4 across, v 0–5 away from the boulevard) that starts `{u: 0.5, v: 0.5} → {u: 3.5, v: 0.5}` (the station). Add its name to `Layout` and to some `TrackSpec.layouts`.

**Change the economy or ratings:** `open()`, `rate` constants in `startRide()`, `board()` fares and `stepGuests()` spawn rate, all in `sim.ts`.

**Release:** bump `version` in both `plugins/coaster-tycoon/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, run `npm test`, commit and push. Users get it with `/plugin marketplace update claude-coaster-tycoon`.

## API reference

The mod API is early access. Its authoritative types come from the running Claude Code build: run `/plugin-types` in Claude Code to write `claude-code.d.ts` into `.claude/types`. Check a change against the engine with `claude plugin validate plugins/coaster-tycoon`.
