// Every tier below builds a throwaway repository and names it by path — `git -C <root>`, or
// `cwd: <root>`. Git resolves the environment BEFORE it resolves either, so a corpus run started
// from a git hook, a `git bisect run` or a `git rebase --exec` acted on whatever GIT_DIR named:
// the gate staged and committed into the repository it was run to protect (ISS-39).

const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_TEMPLATE_DIR', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX'];

// cm:guard config reaches a child git through the ENVIRONMENT, not only files, so the location
//   variables alone are not enough: GIT_CONFIG_PARAMETERS still carries core.hooksPath in (ISS-39)
const GIT_CONFIG_VARS = ['GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

// cm:guard these outrank the GIT_AUTHOR_* a tier's own helper sets, so stripping has to happen
//   BEFORE the fixture identity is applied, never after (ISS-39)
const GIT_IDENTITY_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE'];

// cm:guard GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM are SET to an empty file, never deleted:
//   deleting them hands back a user config the caller may be suppressing on purpose (ISS-39)
// cm:edge contract -> tests/git-env-cases.mjs — the case tier asserts this variable list channel by
//   channel, so a name added here without a case there is unpinned (ISS-39)
export function stripGitEnv(env) {
  const out = { ...env };
  for (const k of [...GIT_LOCATION_VARS, ...GIT_CONFIG_VARS, ...GIT_IDENTITY_VARS]) delete out[k];
  for (const k of Object.keys(out)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete out[k];
  }
  out.GIT_CONFIG_GLOBAL = '/dev/null';
  out.GIT_CONFIG_SYSTEM = '/dev/null';
  out.GIT_CONFIG_NOSYSTEM = '1';
  return out;
}

export const GIT_LOCATION_VAR_NAMES = GIT_LOCATION_VARS;
export const GIT_CONFIG_VAR_NAMES = GIT_CONFIG_VARS;
export const GIT_IDENTITY_VAR_NAMES = GIT_IDENTITY_VARS;
