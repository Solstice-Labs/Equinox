import { describe, expect, it } from 'vitest'

import { ALL_PROBES, runProbeSuite, validateProbeSet } from '../src/index.ts'
import type { Probe } from '../src/index.ts'

const REPLIES: Record<string, (turn: number) => string> = {
  'syn-01': () => '{"user":{"id":7,"email":"a@b.co","tags":["x"]},"active":true}',
  'syn-02': () => '```json\n{"ok": true, "count": 3}\n```',
  'syn-03': () => '{"quote":"say \\"hi\\"","path":"C:\\\\dir\\\\file.txt","multiline":"line one\\nline two"}',
  'syn-04': () => '{"event":"a","ts":1}\n{"event":"b","ts":2}\n{"event":"c","ts":3}',
  'syn-05': () => '```txt\nhello\nhello\nhello\n```',
  'syn-06': () => '{"a":1.5,"b":0.25,"c":100,"d":-3,"e":0}',
  'syn-07': () => '{"yes":true,"no":false,"flag":null}',
  'syn-08': () => '{"a":"present","b":0,"c":null}',
  'syn-09': () => '{"greeting":"héllo 🌍","rocket":"🚀","japanese":"こんにちは"}',
  'syn-10': () => '[{"n":1},{"n":2}]',
  'cod-01': () => '```js\nasync function load() {\n  const a = await getA();\n  const b = await getB(a);\n  console.log(a + b);\n}\n```',
  'cod-02': () => '```ts\ninterface User {\n  id: number;\n  name: string;\n  email?: string;\n}\n```',
  'cod-03': () => '```js\nasync function fetchAll() {\n  const [a, b] = await Promise.all([fetchA(), fetchB()]);\n  return [a, b];\n}\n```',
  'cod-04': () => '```js\nfunction total(xs) {\n  let sum = 0;\n  for (let i = 0; i < xs.length; i++) {\n    sum += xs[i];\n  }\n  return sum;\n}\n```',
  'cod-05': () => '```js\nconst person = { name: "ada", age: 36 };\nconst { name, age } = person;\n```',
  'cod-06': () => '```js\nfunction port(cfg) {\n  return cfg.port ?? 8080;\n}\n```',
  'cod-07': () => '```js\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n```',
  'cod-08': () => '```js\nconst double = (xs) => xs.map((x) => x * 2);\n```',
  'cod-09': () => '```js\nasync function load(id) {\n  try {\n    const res = await fetch(`/api/${id}`);\n    return await res.json();\n  } catch (e) {\n    return null;\n  }\n}\n```',
  'cod-10': () => '```js\nfunction sum(a, b) {\n  return a + b;\n}\nconst VERSION = "1.0";\nexport { sum, VERSION };\n```',
  'log-01': () => '{"regions":{"A":"red","B":"blue","C":"green","D":"blue"}}',
  'log-02': () => '{"subset":[5,12],"sum":17}',
  'log-03': () => '{"plan":[{"task":"T1","start":9},{"task":"T2","start":13},{"task":"T3","start":10}]}',
  'log-04': () => '{"chosen":["a","c"],"weight":10,"value":50}',
  'log-05': () => '{"seats":["Bob","Ann","Dan","Cy"]}',
  'log-06': () => '{"moves":[["A","C"],["A","B"],["C","B"],["A","C"],["B","A"],["B","C"],["A","C"]]}',
  'log-07': () => '{"path":[[0,0],[1,0],[2,0],[2,1],[2,2]]}',
  'log-08': () => '{"A":4,"B":5,"C":9}',
  'log-09': () => '{"slots":[{"talk":"T1","room":"R1","hour":9},{"talk":"T2","room":"R1","hour":10},{"talk":"T3","room":"R2","hour":9}]}',
  'log-10': () => '{"bits":[0,1,0,0,1,0]}',
  'ins-01': () => 'a variable is a named container that holds a value which can change while a program runs and it gives us a way to refer to data',
  'ins-02': () => '- catches regressions early\n- documents intent\n- enables safe refactors\n- speeds up debugging\n- builds team confidence',
  'ins-03': () => 'RESULT: Paris, with a population of about two point one million people inside the city limits.',
  'ins-04': () => 'My favorite season is autumn. The air turns crisp and the leaves shift from green to gold. I love walking through the park in that light.',
  'ins-05': () => 'i am sorry for the late review. it slipped past me and that was on me.',
  'ins-06': () => 'TCP is a connection-oriented protocol that guarantees ordered, reliable delivery with retransmission, while UDP is a connectionless protocol that sends datagrams with no guarantees, making TCP suitable for file transfers and UDP suitable for real-time streaming and gaming.',
  'ins-07': () => 'a very large land mammal with a trunk lives in africa and asia, weighs several tons, and eats mostly plants and water.',
  'ins-08': () => "The water cycle of evaporation, condensation, and precipitation recycles Earth's water.---END---",
  'ins-09': () => 'Caching keeps copies of frequently used data close to where it is needed, so a request can be answered from the fast local copy instead of recomputing or re-fetching the slow original. When a cache misses, the system fetches from the source and stores the result. Repeated reads then return instantly, latency drops dramatically, load on the origin server falls, and users experience snappier applications.',
  'ins-10': () => 'my workspace has a wide desk and a bright window. a keyboard, a notebook, and a small plant keep things simple and calm.',
  'too-01': t =>
    [
      '{"tool":"write_file","args":{"path":"greeting.txt","content":"hello world"}}',
      '{"tool":"read_file","args":{"path":"greeting.txt"}}',
      '{"tool":"rm","args":{"path":"greeting.txt"}}',
    ][t] as string,
  'too-02': t =>
    [
      '{"tool":"write_file","args":{"path":"count.txt","content":"0"}}',
      '{"tool":"write_file","args":{"path":"count.txt","content":"1"}}',
      '{"tool":"write_file","args":{"path":"count.txt","content":"2"}}',
    ][t] as string,
  'too-03': t =>
    [
      '{"tool":"write_file","args":{"path":"log.txt","content":"one\\n"}}',
      '{"tool":"append_file","args":{"path":"log.txt","content":"two\\n"}}',
      '{"tool":"append_file","args":{"path":"log.txt","content":"three\\n"}}',
    ][t] as string,
  'too-04': t =>
    [
      '{"tool":"mkdir","args":{"path":"reports"}}',
      '{"tool":"write_file","args":{"path":"reports/quarterly.md","content":"Q3 results"}}',
      '{"tool":"ls","args":{"path":"reports"}}',
    ][t] as string,
  'too-05': t =>
    [
      '{"tool":"write_file","args":{"path":"a.txt","content":"42"}}',
      '{"tool":"read_file","args":{"path":"a.txt"}}',
      '{"tool":"write_file","args":{"path":"b.txt","content":"42"}}',
    ][t] as string,
  'too-06': t =>
    [
      '{"tool":"mkdir","args":{"path":"data"}}',
      '{"tool":"write_file","args":{"path":"data/x.csv","content":"a,b"}}',
      '[{"tool":"write_file","args":{"path":"data/y.csv","content":"c,d"}},{"tool":"ls","args":{"path":"data"}}]',
    ][t] as string,
  'too-07': t =>
    [
      '{"tool":"ls","args":{}}',
      '{"tool":"rm","args":{"path":"missing.txt"}}',
      '{"tool":"write_file","args":{"path":"ok.txt","content":"done"}}',
    ][t] as string,
  'too-08': t =>
    [
      '{"tool":"write_file","args":{"path":"phrase.txt","content":"one two three"}}',
      '{"tool":"read_file","args":{"path":"phrase.txt"}}',
      '{"tool":"write_file","args":{"path":"phrase.txt","content":"one red three"}}',
      '{"tool":"read_file","args":{"path":"phrase.txt"}}',
    ][t] as string,
  'too-09': (t) => {
    const contents = [
      '{"name":"app"}',
      '{"name":"app","version":"1.0.0"}',
      '{"name":"app","version":"1.0.0","id":"abc123"}',
    ]
    return JSON.stringify({ tool: 'write_file', args: { path: 'config.json', content: contents[t] } })
  },
  'too-10': t =>
    [
      '{"tool":"mkdir","args":{"path":"tmp"}}',
      '{"tool":"rm","args":{"path":"tmp/a.tmp"}}',
      '[{"tool":"rm","args":{"path":"tmp/b.tmp"}},{"tool":"ls","args":{"path":"tmp"}}]',
    ][t] as string,
}

function mockReply(probe: Probe, turn: number): string {
  const reply = REPLIES[probe.id]
  if (!reply) throw new Error(`no mock reply registered for ${probe.id}`)
  return reply(turn)
}

describe('probe set integrity', () => {
  it('has exactly 50 probes: 10 per domain, unique ids', () => {
    const result = validateProbeSet(ALL_PROBES)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe('probe graders (deterministic, offline)', () => {
  it('passes the 50 probes when the model answers correctly', async () => {
    const suite = await runProbeSuite({ mockReply })
    expect(suite.outcomes).toHaveLength(50)
    const failed = suite.outcomes.filter(o => !o.pass)
    expect(failed.map(f => `${f.id}: ${f.detail}`)).toEqual([])
    expect(suite.composite).toBe(1)
  })

  it('fails probes when answers violate constraints', async () => {
    const sneaky: Record<string, string> = {
      'syn-01': '{"user":{"id":"seven","email":"nope"},"active":"yes"}', // wrong types
      'syn-04': '{"a":1}\n{"b":2}', // only 2 lines
      'log-01': '{"regions":{"A":"red","B":"red","C":"green","D":"blue"}}', // A-B conflict
      'log-10': '{"bits":[1,1,0,0,0,0]}', // adjacent 1s + wrong count
      'ins-02': '- one\n- two', // not 5 bullets
      'ins-01': 'this answer contains 3 digits', // digits present
    }
    const probeById = new Map(ALL_PROBES.map(p => [p.id, p]))
    for (const [id, reply] of Object.entries(sneaky)) {
      const probe = probeById.get(id)!
      if (probe.kind === 'tool-flow') continue
      const result = probe.grader!(reply)
      expect(result.pass, `${id} should fail: ${result.detail}`).toBe(false)
    }
  })

  it('tool-flow probes pass end-to-end through the runner', async () => {
    const suite = await runProbeSuite({
      probes: ALL_PROBES.filter(p => p.id === 'too-01' || p.id === 'too-07' || p.id === 'too-10'),
      mockReply,
    })
    expect(suite.outcomes.every(o => o.pass)).toBe(true)
  })
})
