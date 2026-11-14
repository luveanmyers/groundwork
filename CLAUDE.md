# CLAUDE.md

Guidance for Claude working in this repo. This file holds the **rules**. The
**reasoning** behind them, along with project status, lives in Linear (see
below). If this file and a Linear doc disagree, flag it rather than picking one.

## What this is

**SetOut** is a personal travel-planning and on-trip logistics PWA, built in
vanilla HTML/CSS/JS with no framework and no build step. The repo, folder, and
`localStorage` key are still named `groundwork` on purpose (see Hard-to-Change
entry 5). Hosted on GitHub Pages from `main`. The repo is public.

## Roles

- **Luvean designs and does QA.** Luvean decides product direction, interaction
  design, and visual language, and does acceptance testing.
- **Claude writes and pushes code.** That includes branches, commits, pushes,
  and merges, under the gate below.

## Shipping gate (non-negotiable)

1. All work goes on a branch. Never commit directly to `main`.
2. Push the branch and give Luvean a preview to review: a preview URL, or a
   mockup file for design questions.
3. Merge to `main` **only after Luvean explicitly says "ship it"** for that
   branch. Approval of one branch does not carry over to another, and neither
   does approval of an earlier revision of the same branch.
4. After merging, confirm the change is actually on `origin/main` (`git fetch`
   plus a log or diff check) before calling it done in Linear. A doc or ticket
   saying something shipped is not evidence that it did.

## Reviewing interactions: one batched pass per screen

When a screen is ready for review, give Luvean a **single numbered list of
every interactive element** on that screen, with what each one does, so
everything can be confirmed in one pass. Don't drip interactions out one at a
time.

## Linear is the single home for status and reasoning

Project: **SetOut v1** (team LUV). Docs:

- **Working Agreement — Process Rules**: how we work, and why each rule exists.
- **SetOut — Product Decisions Log**: what was decided and the reasoning.
- **SetOut — What's Hard to Change Later**: decisions that are costly to reverse.
- **SetOut — Backlog**: smaller deferred tweaks and parked ideas.

Tickets track *what* and *status*. They link to the doc section for *why*
instead of repeating it. Don't create, close, or rescope tickets without
Luvean's go-ahead.

## Standing rules

- **Name structural pivots before acting.** Any change to where something lives,
  which tool does which job, or how a system is organized: state it as a
  structural change, say which prior decision it affects, and wait for explicit
  confirmation. This applies most when the pivot comes up while solving an
  unrelated problem.
- **Read the actual code before assuming.** Docs and tickets can be stale, so
  check the source.
- **Log non-obvious decisions with Luvean's reasoning** in the Product Decisions
  Log. Write down the reasoning, not just the outcome.
- **Call out anything hard to change later** *before* building it (data field
  names and shapes, storage keys, slot strings, grid coordinates), and add an
  entry to the Hard-to-Change doc.
- **Preview before production code.** Any new interaction gets a preview that
  Luvean confirms before it lands in `js/app.js`, `js/storage.js`, or
  `css/style.css`, even if an old mockup already showed the mechanic.
- **Mockups use the real styles.** Put a static HTML file in `mockup/` that
  links the real `css/style.css` (and the icon sprite from `index.html` when
  icons are involved). A generic visualizer is only for abstract A/B
  comparisons, and say so when using one.
- **No feature code without a ticket and a confirmed design.**

## Code conventions

- **`js/storage.js` is the only file that touches `localStorage`.** Everything
  else goes through its functions.
- **Schema changes need a migration.** Extend `migrateIdeasInState()` (numbered
  migrations) so saved data keeps working. First check whether anything
  actually reads the field (Hard-to-Change entry 7).
- **Calendar grid: every child gets an explicit `grid-row`/`grid-column`.**
  Never mix auto-placed and explicitly placed children (Hard-to-Change entry 8).
- **`scheduled.slot` strings are locked** (`morning`/`midday`/`afternoon`/
  `evening`/`allday`/`lodging`), and so are the constants keyed off them.
- **Never put secrets in client code.** The repo is public and there is no
  backend.
- Code comments explain *why* for a reader who is learning. Keep that tone.

## Service worker (recurring gotcha)

`sw.js` is cache-first. Editing `app.js` or `style.css` does **not** bust the
cache. Bump `CACHE_NAME` in `sw.js` in any change that touches files in
`APP_SHELL`, or installed copies keep serving stale code. When asking Luvean to
test, give the cache-bypass step up front: an Incognito window, or DevTools →
Application → Service Workers → Unregister, then a hard reload.

## Running locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in an Incognito window (see above).

## Commits and history

The public repo and its history are part of Luvean's portfolio.

- Each commit is one logical change, with an imperative subject of 72
  characters or fewer. Prefix it with the Linear ID when there is one
  (`LUV-26: Group identical-footprint All Day items`).
- The body explains *why* and anything a reviewer would trip over. Don't
  narrate the session.
- No WIP, "fix typo again", or debugging-noise commits on `main`. Squash or
  tidy a branch before merging.
- Never force-push `main`. Never rewrite history that has already been pushed
  to `main`.
