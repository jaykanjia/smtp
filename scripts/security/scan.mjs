#!/usr/bin/env node
/**
 * Repository security scan. No dependencies, so a compromised package cannot disable it.
 *
 * Catches the attack this repo was hit with (obfuscated code appended after a long run of
 * spaces to postcss.config.js and force-pushed), plus committed secrets and env files.
 *
 *   node scripts/security/scan.mjs            scan the working tree (dev, build, CI)
 *   node scripts/security/scan.mjs --staged   scan what is about to be committed (pre-commit)
 *   node scripts/security/scan.mjs --warn     report, but exit 0 (post-merge / post-checkout)
 *
 * Exits 1 when anything is found. A line containing `security-scan: allow` is skipped.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

const args = new Set(process.argv.slice(2))
const STAGED = args.has('--staged')
const WARN_ONLY = args.has('--warn')
const ROOT = process.cwd()
const MAX_BYTES = 2 * 1024 * 1024

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', '.vercel', 'coverage', 'graphify-out'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.sh'])
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])

/** Config files tools execute at install, build or dev time: where these attacks hide. */
const isExecutedConfig = (path) =>
  /(^|\/)[^/]*\.config\.(js|mjs|cjs|ts|mts|cts)$/.test(path) ||
  /^\.husky\/[^/]+$/.test(path) ||
  /^\.github\/workflows\/.+\.ya?ml$/.test(path)

const ALLOWED_LIFECYCLE_SCRIPTS = { prepare: ['husky'], postinstall: ['prisma generate'] }
/** Env files meant to be committed. Their contents are still scanned for secrets. */
const COMMITTABLE_ENV_FILES = new Set(['.env.example', '.env.sample', '.env.template', '.env.test'])
/** Passwords in documentation and samples, e.g. postgres://user:pass@host. */
const PLACEHOLDER_PASSWORD = /^(pass(word)?|postgres|secret|changeme|example|test|x+|\*+|your[_-]?password)$/i
const LIFECYCLE_SCRIPTS = [
  'preinstall', 'install', 'postinstall', 'preuninstall', 'postuninstall',
  'prepublish', 'preprepare', 'prepare', 'postprepare',
]

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|postgres|db|host)$/

/** Code hidden off-screen, and the obfuscation this campaign uses. Checked in every code file. */
const HIDDEN_CODE = [
  [/\S[ \t]{80,}\S/, 'code hidden after a long run of whitespace'],
  [/\bglobal\.o\s*=\s*['"]/, 'known malware marker (global.o=)'],
  [/_\$_[0-9a-f]{4}\s*=\s*\(function/, 'string-shuffling obfuscator'],
  [/eval\(\s*["'`][^"'`]*["'`]\s*\+\s*atob\(/, 'eval of a base64 payload'],
]

/** Things a config file has no business doing. Checked only in executed config files. */
const CONFIG_RED_FLAGS = [
  [/\bchild_process\b|\bexecSync\s*\(|\bspawnSync?\s*\(/, 'runs shell commands'],
  [/\beval\s*\(|\bnew\s+Function\s*\(|[^.\w]Function\s*\(\s*['"`]/, 'evaluates a string as code'],
  [/\batob\s*\(|Buffer\.from\([^)]*['"](base64|hex)['"]/, 'decodes base64/hex'],
  [/String\.fromCharCode|(\\x[0-9a-fA-F]{2}){4,}|(\\u00[0-9a-fA-F]{2}){4,}/, 'encoded strings'],
  [/\bcreateRequire\b|\brequire\s*\(\s*[^'"`\s)]/, 'loads modules dynamically'],
  [/\bglobal(This)?\s*\[/, 'writes to the global object'],
  [/\bfetch\s*\(|\bhttps?\.(get|request)\s*\(|from\s+['"](node:)?(net|dgram|tls|http|https)['"]/, 'makes network requests'],
  [/\bcurl\b[^\n|]*\|\s*(ba|z)?sh\b|\bwget\b[^\n|]*\|\s*(ba|z)?sh\b|\/dev\/tcp\/|base64\s+(-d|--decode)/, 'downloads and runs code'],
]
const CONFIG_MAX_LINE = 300

const SECRETS = [
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, 'GitHub token'],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/, 'Resend API key'],
  [/\b0x4AAAAAA[A-Za-z0-9_-]{25,}\b/, 'Cloudflare Turnstile secret'],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/, 'Stripe live key'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/, 'OpenAI/Anthropic API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bcloudinary:\/\/\d+:[A-Za-z0-9_-]+@/, 'Cloudinary URL with secret'],
]
const DB_URL = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s:@/'"]+:([^\s@/'"]+)@([^\s/:'"?]+)/g

const findings = []
/** False when walking the directory without git: then nothing is known to be committed. */
let fromGit = true
const report = (path, line, rule, message) => findings.push({ path, line, rule, message })

function git(argv) {
  return execFileSync('git', argv, {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** Tracked files, or a directory walk where there is no git checkout (e.g. a Vercel build). */
function listFiles() {
  if (STAGED) {
    return git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString().split('\0').filter(Boolean)
  }
  try {
    return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean)
  } catch {
    fromGit = false
    const files = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name))
        } else if (entry.isFile()) {
          files.push(relative(ROOT, join(dir, entry.name)))
        }
      }
    }
    walk(ROOT)
    return files
  }
}

function readContent(path) {
  try {
    if (STAGED) return git(['show', `:${path}`])
    if (statSync(join(ROOT, path)).size > MAX_BYTES) return 'too-large'
    return readFileSync(join(ROOT, path))
  } catch {
    return null
  }
}

function checkPath(path) {
  const name = basename(path)
  if (/^\.env(\..+)?$/.test(name) && !COMMITTABLE_ENV_FILES.has(name)) {
    report(path, 0, 'env-file', 'environment files must never be committed')
  }
  if (/\.(pem|p12|pfx|key)$/.test(name) || /^id_(rsa|ed25519|ecdsa)$/.test(name)) {
    report(path, 0, 'key-file', 'key files must never be committed')
  }
}

function checkPackageJson(path, text) {
  let pkg
  try {
    pkg = JSON.parse(text)
  } catch {
    return
  }
  for (const script of LIFECYCLE_SCRIPTS) {
    const value = pkg.scripts?.[script]
    if (value !== undefined && !ALLOWED_LIFECYCLE_SCRIPTS[script]?.includes(value)) {
      report(path, 0, 'install-script', `"${script}" runs on install: ${JSON.stringify(value).slice(0, 120)}`)
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']) {
    for (const [name, spec] of Object.entries(pkg[field] || {})) {
      if (typeof spec === 'string' && /^(git\+|git:|github:|https?:|ssh:)/.test(spec)) {
        report(path, 0, 'remote-dependency', `${name} installs from ${spec}`)
      }
    }
  }
}

function checkLockfile(path, text) {
  text.split('\n').forEach((line, i) => {
    const tarball = line.match(/tarball:\s*(\S+)/)
    if (tarball && !tarball[1].startsWith('https://registry.npmjs.org/')) {
      report(path, i + 1, 'lockfile-source', `package downloaded from ${tarball[1].slice(0, 100)}`)
    }
    if (/resolution:\s*\{[^}]*\b(repo|commit):/.test(line)) {
      report(path, i + 1, 'lockfile-source', 'package installed from a git repository')
    }
  })
}

function checkText(path, text, { hiddenOnly = false } = {}) {
  const code = CODE_EXT.has(extname(path)) || isExecutedConfig(path)
  const config = isExecutedConfig(path) && !hiddenOnly

  text.split('\n').forEach((line, i) => {
    if (line.includes('security-scan: allow')) return
    const at = i + 1

    if (!hiddenOnly) {
      for (const [pattern, label] of SECRETS) {
        if (pattern.test(line)) report(path, at, 'secret', label)
      }
      for (const match of line.matchAll(DB_URL)) {
        const placeholder = /[${}<>*]/.test(match[0]) || PLACEHOLDER_PASSWORD.test(match[1])
        if (!placeholder && !LOCAL_HOSTS.test(match[2])) {
          report(path, at, 'secret', `database URL with password (host ${match[2]})`)
        }
      }
    }

    if (code) {
      for (const [pattern, label] of HIDDEN_CODE) {
        if (pattern.test(line)) report(path, at, 'hidden-code', label)
      }
    }
    if (config) {
      if (line.length > CONFIG_MAX_LINE) report(path, at, 'config', `line is ${line.length} characters long`)
      for (const [pattern, label] of CONFIG_RED_FLAGS) {
        if (pattern.test(line)) report(path, at, 'config', label)
      }
    }
  })
}

// The scanner's own patterns would match its secret and config rules; it is still checked for hidden code.
const SELF = 'scripts/security/scan.mjs'

for (const path of listFiles()) {
  if (path.split('/').some((part) => SKIP_DIRS.has(part))) continue
  // Without git, local env files are untracked by definition and hold real secrets on purpose.
  if (!fromGit && /^\.env(\..+)?$/.test(basename(path))) continue
  checkPath(path)

  const buffer = readContent(path)
  if (!buffer) continue
  // Padding a file past the size limit or adding a NUL byte must not hide code from the scan:
  // JavaScript still runs such files. Only non-code files may be skipped as large or binary.
  const isCode = CODE_EXT.has(extname(path)) || isExecutedConfig(path) || basename(path) === 'package.json'
  const tooLarge = buffer === 'too-large' || buffer.length > MAX_BYTES
  if (tooLarge || buffer.includes(0)) {
    if (isCode) report(path, 0, 'unscannable', tooLarge ? 'code file over 2 MB' : 'code file contains NUL bytes')
    continue
  }
  const text = buffer.toString('utf8')

  if (LOCKFILES.has(basename(path))) {
    checkLockfile(path, text)
    continue
  }
  if (basename(path) === 'package.json') checkPackageJson(path, text)
  checkText(path, text, { hiddenOnly: path === SELF })
}

if (findings.length === 0) {
  console.log(`security-scan: clean${STAGED ? ' (staged files)' : ''}`)
  process.exit(0)
}

console.error(`\nsecurity-scan: ${findings.length} problem(s) found\n`)
for (const { path, line, rule, message } of findings) {
  console.error(`  ${path}${line ? `:${line}` : ''}  [${rule}]  ${message}`)
}
console.error(
  '\nIf this is your own change and it is safe, add the comment `security-scan: allow` to the line.' +
    '\nIf you did not write it, do not run the project: this matches how this repo was attacked.\n',
)
process.exit(WARN_ONLY ? 0 : 1)
