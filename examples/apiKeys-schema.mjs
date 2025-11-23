// API Keys management schema
export const apiKeysSchema = {
  type: 'object',
  properties: {
    app: { 
      type: 'string',
      description: 'Name of the application'
    },
    env: { 
      type: 'string',
      enum: ['dev', 'staging', 'rc', 'prerelease', 'production'],
      description: 'Environment name'
    },
    decommissioned: { 
      type: 'boolean',
      default: false,
      description: 'Whether this API key has been decommissioned'
    },
    key: { 
      type: 'string',
      description: 'The API key value'
    }
  },
  required: ['app', 'env', 'key']
}

// Example API key data
export const apiKey = {
  app: 'MyApp',
  env: 'production',
  decommissioned: false,
  key: 'sk-1234567890abcdef'
}
