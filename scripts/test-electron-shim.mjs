// Only parsing/pixel replay tests use this shim. Native capture remains an Electron check.
export const electronTestShim = {
  name: 'electron-test-app-path',
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test-app-path' }))
    build.onLoad({ filter: /.*/, namespace: 'test-app-path' }, () => ({
      contents: 'export const app = { isPackaged: false, getAppPath: () => process.cwd() }; export const nativeImage = undefined;',
      loader: 'js',
    }))
  },
}
