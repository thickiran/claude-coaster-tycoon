# Coaster Tycoon (plugin)

Claude builds you a RollerCoaster Tycoon-style theme park while it works. Full description, screenshots and install steps: [the repository README](https://github.com/thickiran/claude-coaster-tycoon#readme).

This file states exactly what the mod reads, runs, contacts and sends.

## What each hook does

All hooks pass the event on unchanged. The mod never blocks, rewrites or delays a tool call, a prompt or a model response.

| Hook | What it reads | What it does with it |
| --- | --- | --- |
| `tool.call` | The tool's **name** (`Edit`, `Bash`, …), which loop made the call, and whether the result was an error | Lays track pieces in the park; failed calls count against the ride's test. It reads **no tool input or output** (no file contents, commands or results). |
| `turn.step` | The **model name** of each model request (main loop or subagent) | Picks the construction crew: Opus/Fable → coasters, Sonnet → family rides, Haiku → flat rides. It reads no messages; the stream passes through untouched. |
| `turn.start`, `turn.complete` | That a turn started, and the turn's end reason (`answer`, `aborted`, `error`) | Marks the crews working or idle, and finishes or crash-tests unfinished rides. |
| `command.run` (`/park`) | The arguments typed after `/park` | Runs the `/park` subcommands: open, `top`, `join`, `leave`, `name`, `reset`. |
| `session.start`, `session.end` | Nothing | Loads and saves the park, starts the animation timer, opens the pane. |
| `ui.render` (its own pane) | Nothing beyond its own state | Draws the park and the leaderboard. |

## Programs it runs

| Program | When | Why |
| --- | --- | --- |
| `git rev-parse --show-toplevel` | Once per session | Finds the project's root folder, so each repository gets its own park. |
| `gh api user --jq .login` | Only when you type `/park join` | Gets your GitHub username. |
| `gh gist create --public --filename park.json …` | Once, on your first `/park join` | Creates the public gist that holds your parks' stats. |
| `gh issue create --repo thickiran/claude-coaster-tycoon …` | Once, on your first `/park join` | Registers that gist with the leaderboard. |
| `gh api gists/<your gist id> …` and `gh api -X PATCH gists/<your gist id> …` | Every 10 minutes, only for parks you joined | Reads and updates your park's stats in your own gist. |

`gh` is the [GitHub CLI](https://cli.github.com), using the login you set up with `gh auth login` (the **only credential the mod uses**, and only after `/park join`). The mod never reads, stores or sends the token itself; `gh` does the authenticating.

## Hosts it contacts

- `raw.githubusercontent.com`: a `GET` of `https://raw.githubusercontent.com/thickiran/claude-coaster-tycoon/main/leaderboard/leaderboard.json` every 5 minutes, to show the leaderboard. This request sends nothing about you.
- `api.github.com`: only through `gh`, only after `/park join`, as listed above.

## What it sends, and where

Nothing, until you type `/park join` for a park. After that, every 10 minutes, it writes these fields for that park to **a public gist on your own GitHub account**:

`id` (a hash of the project folder's path, not the path itself), `name` (the park's display name, which defaults to the folder name; change it with `/park name`), `rating`, `guests`, `guestsTotal`, `rides`, `ridesOpen`, `coasters`, `riders`, `money`, `best` (the best ride's generated name, kind and rating), `updatedAt`.

Your GitHub username becomes public on the leaderboard. The mod sends **no file paths, file contents, code, prompts, conversation text, tool inputs or tool outputs**. `/park leave` removes the park from your gist.

## What it stores locally

The park itself (rides, guests, money) in Claude Code's per-plugin store, one entry per project, plus your GitHub username and gist id after joining.
