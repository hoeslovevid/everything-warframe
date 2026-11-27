/** Manual offline replay: npm run ocr:replay -- riven <crop.png> [more-crops.png] */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createWorker, PSM } from 'tesseract.js'
import { prepareOcrPixels } from '../electron/services/ocr-image'
import { parseRivenOcr } from '../electron/services/riven-grader'
import { preferReading } from '../shared/ocr-quality'
import { rankTextPixelThemes } from '../electron/services/wfinfo-theme'

async function main() {
  const [mode, ...files] = process.argv.slice(2)
  if (!['relic', 'riven'].includes(mode) || !files.length) throw new Error('Usage: npm run ocr:replay -- relic|riven <crop.png> [more.png]')
  const cachePath = path.resolve('node_modules/.cache/ew-tests/tesseract')
  await fs.mkdir(cachePath, { recursive: true })
  // Reuse a local model if present; no saved screenshots or private samples enter git.
  const local = path.resolve('eng.traineddata')
  try { await fs.copyFile(local, path.join(cachePath, 'eng.traineddata')) } catch { /* worker may download its usual model */ }
  const worker = await createWorker('eng', 1, { cachePath, logger: () => {} })
  try {
    await worker.setParameters({ tessedit_pageseg_mode: mode === 'riven' ? PSM.SPARSE_TEXT : PSM.SINGLE_LINE,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%+-.&' ", user_defined_dpi: '300' })
    for (const file of files) {
      const start = performance.now()
      let image = sharp(await fs.readFile(file))
      if (mode === 'riven') {
        const { width = 0, height = 0 } = await image.metadata()
        image = image.extract({ left: Math.round(width * .04), top: Math.round(height * .52),
          width: Math.round(width * .92), height: Math.floor(height * .47) })
      }
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const bgra = Buffer.from(data)
      for (let i = 0; i < bgra.length; i += 4) [bgra[i], bgra[i + 2]] = [bgra[i + 2], bgra[i]]
      const themes = rankTextPixelThemes(bgra, info.width, info.height)
      const prepared = await prepareOcrPixels({ data, width: info.width, height: info.height }, {
        mode: mode as 'relic' | 'riven', filtered: true, theme: themes[0], targetWidth: mode === 'riven' ? 1000 : info.width * 2,
      })
      if (process.env.EW_REPLAY_DEBUG === '1') await fs.writeFile(path.join(cachePath, 'prepared.png'), prepared)
      const { data: result } = await worker.recognize(prepared, {}, { text: true, blocks: false, hocr: false, tsv: false })
      let reading = { text: result.text, confidence: result.confidence }
      if (mode === 'relic' && reading.confidence < 65) for (const theme of themes.slice(1)) {
        const alternate = await prepareOcrPixels({ data, width: info.width, height: info.height }, { mode: 'relic', filtered: true, theme, targetWidth: info.width * 2 })
        const { data: next } = await worker.recognize(alternate, {}, { text: true, blocks: false, hocr: false, tsv: false })
        reading = preferReading(reading, { text: next.text, confidence: next.confidence })
        if (reading.confidence >= 65) break
      }
      if (mode === 'relic' && reading.confidence < 65) {
        const alternate = await prepareOcrPixels({ data, width: info.width, height: info.height }, {
          mode: 'relic', filtered: false, targetWidth: info.width * 2,
        })
        if (process.env.EW_REPLAY_DEBUG === '1') await fs.writeFile(path.join(cachePath, 'unfiltered.png'), alternate)
        const { data: next } = await worker.recognize(alternate, {}, { text: true, blocks: false, hocr: false, tsv: false })
        reading = preferReading(reading, { text: next.text, confidence: next.confidence })
      }
      const roll = mode === 'riven' ? parseRivenOcr(reading.text, 'current') : null
      console.log(JSON.stringify({ file: path.basename(file), durationMs: Math.round(performance.now() - start),
        confidence: reading.confidence, text: reading.text.trim(), weapon: roll?.weapon, stats: roll?.stats.map((s) => ({ name: s.name, value: s.value })) }))
    }
  } finally { await worker.terminate() }
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
