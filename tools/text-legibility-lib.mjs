// Shared helpers for the legibility and ambiguity measurements.

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
}



export function renderTextExport(text, xh, pad = 4) {
  const SS = 8
  const scale = xh / 7
  const gw = Math.round(5 * scale) + Math.max(1, Math.round(scale))
  const w = pad * 2 + gw * text.length
  const h = pad * 2 + xh
  const acc = new Float32Array(w * h)
  for (let i = 0; i < text.length; i++) {
    const g = FONT[text[i]] || FONT[' ']
    for (let sy = 0; sy < xh * SS; sy++) {
      for (let sx = 0; sx < Math.round(5 * scale) * SS; sx++) {
        const fy = Math.min(6, Math.floor(sy / SS / scale))
        const fx = Math.min(4, Math.floor(sx / SS / scale))
        if (g[fy][fx] === '1') {
          const px = pad + i * gw + Math.floor(sx / SS)
          const py = pad + Math.floor(sy / SS)
          if (px < w && py < h) acc[py * w + px] += 1 / (SS * SS)
        }
      }
    }
  }
  const d = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const ink = Math.min(1, acc[p])
    const v = 245 * (1 - ink) + 20 * ink
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v
    d[p * 4 + 3] = 255
  }
  return { data: d, w, h }
}

export function down2(img) {
  const w = img.w >> 1
  const h = img.h >> 1
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++)
        d[(y * w + x) * 4 + c] =
          (img.data[(2 * y * img.w + 2 * x) * 4 + c] +
            img.data[(2 * y * img.w + 2 * x + 1) * 4 + c] +
            img.data[((2 * y + 1) * img.w + 2 * x) * 4 + c] +
            img.data[((2 * y + 1) * img.w + 2 * x + 1) * 4 + c]) /
          4
  return { data: d, w, h }
}

export function blockify(img, amount) {
  const d = Uint8ClampedArray.from(img.data)
  for (let by = 0; by + 4 <= img.h; by += 4)
    for (let bx = 0; bx + 4 <= img.w; bx += 4)
      for (let c = 0; c < 3; c++) {
        let m = 0
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) m += img.data[((by + y) * img.w + bx + x) * 4 + c]
        m /= 16
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const i = ((by + y) * img.w + bx + x) * 4 + c
            d[i] = img.data[i] * (1 - amount) + m * amount
          }
      }
  return { data: d, w: img.w, h: img.h }
}