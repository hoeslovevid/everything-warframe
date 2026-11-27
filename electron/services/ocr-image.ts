import { createRequire } from 'node:module'
import { filterRelicPixels, filterRivenPixels, type WfThemeId } from './wfinfo-theme'
import { findRelicTextBand } from '../../shared/ocr-quality'

export type OcrPixels = { data: Uint8Array; width: number; height: number }
const nodeRequire = createRequire(__filename)

/** The live scanner and offline replay use exactly the same mask and resampling. */
export async function prepareOcrPixels(source: OcrPixels, opts: {
  mode: 'relic' | 'riven'; filtered: boolean; theme?: WfThemeId | null; targetWidth: number
}): Promise<Buffer> {
  const sharp = nodeRequire('sharp') as typeof import('sharp')
  let data: Buffer = Buffer.from(source.data)
  const { width, height } = source
  const useMask = opts.filtered && (opts.mode === 'riven' || Boolean(opts.theme))
  if (useMask) {
    // Electron supplies BGRA; the common preparation interface accepts RGBA.
    for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2], data[i]]
    data = opts.mode === 'riven' ? filterRivenPixels(data, width, height)
      : filterRelicPixels(data, width, height, opts.theme!)
  }
  let image = sharp(data, { raw: { width, height, channels: 4 } })
  if (opts.mode === 'relic' && useMask) {
    const band = findRelicTextBand(data, width, height)
    if (band) image = image.extract({ left: 0, top: band.top, width, height: band.height })
  }
  image = image.grayscale().normalize()
  image = useMask ? image.sharpen({ sigma: .6 }) : image.negate().linear(1.3, -12)
  const rendered = await image.resize({ width: Math.max(64, Math.min(1800, opts.targetWidth)), kernel: 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true })
  // Materialize contrast before padding: sharp's fixed operation ordering would
  // otherwise invert the white border on the unfiltered fallback.
  return sharp(rendered.data, { raw: { width: rendered.info.width, height: rendered.info.height, channels: rendered.info.channels } })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#ffffff' })
    .png().toBuffer()
}
