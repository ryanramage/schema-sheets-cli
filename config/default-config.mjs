import envPaths from 'env-paths'

const paths = envPaths('schema-sheets')

// Default configuration
export const DefaultConfig = {
  storage: paths.data,
  DEFAULT_BLIND_PEER_KEYS: []
}

export { paths }
