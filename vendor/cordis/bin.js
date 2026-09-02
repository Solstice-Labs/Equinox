#!/usr/bin/env node

import { Context } from '@solsticeai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@solsticeai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@solsticeai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
