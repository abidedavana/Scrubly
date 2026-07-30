// CPU reference implementation of the SPAN 2x graph, executed from weights
// extracted by onnx-inspect.mjs.
//
// Purpose: prove the weight extraction and the understanding of the graph are
// correct BEFORE writing any GPU code. If this matches onnxruntime bit-for-bit
// (to float tolerance), then the WGSL port is a mechanical translation of these
// same ops and any later mismatch is a shader bug, not a misread model.
//
//   node tools/span-reference.mjs <model.onnx>            # verify vs ORT
//   node tools/span-reference.mjs <model.onnx> --export weights.bin

import fs from 'node:fs'
import { parseOnnx } from './onnx-inspect.mjs'

/** TensorProto -> Float32Array (handles raw_data and float_data). */
function tensorFloats(t) {
  if (t.floats) return Float32Array.from(t.floats)
  if (t.raw) {
    if (t.dataType === 1) {
      const out = new Float32Array(t.raw.length / 4)
      for (let i = 0; i < out.length; i++) out[i] = t.raw.readFloatLE(i * 4)
      return out
    }
    if (t.dataType === 7) {
      // int64 -> numbers (used for shapes/scalars)
      const out = new Float32Array(t.raw.length / 8)
      for (let i = 0; i < out.length; i++) out[i] = Number(t.raw.readBigInt64LE(i * 8))
      return out
    }
  }
  return new Float32Array(0)
}

const numel = (dims) => dims.reduce((a, b) => a * b, 1)

export function loadGraph(path) {
  const { nodes } = parseOnnx(path)
  const consts = new Map()
  for (const n of nodes) {
    if (n.opType !== 'Constant') continue
    const a = n.attrs.find((x) => x.t)
    if (a) consts.set(n.output[0], { dims: a.t.dims, data: tensorFloats(a.t) })
  }
  const ops = nodes.filter((n) => n.opType !== 'Constant')
  return { nodes, ops, consts }
}

// ---- tensor helpers (NCHW, batch always 1) ----

const T = (c, h, w, data) => ({ c, h, w, data: data || new Float32Array(c * h * w) })

function conv2d(x, W, wDims, B, pad) {
  const [oc, ic, kh, kw] = wDims
  const out = T(oc, x.h, x.w)
  const ph = pad ? (kh - 1) >> 1 : 0
  const pw = pad ? (kw - 1) >> 1 : 0
  for (let o = 0; o < oc; o++) {
    const ob = B ? B[o] : 0
    for (let y = 0; y < x.h; y++) {
      for (let xx = 0; xx < x.w; xx++) {
        let acc = ob
        for (let i = 0; i < ic; i++) {
          const xBase = i * x.h * x.w
          const wBase = ((o * ic + i) * kh) * kw
          for (let ky = 0; ky < kh; ky++) {
            const sy = y + ky - ph
            if (sy < 0 || sy >= x.h) continue
            for (let kx = 0; kx < kw; kx++) {
              const sx = xx + kx - pw
              if (sx < 0 || sx >= x.w) continue
              acc += x.data[xBase + sy * x.w + sx] * W[wBase + ky * kw + kx]
            }
          }
        }
        out.data[o * x.h * x.w + y * x.w + xx] = acc
      }
    }
  }
  return out
}

/** Elementwise with NumPy-style broadcasting over (C,H,W). */
function ew(a, b, f) {
  const c = Math.max(a.c, b.c)
  const h = Math.max(a.h, b.h)
  const w = Math.max(a.w, b.w)
  const out = T(c, h, w)
  const at = (t, ci, yi, xi) =>
    t.data[(t.c === 1 ? 0 : ci) * t.h * t.w + (t.h === 1 ? 0 : yi) * t.w + (t.w === 1 ? 0 : xi)]
  for (let ci = 0; ci < c; ci++)
    for (let yi = 0; yi < h; yi++)
      for (let xi = 0; xi < w; xi++)
        out.data[ci * h * w + yi * w + xi] = f(at(a, ci, yi, xi), at(b, ci, yi, xi))
  return out
}

function depthToSpace(x, bs, mode) {
  const oc = x.c / (bs * bs)
  const oh = x.h * bs
  const ow = x.w * bs
  const out = T(oc, oh, ow)
  // Two incompatible channel orderings, and picking the wrong one silently
  // produces an image with correct statistics but scrambled sub-pixels:
  //   DCR (ONNX default): channel = (by*bs + bx)*oc + c
  //   CRD (what this model uses): channel = c*bs*bs + by*bs + bx
  const crd = mode === 'CRD'
  for (let c = 0; c < oc; c++)
    for (let by = 0; by < bs; by++)
      for (let bx = 0; bx < bs; bx++) {
        const src = crd ? c * bs * bs + by * bs + bx : (by * bs + bx) * oc + c
        for (let y = 0; y < x.h; y++)
          for (let xx = 0; xx < x.w; xx++)
            out.data[c * oh * ow + (y * bs + by) * ow + (xx * bs + bx)] =
              x.data[src * x.h * x.w + y * x.w + xx]
      }
  return out
}

export function runGraph(g, input) {
  const vals = new Map()
  vals.set('input', input)
  for (const [k, v] of g.consts) {
    const d = v.dims
    if (d.length === 4) vals.set(k, T(d[1], d[2], d[3], v.data))
    else if (d.length === 3) vals.set(k, T(d[0], d[1], d[2], v.data))
    else if (d.length === 1) vals.set(k, T(d[0], 1, 1, v.data))
    else vals.set(k, T(1, 1, 1, v.data))
  }
  const get = (n) => {
    const v = vals.get(n)
    if (!v) throw new Error('missing tensor ' + n)
    return v
  }

  for (const n of g.ops) {
    let out
    switch (n.opType) {
      case 'Conv': {
        const wc = g.consts.get(n.input[1])
        const bc = n.input[2] ? g.consts.get(n.input[2]) : null
        const padAttr = n.attrs.find((a) => a.name === 'pads')
        const pad = padAttr ? padAttr.ints.some((p) => p > 0) : false
        out = conv2d(get(n.input[0]), wc.data, wc.dims, bc ? bc.data : null, pad)
        break
      }
      case 'Sigmoid': {
        const a = get(n.input[0])
        out = T(a.c, a.h, a.w)
        for (let i = 0; i < a.data.length; i++) out.data[i] = 1 / (1 + Math.exp(-a.data[i]))
        break
      }
      case 'Mul':
        out = ew(get(n.input[0]), get(n.input[1]), (p, q) => p * q)
        break
      case 'Add':
        out = ew(get(n.input[0]), get(n.input[1]), (p, q) => p + q)
        break
      case 'Sub':
        out = ew(get(n.input[0]), get(n.input[1]), (p, q) => p - q)
        break
      case 'Concat': {
        const parts = n.input.map(get)
        const c = parts.reduce((s, p) => s + p.c, 0)
        out = T(c, parts[0].h, parts[0].w)
        let off = 0
        for (const p of parts) {
          out.data.set(p.data, off)
          off += p.data.length
        }
        break
      }
      case 'DepthToSpace': {
        const bs = n.attrs.find((a) => a.name === 'blocksize').i
        const modeAttr = n.attrs.find((a) => a.name === 'mode')
        out = depthToSpace(get(n.input[0]), bs, modeAttr ? modeAttr.s : 'DCR')
        break
      }
      case 'Clip': {
        const a = get(n.input[0])
        const lo = n.input[1] ? get(n.input[1]).data[0] : -Infinity
        const hi = n.input[2] ? get(n.input[2]).data[0] : Infinity
        out = T(a.c, a.h, a.w)
        for (let i = 0; i < a.data.length; i++)
          out.data[i] = Math.min(hi, Math.max(lo, a.data[i]))
        break
      }
      default:
        throw new Error('unhandled op ' + n.opType)
    }
    vals.set(n.output[0], out)
  }
  return vals.get(g.ops[g.ops.length - 1].output[0])
}

/**
 * Pack weights for the GPU: a small JSON manifest plus one flat Float32 blob.
 * Conv weights stay in ONNX [outC,inC,kh,kw] order; the shader indexes them
 * directly, so no reordering is needed and the manifest stays trivial.
 */
export function exportWeights(g, outPath) {
  const entries = []
  let total = 0
  for (const [name, t] of g.consts) {
    if (numel(t.dims) < 4) continue // scalars stay in the manifest
    entries.push({ name, dims: t.dims, offset: total })
    total += numel(t.dims)
  }
  const blob = new Float32Array(total)
  for (const e of entries) blob.set(g.consts.get(e.name).data, e.offset)
  const scalars = {}
  for (const [name, t] of g.consts) if (numel(t.dims) < 4) scalars[name] = Array.from(t.data)
  fs.writeFileSync(outPath, Buffer.from(blob.buffer))
  fs.writeFileSync(
    outPath.replace(/\.bin$/, '.json'),
    JSON.stringify({ count: total, entries, scalars }, null, 1),
  )
  return { floats: total, bytes: blob.byteLength }
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('span-reference.mjs')) {
  const model = process.argv[2]
  const g = loadGraph(model)
  console.log(`ops: ${g.ops.length}  constants: ${g.consts.size}`)

  const ei = process.argv.indexOf('--export')
  if (ei > 0) {
    const r = exportWeights(g, process.argv[ei + 1])
    console.log(`exported ${r.floats.toLocaleString()} floats (${r.bytes.toLocaleString()} bytes)`)
  }

  const S = Number(process.argv[process.argv.indexOf('--size') + 1]) || 24
  const input = T(3, S, S)
  let seed = 5
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < input.data.length; i++) input.data[i] = rnd()

  console.log(`running reference forward pass on ${S}x${S}...`)
  const t0 = Date.now()
  const out = runGraph(g, input)
  console.log(`done in ${Date.now() - t0} ms -> output ${out.c}x${out.h}x${out.w}`)

  // Compare against onnxruntime
  const ort = (await import('onnxruntime-node')).default
  const session = await ort.InferenceSession.create(model)
  const feeds = {}
  feeds[session.inputNames[0]] = new ort.Tensor('float32', input.data, [1, 3, S, S])
  const res = await session.run(feeds)
  const ref = res[session.outputNames[0]].data

  let maxAbs = 0
  let sse = 0
  for (let i = 0; i < ref.length; i++) {
    const d = Math.abs(out.data[i] - ref[i])
    if (d > maxAbs) maxAbs = d
    sse += d * d
  }
  const rmse = Math.sqrt(sse / ref.length)
  console.log(`\nvs onnxruntime:  max abs diff ${maxAbs.toExponential(3)}   rmse ${rmse.toExponential(3)}`)
  console.log(maxAbs < 1e-3 ? 'MATCH — weight extraction and graph are correct' : 'MISMATCH')
  process.exit(maxAbs < 1e-3 ? 0 : 1)
}
