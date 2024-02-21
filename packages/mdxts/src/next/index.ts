import webpack from 'webpack'
import { NextConfig } from 'next'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import remarkTypography from 'remark-typography'
import createMdxPlugin from '@next/mdx'
import { BUNDLED_THEMES } from 'shiki'

import { remarkPlugin } from '../remark'
import { rehypePlugin } from '../rehype'
import { renumberFilenames } from '../utils/renumber'
import { addGitSourceToMdxtsConfig } from './add-git-source'

type PluginOptions = {
  /** Path to the VS Code compatible theme used for syntax highlighting the Code and Editor components. */
  theme: (typeof BUNDLED_THEMES)[number] | (string & {})

  /** The git source to use for linking to the repository and source files. This is automatically inferred from the git remote URL if not provided. */
  gitSource?: string

  /** The branch to use for linking to the repository and source files. */
  gitBranch?: string
}

/** Starts the MDXTS server and bundles all entry points defined in the plugin options. */
export function createMdxtsPlugin(pluginOptions: PluginOptions) {
  let { gitSource, gitBranch = 'main', theme } = pluginOptions
  const themePath = resolve(process.cwd(), theme)

  /** Attempt to resolve the git source from the git remote URL and add it to the next config file. */
  if (gitSource === undefined) {
    try {
      const stdout = execSync('git remote get-url origin')
      gitSource = stdout
        .toString()
        .trim()
        .replace(/\.git$/, '')
      addGitSourceToMdxtsConfig(gitSource)
    } catch (error) {
      throw new Error(
        'Could not infer git source from git remote URL. Please provide a git source in the mdxts/next plugin options.',
        { cause: error }
      )
    }
  }

  return function withMdxts(nextConfig: NextConfig = {}) {
    const getWebpackConfig = nextConfig.webpack
    let startedWatcher = false

    return async () => {
      const [
        remarkGemoji,
        remarkGfm,
        remarkGitHub,
        remarkStripBadges,
        remarkSqueezeParagraphs,
        remarkUnwrapImages,
      ] = await Promise.all([
        import('remark-gemoji'),
        import('remark-gfm'),
        import('remark-github'),
        import('remark-strip-badges'),
        import('remark-squeeze-paragraphs'),
        import('remark-unwrap-images'),
      ])
      const withMdx = createMdxPlugin({
        options: {
          remarkPlugins: [
            remarkGemoji,
            remarkGfm,
            remarkGitHub,
            remarkStripBadges,
            remarkSqueezeParagraphs,
            remarkUnwrapImages,
            remarkTypography,
            remarkPlugin,
          ] as any,
          rehypePlugins: [rehypePlugin],
        },
      })

      nextConfig.webpack = (config, options) => {
        // add default mdx components
        config.resolve.alias['next-mdx-import-source-file'].push(
          resolve(__dirname, '../../src/components/MDXComponents.js')
        )

        config.plugins.push(
          // silence ts-morph warnings
          new webpack.ContextReplacementPlugin(
            /\/@ts-morph\/common\//,
            (data: { dependencies: Array<{ critical?: boolean }> }) => {
              for (const dependency of data.dependencies) {
                delete dependency.critical
              }
              return data
            }
          ),
          new webpack.IgnorePlugin({
            resourceRegExp: /^perf_hooks$/,
          })
        )

        if (options.isServer && options.dev && !startedWatcher) {
          renumberFilenames()
          startedWatcher = true
        }

        config.module.rules.push({
          test: /\.(?:jsx?|tsx?|mdx?)$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'mdxts/loader',
              options: {
                themePath: theme.endsWith('.json') ? themePath : theme,
              },
            },
          ],
        })

        config.module.rules.push({
          test: /onig\.wasm$/,
          type: 'asset/resource',
        })

        if (options.isServer === false) {
          config.plugins.push(new NodePolyfillPlugin())
        }

        if (typeof getWebpackConfig === 'function') {
          return getWebpackConfig(config, options)
        }

        return config
      }

      if (nextConfig.env === undefined) {
        nextConfig.env = {}
      }

      nextConfig.env.MDXTS_GIT_SOURCE = gitSource!.replace(/\.git$/, '')
      nextConfig.env.MDXTS_GIT_BRANCH = gitBranch

      if (nextConfig.pageExtensions === undefined) {
        nextConfig.pageExtensions = ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx']
      }

      nextConfig.experimental = {
        ...nextConfig.experimental,
        serverComponentsExternalPackages: [
          ...(nextConfig.experimental?.serverComponentsExternalPackages ?? []),
          'esbuild',
          'ts-morph',
        ],
      }

      return withMdx(nextConfig)
    }
  }
}
