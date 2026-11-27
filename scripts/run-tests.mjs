import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { electronTestShim } from './test-electron-shim.mjs'

const outdir = path.resolve('node_modules/.cache/ew-tests')
await mkdir(outdir, { recursive: true })
await build({ entryPoints: ['tests/recognition.test.ts', 'tests/live-store.test.ts', 'tests/riven-parser.test.ts'],
  bundle: true, platform: 'node', target: 'node18', format: 'cjs', outdir,
  plugins: [electronTestShim],
  outExtension: { '.js': '.cjs' } })
const child = spawn(process.execPath, ['--test', ...['recognition', 'live-store', 'riven-parser'].map((name) => path.join(outdir, `${name}.test.cjs`))], { stdio: 'inherit' })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
