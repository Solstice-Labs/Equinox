/**
 * In-memory sandbox filesystem used by probe tool-flows.
 * Directories always own a children map, so no nullability asserts are needed.
 */

export interface FsEntry {
  type: 'file' | 'dir'
  content: string
  children: Map<string, FsEntry>
}

export interface FsStat {
  type: 'file' | 'dir'
  size: number
  lines: number
}

export class SandboxFS {
  private root: FsEntry = { type: 'dir', content: '', children: new Map() }
  maxFileBytes = 262_144 // 256 KiB default cap

  /** Normalize a path; `..` traversal beyond the root is clamped. */
  resolve(path: string): string[] {
    const parts = path.split('/').filter(p => p.length > 0 && p !== '.')
    const out: string[] = []
    for (const p of parts) {
      if (p === '..') out.pop()
      else out.push(p)
    }
    return out
  }

  exists(path: string): boolean {
    return this.entry(path) !== undefined
  }

  write(path: string, content: string): void {
    if (Buffer.byteLength(content, 'utf8') > this.maxFileBytes) {
      throw new Error(`write exceeds sandbox file cap (${this.maxFileBytes} bytes)`)
    }
    const parts = this.resolve(path)
    if (parts.length === 0) throw new Error('cannot write to filesystem root')
    const name = parts.pop() ?? ''
    let dir = this.root
    for (const part of parts) {
      let next = dir.children.get(part)
      if (next === undefined) {
        next = { type: 'dir', content: '', children: new Map() }
        dir.children.set(part, next)
      }
      if (next.type !== 'dir') throw new Error(`${part} is a file, not a directory`)
      dir = next
    }
    const existing = dir.children.get(name)
    if (existing !== undefined && existing.type === 'dir') throw new Error(`${name} is a directory`)
    dir.children.set(name, { type: 'file', content, children: new Map() })
  }

  read(path: string): string {
    const entry = this.entry(path)
    if (entry === undefined) throw new Error(`no such file: ${path}`)
    if (entry.type === 'dir') throw new Error(`${path} is a directory`)
    return entry.content
  }

  ls(path = '/'): string[] {
    const entry = this.entry(path) ?? this.root
    if (entry.type === 'file') throw new Error(`${path} is a file`)
    const children = projectEntries(entry)
    return children.map(([name, child]) => (child.type === 'dir' ? `${name}/` : name)).sort()
  }

  rm(path: string): void {
    const parts = this.resolve(path)
    if (parts.length === 0) throw new Error('cannot remove filesystem root')
    const name = parts.pop() ?? ''
    const dir = this.dir(parts)
    if (!dir.children.has(name)) throw new Error(`no such entry: ${path}`)
    dir.children.delete(name)
  }

  mkdir(path: string): void {
    const parts = this.resolve(path)
    if (parts.length === 0) return
    let dir = this.root
    for (const part of parts) {
      let next = dir.children.get(part)
      if (next === undefined) {
        next = { type: 'dir', content: '', children: new Map() }
        dir.children.set(part, next)
      }
      if (next.type !== 'dir') throw new Error(`${part} is a file, not a directory`)
      dir = next
    }
  }

  stat(path: string): FsStat {
    const entry = this.entry(path)
    if (entry === undefined) throw new Error(`no such entry: ${path}`)
    if (entry.type === 'dir') {
      return { type: 'dir', size: 0, lines: 0 }
    }
    const size = Buffer.byteLength(entry.content, 'utf8')
    const parts = entry.content.split('\n')
    // A trailing newline does not start a new line.
    const lines = entry.content === '' ? 0 : parts.length - (entry.content.endsWith('\n') ? 1 : 0)
    return { type: 'file', size, lines }
  }

  dump(): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (entry: FsEntry, prefix: string) => {
      for (const [name, child] of projectEntries(entry)) {
        const path = `${prefix}/${name}`
        if (child.type === 'dir') walk(child, path)
        else out[path] = child.content
      }
    }
    walk(this.root, '')
    return out
  }

  private dir(parts: string[]): FsEntry {
    let dir = this.root
    for (const part of parts) {
      const next = dir.children.get(part)
      if (next === undefined || next.type !== 'dir') throw new Error(`no such directory: ${part}`)
      dir = next
    }
    return dir
  }

  private entry(path: string): FsEntry | undefined {
    const parts = this.resolve(path)
    if (parts.length === 0) return this.root
    let dir = this.root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part === undefined) return undefined
      const child = dir.children.get(part)
      if (child === undefined) return undefined
      if (i === parts.length - 1) return child
      if (child.type !== 'dir') return undefined
      dir = child
    }
    return undefined
  }
}

function projectEntries(entry: FsEntry): [string, FsEntry][] {
  return [...entry.children.entries()]
}
