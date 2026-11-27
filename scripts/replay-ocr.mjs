import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { electronTestShim } from './test-electron-shim.mjs'

const output = path.resolve('node_modules/.cache/ew-tests/ocr-replay.cjs')
await mkdir(path.dirname(output), { recursive: true })
await build({ entryPoints: ['tests/ocr-replay.ts'], bundle: true, platform: 'node',
  target: 'node18', format: 'cjs', outfile: output, external: ['sharp', 'tesseract.js'], plugins: [electronTestShim] })
const child = spawn(process.execPath, [output, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
