# Fixtures: deterministic workload

Every candidate app, the local server and the acceptance checks read the same workload bytes from this
directory. The generator is plain Node.js (built-in modules only, no dependencies, no `package.json`), uses a fixed
seed and integer fixed-point values, and writes canonical text, so a regenerated file is byte-identical on any
machine.

```
fixtures/
├── generator/
│   ├── profiles.json   # workload profiles (counts, rates, seed): the generator input
│   ├── lib.mjs         # PRNG, dataset, update stream, canonical serialization, digests
│   ├── cli.mjs         # check | write | verify | copy
│   └── selftest.mjs    # determinism + invariant self-test
└── v1/                 # generated, committed, never edited by hand
    ├── small.json  representative.json  stress.json
    ├── golden.json     # per-profile SHA-256, state/Insights digests, stream checksum, seq-0 summary
    └── SHA256SUMS      # `shasum -a 256 -c` / `sha256sum -c` compatible
```

## Profiles

| Parameter | small | representative (baseline) | stress | Why it exists |
|---|---|---|---|---|
| items | 30 | 300 | 3000 | longer than a screen, so list virtualization and scrolling matter; stress probes scaling |
| options per item | 3 | 3 | 3 | several interactive targets and values per row. Fixed by the semantics |
| initial selections | 5 | 50 | 500 | a second collection that references list items: derived count/total, a second live screen |
| update rate (messages/s) | 5 | 20 | 100 | continuous update pressure while idle and while scrolling (every 50 ms at baseline) |
| values per message | 3 | 3 | 3 | one value per option, so each message rewrites one whole row. Fixed by the semantics |
| seed | 42 | 42 | 42 | reproducibility; any seed keeps the semantics |
| value range | 100–9999 | 100–9999 | 100–9999 | integers, scale 100 (displayed `1.00`–`99.99`), so serialization is byte-identical in every language |

Profiles change only counts, rates and the seed. `lib.mjs` rejects a profile that changes options per item, values
per message or the value range. These numbers are configurable baseline parameters, not recommendations.

## Algorithm (normative, `algorithmVersion` 1)

```
mulberry32(state): state = (state + 0x6D2B79F5) mod 2^32; t = state
  t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0
fmix32(h): h ^= h >>> 16; h = imul(h, 0x85EBCA6B); h ^= h >>> 13; h = imul(h, 0xC2B2AE35); h ^= h >>> 16
seedFor(seed, purpose) = fmix32((seed ^ imul(purpose, 0x9E3779B9)) >>> 0)   purposes: 1 values, 2 groups,
                                                                            3 selection, 4 stream
nextInt(n): limit = 2^32 - (2^32 mod n); repeat u = next() until u < limit; return u mod n   (unbiased)
groups:    for i in 0..N-1: g[i] = nextInt_groups(8)
values:    for i in 0..N-1, j in 0..2: v[i][j] = 100 + nextInt_values(9900)
selection: a = [0..N-1]; for k in 0..S-1: r = k + nextInt_sel(N - k); swap(a[k], a[r]); o[k] = nextInt_sel(3)
           entries (a[k], o[k]) sorted by item index
stream k >= 1: i = nextInt_stream(N); for j in 0..2: x = 100 + nextInt_stream(9900)
               if x == current[i][j] then x = 100 + ((x - 100 + 1) mod 9900); current[i][j] = x
```

Only Node runs the PRNG (this generator and the local server, which imports `updateStream` from `lib.mjs`).
Candidates never port it. They only parse the fixture, apply update messages and compute digests.

## File formats

Fixture (`v1/<profile>.json`): UTF-8 (ASCII only), LF line endings, trailing newline, integers only, fixed key order,
one item or selection entry per line. Labels are derived from `i` (`Item 042`), never stored.

```json
{
  "schema": "mobilebench.fixture/1.0.0",
  "fixtureVersion": "1.0.0",
  "profile": "representative",
  "seed": 42,
  "generator": { "prng": "mulberry32", "algorithmVersion": 1 },
  "valueScale": 100,
  "valueRange": [100, 9999],
  "items": [
    { "i": 0, "g": 0, "v": [1656, 8378, 1277] },
    ...
  ],
  "selection": [
    { "i": 4, "o": 0 },
    ...
  ]
}
```

`i` = item index, `g` = group 0–7, `v` = option values A/B/C, `o` = option index 0–2 (A/B/C). At most one option
per item is selected.

Update frame (wire form, compact JSON, no whitespace): `{"t":"u","s":17,"i":42,"v":[1234,567,8910]}`. Each message
replaces all three values of item `i`, and every new value differs from the item's current value.

State digest: lowercase hex SHA-256 of this text, every line LF-terminated:

```
mb-state-v1
profile=<profile>
seq=<last applied seq>
values=<v0A>,<v0B>,<v0C>,<v1A>,...
selection=<i>:<A|B|C>,...
```

Insights digest: SHA-256 of `mb-insights-v1\nseq=<s>\ntop=<i>:<vA>,... (5)\nbuckets=<c0>,...,<c4>\n`, where top =
the 5 items with the highest option A value (ties: lower index first) and bucket = `min(4, floor((vB - 100) * 5 / 9900))`.

`golden.json` per profile: file SHA-256 and byte count, profile parameters, `seq0Summary` (selected count, integer
total and its display text `fmt(total)`, which the summary bar shows at the first usable UI), state and Insights
digests at seq 0, 100, 1000 and 10000 (initial selection, stream applied from seq 1), and the SHA-256 of the first
10000 update frames, each followed by LF. Display formatting needs no locale API:
`fmt(v) = floor(v / 100) + "." + pad2(v mod 100)`.

## How candidates consume the same bytes

Rule: candidates embed the committed fixture bytes unchanged. They never edit, reformat or re-serialize them,
and they never commit a copy inside their own directory.

1. Before building, the candidate's build copies the files with the verifying copy command (output dir gitignored
   by the candidate):
   ```sh
   node fixtures/generator/cli.mjs copy candidates/<id>/<generated-asset-dir> --profiles small,representative,stress
   ```
   It verifies `v1/` first, copies the fixture files plus `golden.json` and `SHA256SUMS`, then verifies the copy.
   Any later build step can re-check with `node fixtures/generator/cli.mjs verify <dir>` (exit code 1 on any
   mismatch). Gradle, Xcode and webpack can also point straight at `fixtures/v1/` when the toolkit allows paths
   outside the project.
2. Per toolkit:
   - Android (fully native, island host, RN/NativeScript Android projects): add the copied dir as an assets source
     dir and read it with `AssetManager.open("<profile>.json")`. APK compression does not change the extracted
     bytes.
   - iOS (fully native, island host, RN/NativeScript iOS projects): add the copied dir as a folder reference to
     *Copy Bundle Resources* and read it with `Bundle.main.url(forResource:withExtension:subdirectory:)`.
   - Flutter: `pubspec.yaml` assets must sit inside the package, so copy into the package (e.g.
     `assets/fixtures/`, gitignored) and read with `rootBundle.loadString`.
   - React Native (Metro, Expo, Re.Pack) and NativeScript (webpack): import the JSON through the bundler (Metro
     `watchFolders`/alias, webpack `resolve.alias`). The bundler inlines the parsed object, so the app holds the
     same data but not the same bytes. This is the documented legitimate difference "bundle-inlined in JS
     candidates vs runtime parse elsewhere"; the network-dataset scenario makes every runtime parse the same bytes
     at run time. The build check is the SHA-256 of the source file the bundler read, compared with `golden.json`.
   - Local server: serves `v1/<profile>.json` byte-identically (`ETag` = SHA-256) and produces the stream with
     `updateStream` / `serializeUpdate` from `generator/lib.mjs`.
3. Conformance check for every port: parse the fixture, compute the state digest at seq 0, and compare it with
   `golden.json` `stateDigests[0]`. With the stream applied, compare at seq 100 / 1000 / 10000.

## Commands

| Purpose | Command | Exit code |
|---|---|---|
| verify committed files equal the generator output | `node fixtures/generator/cli.mjs check` | 0 ok, 1 differs |
| regenerate (only with a `fixtureVersion` bump) | `node fixtures/generator/cli.mjs write [--out DIR]` | 0 |
| verify checksums of a dir | `node fixtures/generator/cli.mjs verify [DIR] [--all]` | 0 ok, 1 mismatch |
| copy into a candidate | `node fixtures/generator/cli.mjs copy DEST [--profiles a,b]` | 0 ok, 1 mismatch, 2 usage |
| determinism self-test | `node fixtures/generator/selftest.mjs` | 0 all pass, 1 any fail |
| independent checksum check | `cd fixtures/v1 && shasum -a 256 -c SHA256SUMS` | 0 ok |

The self-test generates every output twice in one process, then twice more in separate Node processes with
different `TZ` / `LANG` / `LC_ALL`. It requires all four generations and the committed `v1/` files to be
byte-identical, checks `SHA256SUMS` and `golden.json` against the bytes, and checks the canonical form, the
baseline parameters, the dataset invariants and the first 10000 stream messages of every profile. Temporary output
goes to the OS temp dir and is deleted, so `fixtures/` produces no build output and needs no `.gitignore`.

Changing the algorithm, the format or a profile changes the bytes. That requires a `fixtureVersion` bump in
`generator/lib.mjs` and `generator/profiles.json`, a regenerated `v1/` (or a new `v2/`), and a note in the change
log. Published results reference the fixture version and SHA-256, so an old result never silently points at new
data.

## Integration notes (for the repo tooling, not done here)

- Root `make fixtures` → `node fixtures/generator/selftest.mjs` (includes `check`); `make fixtures-write` →
  `node fixtures/generator/cli.mjs write`. CI runs `make fixtures`.
- `config/profiles.json` should be generated from, or checked against, `generator/profiles.json`, so the two cannot
  disagree.
- The JSON schema `mobilebench.fixture/1.0.0` (and `mobilebench.golden/1.0.0`) belongs in `schemas/v1/`.
- Conformance vectors for the Kotlin, Swift and Dart digest ports (`v1/conformance/vectors.json`) and the pure-JS
  SHA-256 for JS candidates belong to the reference-model module. `golden.json` already provides end-to-end digest
  vectors at four seq values per profile.

## Status

Run on 2026-10-22, macOS, Node v24.11.1, from the repository root. All commands were actually executed. Output is
quoted verbatim where it is short.

| # | Command | Result |
|---|---|---|
| 1 | `node fixtures/generator/cli.mjs write` | `wrote 5 files to fixtures/v1`, exit 0 (0.31 s wall) |
| 2 | `node fixtures/generator/cli.mjs write` again, then compared `SHA256SUMS` before/after | unchanged |
| 3 | `node fixtures/generator/cli.mjs check` | `ok: 5 files byte-identical to generator output`, exit 0 |
| 4 | `node fixtures/generator/cli.mjs verify` | `ok: 4 files match SHA256SUMS and golden.json in fixtures/v1 (fixtures: representative.json, small.json, stress.json)`, exit 0 |
| 5 | `cd fixtures/v1 && shasum -a 256 -c SHA256SUMS` | `golden.json: OK`, `representative.json: OK`, `small.json: OK`, `stress.json: OK`, exit 0 |
| 6 | `node fixtures/generator/selftest.mjs` | `9/9 checks passed`, exit 0 |
| 7 | `copy <tmp>/assets --profiles representative`, then `verify <tmp>/assets` | both exit 0 (`fixtures: representative.json`) |
| 8 | `verify <tmp>/assets --all` on that subset copy | exit 1, `missing: small.json`, `missing: stress.json` (expected) |
| 9 | appended one byte to the copied `representative.json`, then `verify <tmp>/assets` | exit 1, `checksum mismatch` + `golden.json sha256 mismatch` (expected) |
| 10 | `copy <tmp>/assets2 --profiles nope` | exit 2, `unknown profile(s): nope` (expected) |
| 11 | an inline Node script, independent of `lib.mjs`, rebuilt the seq-0 state text and the selection total from each committed fixture | seq-0 digest and total equal `golden.json` for all three profiles |

Generated files (SHA-256 from `v1/SHA256SUMS`):

| File | Bytes | SHA-256 |
|---|---|---|
| `small.json` | 1867 | `43467278d6dfb68e18c6c2724f189e3ca70bae6314db380eaf8a729c485b384a` |
| `representative.json` | 16658 | `e3ca6396851152171f7f42ae05063d90f446baf0a7a9d4d5a51c7b1d20829e19` |
| `stress.json` | 167692 | `95c1d99cdc1e483da945734bb0d2d0a33cb327854fe362f101748ff803b5d62d` |
| `golden.json` | 5697 | `929d41f525acc31068b1e607da202fe08f07fe90fc738e36e88fd4c9cd7e49d3` |

Seq-0 summary (selected count / total): small 5 / `331.93`, representative 50 / `1913.27`, stress 500 / `25923.79`.

Not verified here: generation on Linux or Windows, or on another Node major. The algorithm uses only 32-bit integer
operations, `Math.imul`, string concatenation and `node:crypto`, so no difference is expected, but CI on Linux has
not run yet.
