// Minimal ONNX (protobuf) reader — enough to dump a graph's nodes, shapes and
// initializers, and to export raw weights. Avoids pulling a protobuf library in
// just to read one model.
//
//   node tools/onnx-inspect.mjs <model.onnx> [--weights out.bin]

import fs from 'node:fs'

const WIRE = { VARINT: 0, I64: 1, LEN: 2, I32: 5 }

function reader(buf) {
  let p = 0
  const varint = () => {
    let result = 0n
    let shift = 0n
    for (;;) {
      const b = buf[p++]
      result |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7n
    }
    return result
  }
  return {
    get pos() {
      return p
    },
    set pos(v) {
      p = v
    },
    get done() {
      return p >= buf.length
    },
    varint,
    num: () => Number(varint()),
    skip(wire) {
      if (wire === WIRE.VARINT) varint()
      else if (wire === WIRE.I64) p += 8
      else if (wire === WIRE.I32) p += 4
      // NB: must read the length into a local first. `p += Number(varint())`
      // captures p BEFORE varint() advances it, so the length prefix gets
      // counted twice and every subsequent field is misaligned.
      else if (wire === WIRE.LEN) {
        const n = Number(varint())
        p += n
      }
      else return false // groups (3/4) and anything invalid: stop cleanly
      return true
    },
    bytes() {
      const n = Number(varint())
      const b = buf.subarray(p, p + n)
      p += n
      return b
    },
  }
}

/** Walk a message, calling fn(fieldNumber, wireType, reader). fn may return
 *  'stop' to end the walk early. */
function walk(buf, fn) {
  const r = reader(buf)
  while (!r.done) {
    const tag = r.num()
    const field = tag >> 3
    const wire = tag & 7
    const handled = fn(field, wire, r)
    if (handled === 'stop') return
    if (!handled && !r.skip(wire)) return
  }
}

function parseTensor(buf) {
  const t = { dims: [], dataType: 0, name: '', raw: null, floats: null }
  walk(buf, (f, w, r) => {
    if (f === 1 && w === WIRE.VARINT) {
      t.dims.push(r.num())
      return true
    }
    if (f === 1 && w === WIRE.LEN) {
      const b = r.bytes()
      walk(b, (_, __, rr) => {
        t.dims.push(rr.num())
        return true
      })
      return true
    }
    if (f === 2 && w === WIRE.VARINT) {
      t.dataType = r.num()
      return true
    }
    if (f === 4 && w === WIRE.LEN) {
      const b = r.bytes()
      const out = []
      for (let i = 0; i + 4 <= b.length; i += 4) out.push(b.readFloatLE(i))
      t.floats = out
      return true
    }
    if (f === 8 && w === WIRE.LEN) {
      t.name = Buffer.from(r.bytes()).toString('utf8')
      return true
    }
    if (f === 9 && w === WIRE.LEN) {
      t.raw = Buffer.from(r.bytes())
      return true
    }
    return false
  })
  return t
}

function parseAttribute(buf) {
  const a = { name: '', i: null, ints: [], type: 0, t: null, s: null }
  walk(buf, (f, w, r) => {
    if (f === 1 && w === WIRE.LEN) {
      a.name = Buffer.from(r.bytes()).toString('utf8')
      return true
    }
    // field 5 = t (TensorProto) — this model stores its weights in Constant
    // nodes rather than graph initializers, so this is where they live.
    if (f === 5 && w === WIRE.LEN) {
      a.t = parseTensor(r.bytes())
      return true
    }
    if (f === 3 && w === WIRE.VARINT) {
      a.i = r.num()
      return true
    }
    // field 4 = s (string). DepthToSpace's `mode` lives here and decides the
    // sub-pixel channel ordering — DCR vs CRD are NOT interchangeable.
    if (f === 4 && w === WIRE.LEN) {
      a.s = Buffer.from(r.bytes()).toString('utf8')
      return true
    }
    if (f === 8 && w === WIRE.VARINT) {
      a.ints.push(r.num())
      return true
    }
    if (f === 8 && w === WIRE.LEN) {
      const b = r.bytes()
      walk(b, (_, __, rr) => {
        a.ints.push(rr.num())
        return true
      })
      return true
    }
    if (f === 20 && w === WIRE.VARINT) {
      a.type = r.num()
      return true
    }
    return false
  })
  return a
}

function parseNode(buf) {
  const n = { input: [], output: [], name: '', opType: '', attrs: [] }
  walk(buf, (f, w, r) => {
    if (w !== WIRE.LEN) return false
    if (f === 1) {
      n.input.push(Buffer.from(r.bytes()).toString('utf8'))
      return true
    }
    if (f === 2) {
      n.output.push(Buffer.from(r.bytes()).toString('utf8'))
      return true
    }
    if (f === 3) {
      n.name = Buffer.from(r.bytes()).toString('utf8')
      return true
    }
    if (f === 4) {
      n.opType = Buffer.from(r.bytes()).toString('utf8')
      return true
    }
    if (f === 5) {
      n.attrs.push(parseAttribute(r.bytes()))
      return true
    }
    return false
  })
  return n
}

export function parseOnnx(path) {
  const buf = fs.readFileSync(path)
  let graph = null
  walk(buf, (f, w, r) => {
    if (f === 7 && w === WIRE.LEN) {
      graph = r.bytes()
      return 'stop'
    }
    return false
  })
  if (!graph) throw new Error('no graph found')

  const nodes = []
  const inits = []
  walk(graph, (f, w, r) => {
    if (w !== WIRE.LEN) return false
    if (f === 1) {
      nodes.push(parseNode(r.bytes()))
      return true
    }
    if (f === 5) {
      inits.push(parseTensor(r.bytes()))
      return true
    }
    return false
  })
  return { nodes, inits }
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('onnx-inspect.mjs')) {
  const path = process.argv[2]
  const { nodes, inits } = parseOnnx(path)
  const DT = { 1: 'float32', 10: 'float16', 7: 'int64', 6: 'int32' }

  console.log(`nodes: ${nodes.length}   initializers: ${inits.length}\n`)
  const counts = {}
  for (const n of nodes) counts[n.opType] = (counts[n.opType] || 0) + 1
  console.log('op histogram:', counts, '\n')

  const byName = new Map(inits.map((t) => [t.name, t]))
  console.log('--- graph ---')
  nodes.forEach((n, i) => {
    const attrs = n.attrs
      .filter((a) => a.ints.length || a.i !== null)
      .map((a) => `${a.name}=${a.ints.length ? '[' + a.ints.join(',') + ']' : a.i}`)
      .join(' ')
    const wshapes = n.input
      .map((inp) => (byName.has(inp) ? `${inp}${JSON.stringify(byName.get(inp).dims)}` : null))
      .filter(Boolean)
      .join(' ')
    console.log(
      `${String(i).padStart(3)} ${n.opType.padEnd(13)} in=${n.input.length} out=${n.output[0]}` +
        (wshapes ? `  W:${wshapes}` : '') +
        (attrs ? `  {${attrs}}` : ''),
    )
  })

  let total = 0
  const dtypes = new Set()
  for (const t of inits) {
    dtypes.add(DT[t.dataType] || t.dataType)
    total += t.dims.reduce((a, b) => a * b, 1)
  }
  console.log(`\nparameters: ${total.toLocaleString()}   dtypes: ${[...dtypes].join(', ')}`)
}
