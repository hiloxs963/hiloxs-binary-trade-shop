# Local Development Environment

## Install commands

Two packages, two package managers, two commands.

Root project (`C:\dev\hiloxs`):

```sh
bun install --frozen-lockfile --backend=copyfile
```

API (`C:\dev\hiloxs\api`):

```sh
npm ci
```

Do not substitute one for the other. Running `bun install` in `api/` silently migrates
`package-lock.json` into a new `bun.lock`, even when `--frozen-lockfile` is passed —
that flag does not prevent lockfile creation when none exists yet. Running `npm install`
at the root produces a sparse install on this machine. Delete `api/bun.lock` if it
appears; `.gitignore` guards against committing it.

## Repository location

The repository is at `C:\dev\hiloxs`. Do not move it under a cloud-synced path such
as OneDrive. Moving off OneDrive was part of the investigation into the bun hardlink
failure described below and does not affect CI.

All linked worktrees reference each other by absolute path. If the repository is ever
relocated, run `git worktree repair <path1> <path2> ...` from the new main worktree
location to update those references before running any tooling.

## The bun hardlink problem

bun 1.4.2 on this Windows machine populates `node_modules` using hardlinks from its
global cache. The hardlinks do not materialise correctly, leaving package directories
present but containing only `package.json` with no module files. bun reports no error.

Symptoms as they present to a developer:

- `vite build` fails with `ERR_MODULE_NOT_FOUND` after a clean install.
- `eslint` fails with `Cannot find module 'debug'` before any file is linted.
- Docker BuildKit context transfer fails on a different source file each attempt,
  because whichever file is read first from an empty package directory triggers the
  failure.

These symptoms share one cause: the Node.js CJS resolver walks `node_modules`
directory-by-directory using the filesystem, which sees empty or manifest-only
directories. bun's own runtime resolves packages from its global cache and does not
encounter the empty directories, masking the problem.

Evidence for the mechanism: after a default `bun install`, `node_modules/debug/package.json`
had link count 2 — two directory entries sharing one inode, the signature of a hardlink
from the cache. After `bun install --backend=copyfile`, the same file had link count 1,
a genuine copy with no other hard links pointing to it.

A complete copyfile install was verified by spot-checking ten previously-failing
packages. All contained full trees: zod (596 files), postcss (55 files), react (27 files),
tailwindcss (34 files), globals (6 files), and five others where previously most had only
a manifest. The copyfile install took 124 seconds versus 6.5 seconds for the default; that
cost is unavoidable on this machine.

## What was ruled out

**Mixed npm and bun install state.** Disproved: a clean install from a deleted
`node_modules` reproduced the failure identically.

**OneDrive sync locks.** Disproved: killing the OneDrive process did not resolve it.

**OneDrive quota exhaustion.** Plausible as a contributing factor (~290,000 items were
pending sync at the time), but disproved as the sole cause: relocating the repository
from `C:\Users\hp\OneDrive\Desktop\hiloxs` to `C:\dev\hiloxs` did not fix the sparse
installs. It was still worth doing for other reasons.

**`backend = "copyfile"` in `bunfig.toml`.** Inert on bun 1.4.2. Only the CLI flag is
honoured. A test entry was added to `bunfig.toml` and reverted after confirming it had
no effect. The setting must be passed on the command line.

## CI is unaffected

CI runs Linux. Both workflows use `npm ci` in clean ephemeral runner environments. The
hardlink failure has not been observed on Linux and does not affect the CI pipeline.
Thirteen prettier violations reached `main` during the period when local lint could not
execute; that is the extent of the observable impact.

## Untested

Whether `--backend=copyfile` behaves correctly on a warm incremental install — adding
one package to an existing `node_modules` tree without deleting it first — is untested.
Only cold installs with `node_modules` deleted beforehand were verified.
