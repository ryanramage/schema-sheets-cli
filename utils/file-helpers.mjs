import fs from 'fs'
import { dirname } from 'path'
import fileSelector from 'inquirer-file-selector'

// Track last used directory globally
let lastUsedDirectory = null

export function getLastUsedDirectory() {
  return lastUsedDirectory
}

export function setLastUsedDirectory(directory) {
  lastUsedDirectory = directory
}

export async function selectJsonFile(message = 'Select JSON file:') {
  const filePath = await fileSelector({
    message,
    type: 'file',
    filter: item => item.isDirectory || item.name.endsWith('.json'),
    ...(lastUsedDirectory && { basePath: lastUsedDirectory })
  })

  // Remember the directory for next time
  lastUsedDirectory = dirname(filePath)
  return filePath
}

export function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export async function downloadJsonFromUrl(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}
