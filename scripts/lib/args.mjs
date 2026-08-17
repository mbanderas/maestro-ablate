// Minimal argv parser. No dependencies by design.

// Piping output into `head`, `Select-Object -First n`, or a closed pager closes
// stdout early. Without this the next write raises an unhandled EPIPE and the
// script dies with a stack trace, which looks like a bug in the tool.
process.stdout.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
process.stderr.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });

/**
 * Parse argv into { _: positionals, ...flags }.
 *
 * `spec.string` names flags that take a value, `spec.boolean` names flags that
 * do not, and `spec.repeat` names value flags that accumulate into an array.
 * Unknown `--flags` are an error rather than a silent no-op: a mistyped flag on
 * a destructive script must not read as "the default".
 */
export function parseArgs(argv, spec = {}) {
  const string = new Set(spec.string ?? []);
  const boolean = new Set(spec.boolean ?? []);
  const repeat = new Set(spec.repeat ?? []);
  const out = { _: [] };
  for (const key of repeat) out[key] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { out._.push(arg); continue; }

    let name = arg.slice(2);
    let value = null;
    const eq = name.indexOf('=');
    if (eq !== -1) { value = name.slice(eq + 1); name = name.slice(0, eq); }

    if (boolean.has(name)) {
      if (value !== null) throw new Error(`--${name} takes no value`);
      out[name] = true;
      continue;
    }
    if (string.has(name) || repeat.has(name)) {
      if (value === null) {
        value = argv[++i];
        if (value === undefined) throw new Error(`--${name} requires a value`);
      }
      if (repeat.has(name)) out[name].push(value);
      else out[name] = value;
      continue;
    }
    throw new Error(`unknown flag --${name}`);
  }
  return out;
}

/** Print `msg` to stderr and exit non-zero. */
export function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

/**
 * `parseArgs`, but a bad flag prints one line and exits instead of dumping a
 * stack trace. A usage mistake is not a crash.
 */
export function parseArgv(argv, spec = {}) {
  try {
    return parseArgs(argv, spec);
  } catch (e) {
    fail(e.message);
  }
}
