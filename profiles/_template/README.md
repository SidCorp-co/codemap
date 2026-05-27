# New profile — template

Copy this directory to `profiles/<your-profile-name>/`, then:

1. **Pick a descriptor name.** Follow `<stack>-<branching>-<deploy>-<verification>` where each axis is the most informative. Examples:
   - `pnpm-monorepo-tbd-local`
   - `webapp-coolify-gitflow`
   - `nextjs-vercel-tbd`
   - `tauri-github-release`

   **Never name a profile after a specific project** — the profile is the pattern; many projects can share one.

2. **Fill `profile.json`.** The four axes (`stack`, `branching`, `deploy`, `verification`) plus a one-line `description`. `overlayFiles` lists the SKILL.md paths under `overlays/` that this profile replaces; leave empty until you actually add overlays.

3. **Add overlay files** under `overlays/` mirroring `skills/`'s directory layout. **Whole-file replace** — there is no section-patch. Only put files here when the profile genuinely needs to diverge from base; everything not in `overlays/` inherits from `skills/`.

   **For skills that are N/A in this profile** (e.g., `forge-staging` in a TBD flow with no staging branch): don't overlay an empty stub. Add the skill name to `excludeSkills` in `profile.json` — the build will delete it from the bundle entirely. Keeps the bundle clean.

4. **Hygiene.** No real project names, real UUIDs, real hostnames, real credentials, or per-user identifiers — see `conventions/placeholders.md`. Run `tools/lint-skill.sh` before committing.

5. **Build & inspect:**
   ```bash
   tools/build-bundle.sh <your-profile-name>
   tools/diff-overlay.sh <your-profile-name>      # shows what your overlay changed vs base
   ```

6. **List it** in `BUNDLES.md` so consumers can find it.
