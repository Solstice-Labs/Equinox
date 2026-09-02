import { describe, expect, it } from 'vitest'

import { editFileTool, runCommandTool, SandboxFS, viewFileTool } from '@solsticeai/tools'
import type { ToolContext } from '@solsticeai/tools'

function ctx(fs: SandboxFS, cwd = '/workspace'): ToolContext {
  return { fs, cwd }
}

describe('SandboxFS', () => {
  it('round-trips write/read and tracks stats', () => {
    const fs = new SandboxFS()
    fs.write('a/b.txt', 'hello\nworld\n')
    expect(fs.read('a/b.txt')).toBe('hello\nworld\n')
    expect(fs.stat('a/b.txt')).toEqual({ type: 'file', size: 12, lines: 2 })
    fs.write('one.txt', 'single')
    expect(fs.stat('one.txt').lines).toBe(1)
    fs.write('empty.txt', '')
    expect(fs.stat('empty.txt').lines).toBe(0)
  })

  it('lists children with trailing slashes for dirs', () => {
    const fs = new SandboxFS()
    fs.write('src/main.ts', 'x')
    fs.write('README.md', 'y')
    expect(fs.ls('/')).toEqual(['README.md', 'src/'])
    expect(fs.ls('src')).toEqual(['main.ts'])
  })

  it('clamps .. traversal to the root (never escapes the in-memory tree)', () => {
    const fs = new SandboxFS()
    fs.write('a/b.txt', 'x')
    fs.write('../../etc/passwd', 'pwned')
    // '../..' collapses before 'etc/passwd' is created — it lands at the
    // sandbox root, not the host filesystem (SandboxFS never touches disk).
    expect(fs.exists('etc/passwd')).toBe(true)
    expect(fs.dump()['/etc/passwd']).toBe('pwned')
    expect(fs.resolve('../../etc/passwd')).toEqual(fs.resolve('/etc/passwd'))
    expect(fs.resolve('../../..')).toEqual([])
  })

  it('mkdir creates intermediate dirs; rm deletes', () => {
    const fs = new SandboxFS()
    fs.mkdir('x/y/z')
    expect(fs.ls('/')).toEqual(['x/'])
    fs.write('x/y/z/f.txt', '1')
    fs.rm('x/y/z/f.txt')
    expect(fs.exists('x/y/z/f.txt')).toBe(false)
  })

  it('rejects writes beyond the file cap', () => {
    const fs = new SandboxFS()
    fs.maxFileBytes = 8
    expect(() => fs.write('big.txt', 'this is longer than eight bytes')).toThrow(/cap/)
  })
})

describe('view_file', () => {
  it('renders 1-indexed 50-line windows', async () => {
    const fs = new SandboxFS()
    fs.write('note.txt', Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join('\n'))
    const first = await viewFileTool.run({ path: 'note.txt' }, ctx(fs))
    expect(first.ok).toBe(true)
    expect(first.output).toContain('lines 1-50 of 120')
    expect(first.output).toContain('1 | line 1')
    expect(first.output).toContain('50 | line 50')
    expect(first.output).toContain('70 more line(s)')
    const second = await viewFileTool.run({ path: 'note.txt', start_line: 51 }, ctx(fs))
    expect(second.output).toContain('51 | line 51')
    expect(second.output).toContain('100 | line 100')
    expect(second.output).toContain('20 more line(s)')
    const last = await viewFileTool.run({ path: 'note.txt', start_line: 101 }, ctx(fs))
    expect(last.output).toContain('lines 101-120 of 120')
    expect(last.output).toContain('--- end of file (120 lines) ---')
  })

  it('fails for missing files and out-of-range start', async () => {
    const fs = new SandboxFS()
    fs.write('a.txt', 'x')
    expect((await viewFileTool.run({ path: 'nope' }, ctx(fs))).ok).toBe(false)
    expect((await viewFileTool.run({ path: 'a.txt', start_line: 99 }, ctx(fs))).ok).toBe(false)
  })
})

describe('edit_file', () => {
  it('performs a unique surgical replacement', async () => {
    const fs = new SandboxFS()
    fs.write('a.ts', 'const x = 1\nconst y = 2\n')
    const res = await editFileTool.run({ path: 'a.ts', old_string: 'const x = 1', new_string: 'const x = 10' }, ctx(fs))
    expect(res.ok).toBe(true)
    expect(fs.read('a.ts')).toBe('const x = 10\nconst y = 2\n')
    expect(res.output).toContain('starting at line 1')
  })

  it('refuses ambiguous matches', async () => {
    const fs = new SandboxFS()
    fs.write('a.ts', 'foo\nfoo\n')
    const res = await editFileTool.run({ path: 'a.ts', old_string: 'foo', new_string: 'bar' }, ctx(fs))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/matches 2 times/)
    expect(fs.read('a.ts')).toBe('foo\nfoo\n')
  })

  it('refuses missing matches', async () => {
    const fs = new SandboxFS()
    fs.write('a.ts', 'foo\n')
    const res = await editFileTool.run({ path: 'a.ts', old_string: 'qux', new_string: 'bar' }, ctx(fs))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not found/)
  })

  it('supports replace_all', async () => {
    const fs = new SandboxFS()
    fs.write('a.ts', 'foo\nfoo\n')
    const res = await editFileTool.run({ path: 'a.ts', old_string: 'foo', new_string: 'bar', replace_all: true }, ctx(fs))
    expect(res.ok).toBe(true)
    expect(fs.read('a.ts')).toBe('bar\nbar\n')
  })
})

describe('run_command', () => {
  it('runs a command and captures output', async () => {
    const fs = new SandboxFS()
    const res = await runCommandTool.run({ command: 'echo hello && pwd' }, ctx(fs))
    expect(res.ok).toBe(true)
    expect(res.output).toContain('hello')
  })

  it('reports non-zero exit codes', async () => {
    const fs = new SandboxFS()
    const res = await runCommandTool.run({ command: 'exit 3' }, ctx(fs))
    expect(res.ok).toBe(false)
    expect(res.output).toContain('exit 3')
  })

  it('honors the timeout', async () => {
    const fs = new SandboxFS()
    const start = Date.now()
    const res = await runCommandTool.run({ command: 'sleep 5', timeout_ms: 200 }, ctx(fs))
    expect(Date.now() - start).toBeLessThan(5000)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/(killed|failed)/)
  })

  it('truncates output at 2 KiB', async () => {
    const fs = new SandboxFS()
    const res = await runCommandTool.run({ command: 'yes x | head -c 20000' }, ctx(fs))
    expect(Buffer.byteLength(res.output, 'utf8')).toBeLessThanOrEqual(2300)
    expect(res.output).toContain('[truncated:')
  })

  it('blocks dangerous commands', async () => {
    const fs = new SandboxFS()
    for (const cmd of ['sudo rm -rf /', 'rm -rf /', 'dd if=/dev/zero of=/dev/sda', 'shutdown -h now']) {
      const res = await runCommandTool.run({ command: cmd }, ctx(fs))
      expect(res.ok, `${cmd} should be blocked`).toBe(false)
      expect(res.error).toMatch(/blocked/)
    }
  })

  it('runs standalone with a temp cwd when no jail root is set', async () => {
    const fs = new SandboxFS()
    const res = await runCommandTool.run({ command: 'true' }, ctx(fs))
    expect(res.ok).toBe(true)
  })
})