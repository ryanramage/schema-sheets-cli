// Example issue tracking schema
export const issueSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    status: { 
      type: 'string',
      enum: ['open', 'in-progress', 'closed']
    },
    priority: { 
      type: 'string',
      enum: ['low', 'med', 'high']
    },
    description: { type: 'string' }
  },
  required: ['title', 'status', 'priority']
}

// Example issue data
export const issue = {
  title: 'Sample Issue',
  status: 'open',
  priority: 'high',
  description: 'This is a sample issue'
}
