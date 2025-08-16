import fs from 'fs'
import { join } from 'path'
import { paths } from './default-config.mjs'
import IdentityKey from 'keet-identity-key'
import Id from 'hypercore-id-encoding'
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
      identityPublicKey: Id.decode(data.identityPublicKey),
      devicePublicKey: Id.decode(data.devicePublicKey),
      deviceSecretKey: b4a.from(data.deviceSecretKey, 'hex'),
      bootstrapProof: b4a.from(data.bootstrapProof, 'hex')
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
  const bootstrapProof = await identity.bootstrap(devicePublicKey)
  
  // Prepare data for storage
  const signingData = {
    keetUsername,
    identityPublicKey: Id.normalize(identity.identityKeyPair.publicKey),
    devicePublicKey: Id.encode(devicePublicKey),
    deviceSecretKey: b4a.toString(deviceSecretKey, 'hex'),
    bootstrapProof: b4a.toString(bootstrapProof, 'hex')
  }
  
  // Ensure config directory exists
  fs.mkdirSync(paths.config, { recursive: true })
  
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
