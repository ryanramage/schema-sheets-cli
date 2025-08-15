import fs from 'fs'
import { join } from 'path'
import { paths } from './default-config.mjs'
import IdentityKey from '../examples/sign-example.js'
import b4a from 'b4a'
import sodium from 'sodium-native'

const SIGNING_FILE_PATH = join(paths.config, 'signing.json')

export function signingConfigExists() {
  return fs.existsSync(SIGNING_FILE_PATH)
}

export function loadSigningConfig() {
  if (!signingConfigExists()) {
    return null
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(SIGNING_FILE_PATH, 'utf8'))
    return {
      keetUsername: data.keetUsername,
      identityPublicKey: Buffer.from(data.identityPublicKey, 'hex'),
      devicePublicKey: Buffer.from(data.devicePublicKey, 'hex'),
      deviceSecretKey: Buffer.from(data.deviceSecretKey, 'hex'),
      bootstrapProof: JSON.parse(data.bootstrapProof) // This might be an object
    }
  } catch (error) {
    console.error('Error loading signing config:', error.message)
    return null
  }
}

export async function createSigningConfig(keetUsername, mnemonic) {
  // Create identity from mnemonic
  const identity = await IdentityKey.from({ mnemonic })
  
  // Generate device keypair
  const devicePublicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const deviceSecretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(devicePublicKey, deviceSecretKey)
  
  // Create bootstrap proof
  const bootstrapProof = identity.bootstrap(devicePublicKey)
  
  // Prepare data for storage
  const signingData = {
    keetUsername,
    identityPublicKey: identity.identityPublicKey.toString('hex'),
    devicePublicKey: devicePublicKey.toString('hex'),
    deviceSecretKey: deviceSecretKey.toString('hex'),
    bootstrapProof: JSON.stringify(bootstrapProof)
  }
  
  // Write file with restrictive permissions
  fs.writeFileSync(SIGNING_FILE_PATH, JSON.stringify(signingData, null, 2), { mode: 0o600 })
  
  // Ensure permissions are set correctly (some systems might not respect the mode option)
  fs.chmodSync(SIGNING_FILE_PATH, 0o600)
  
  return loadSigningConfig()
}

// Generate a device keypair (utility function from the example)
function generateDeviceKeyPair() {
  const publicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}
