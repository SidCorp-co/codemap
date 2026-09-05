# `lockstep`

> These files must change in the same commit.

```ts
// cm:edge lockstep -> apps/desktop/tauri.conf.json — the three version fields are read by three different tools and must agree
```

## When it applies

- A value duplicated because no build step can share it: a version in three manifests, a port in a
  compose file and a client config, a schema mirrored into a fixture.
- A generated file plus its generator input, where the generator is not run in CI.
- Two sides of a migration that must land together or the intermediate state is broken.

## What breaks without it

Half the change ships. The state between the two commits is not a state anybody designed, and it is
usually the state production runs in for a day.

## How to spot the candidate

`git log` is the cheapest source: files that change together far more often than chance, with no
import between them, are lockstep candidates. Note the tension — history can *suggest* the pair, but
only a person knows **why** they are bound, and the why is the part that is not derivable.

## Anti-pattern

Do not declare `lockstep` where a build step could remove the duplication. The annotation is for
couplings you have decided to live with, not a substitute for fixing one that is cheap to fix. If it
is cheap to fix, fix it and delete the annotation — the count going down is a success, not a loss.
