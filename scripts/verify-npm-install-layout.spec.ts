import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualEquinoxInstallLayout,
  buildDualDshRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@solsticeai/equinox': '0.2.0', 'dsh-previous': 'npm:@solsticeai/equinox@0.1.0' } },
      'node_modules/@solsticeai/cordis': { version: '4.0.1' },
      'node_modules/@solsticeai/equinox': {
        version: '0.2.0',
        dependencies: { '@solsticeai/equinox-child': '^0.2.0' },
        peerDependencies: { '@solsticeai/cordis': '^4.0.1' },
      },
      'node_modules/@solsticeai/equinox-child': {
        version: '0.2.0',
        dependencies: { '@solsticeai/equinox-leaf': '^0.2.0' },
      },
      'node_modules/@solsticeai/equinox-leaf': { version: '0.2.0' },
      'node_modules/dsh-previous': {
        name: '@solsticeai/equinox',
        version: '0.1.0',
        dependencies: { '@solsticeai/equinox-child': '^0.1.0' },
        peerDependencies: { '@solsticeai/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@solsticeai/equinox-child': {
        version: '0.1.0',
        dependencies: { '@solsticeai/equinox-leaf': '^0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@solsticeai/equinox-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every DSH package', () => {
    const index: RegistryIndex = new Map([
      ['@solsticeai/equinox', new Map([['0.1.1-rc.2', {
        name: '@solsticeai/equinox',
        version: '0.1.1-rc.2',
        dependencies: { '@solsticeai/equinox-child': '^0.1.1-rc.2' },
        peerDependencies: { '@solsticeai/cordis': '^4.0.1' },
      }]])],
      ['@solsticeai/equinox-child', new Map([['0.1.1-rc.2', {
        name: '@solsticeai/equinox-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@solsticeai/cordis', new Map([['4.0.1', {
        name: '@solsticeai/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualDshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@solsticeai/equinox')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@solsticeai/equinox')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@solsticeai/equinox-child': '^0.1.0' },
      peerDependencies: { '@solsticeai/cordis': '^4.0.1' },
    })
    expect(dual.get('@solsticeai/equinox')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@solsticeai/equinox-child': '^0.2.0' },
    })
    expect(dual.get('@solsticeai/cordis')).toBe(index.get('@solsticeai/cordis'))
  })

  it('accepts isolated DSH releases with one shared Cordis installation', () => {
    expect(assertDualEquinoxInstallLayout(validLayout())).toEqual({
      equinoxPackagesPerVersion: 3,
      checkedEquinoxEdges: 4,
    })
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/dsh-previous/node_modules/@solsticeai/equinox-leaf')

    expect(() => assertDualEquinoxInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/dsh-previous/node_modules/@solsticeai/equinox-child: dependencies '
      + '@solsticeai/equinox-leaf resolves to node_modules/@solsticeai/equinox-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/dsh-previous/node_modules/@solsticeai/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualEquinoxInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @solsticeai/cordis',
    )
  })
})
