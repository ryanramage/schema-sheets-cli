import fs from 'fs'
import { join } from 'path'
import z32 from 'z32'
import crypto from 'hypercore-crypto'
import { makeDirectory } from 'make-dir'

export class RoomLobby {
  constructor(storagePath) {
    this.storagePath = storagePath
    this.roomsPath = join(storagePath, 'rooms')
  }

  async init() {
    // Ensure rooms directory exists
    await makeDirectory(this.roomsPath)
  }

  /**
   * Create a new room with given petName and username
   * @param {string} petName - Human readable room name
   * @param {string} username - User's name in this room
   * @returns {Object} Room data with key, encryptionKey, etc.
   */
  async createRoom(petName, username) {
    const key = crypto.randomBytes(32)
    const encryptionKey = crypto.randomBytes(32)
    
    const room = {
      key: z32.encode(key),
      encryptionKey: z32.encode(encryptionKey),
      createdAt: Date.now(),
      petName,
      username,
      isCreator: true
    }

    await this.saveRoom(room)
    return {
      ...room,
      keyBuffer: key,
      encryptionKeyBuffer: encryptionKey
    }
  }

  /**
   * Join an existing room from a room link
   * @param {string} roomLink - z32 encoded room link (key + encryptionKey)
   * @param {string} username - User's name in this room
   * @returns {Object} Room data
   */
  async joinRoom(roomLink, username) {
    try {
      // Decode the room link to get key and encryption key
      const decoded = z32.decode(roomLink)
      const key = decoded.subarray(0, 32)
      const encryptionKey = decoded.subarray(32)
      const keyHex = key.toString('hex')

      // Check if we already know this room
      const knownRoom = await this.getRoomByKey(keyHex)
      
      if (knownRoom) {
        // Update username if different
        if (knownRoom.username !== username) {
          knownRoom.username = username
          await this.saveRoom(knownRoom)
        }
        return {
          ...knownRoom,
          keyBuffer: key,
          encryptionKeyBuffer: encryptionKey
        }
      }

      // New room - create entry
      const room = {
        key: z32.encode(key),
        encryptionKey: z32.encode(encryptionKey),
        createdAt: Date.now(),
        petName: `Room ${keyHex.substring(0, 8)}...`, // Default name
        username,
        isCreator: false
      }

      await this.saveRoom(room)
      return {
        ...room,
        keyBuffer: key,
        encryptionKeyBuffer: encryptionKey
      }
    } catch (error) {
      throw new Error(`Failed to join room: ${error.message}`)
    }
  }

  /**
   * Generate a room link from key and encryptionKey buffers
   * @param {Buffer} key - Room key buffer
   * @param {Buffer} encryptionKey - Room encryption key buffer
   * @returns {string} z32 encoded room link
   */
  generateRoomLink(key, encryptionKey) {
    const combined = Buffer.concat([key, encryptionKey])
    return z32.encode(combined)
  }

  /**
   * Get all known rooms
   * @returns {Array} Array of room objects
   */
  async listRooms() {
    try {
      const files = fs.readdirSync(this.roomsPath)
      const rooms = []

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const roomData = JSON.parse(fs.readFileSync(join(this.roomsPath, file), 'utf8'))
            rooms.push(roomData)
          } catch (error) {
            console.warn(`Failed to load room file ${file}:`, error.message)
          }
        }
      }

      // Sort by creation date, newest first
      return rooms.sort((a, b) => b.createdAt - a.createdAt)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [] // Directory doesn't exist yet
      }
      throw error
    }
  }

  /**
   * Find a room by its key (hex format)
   * @param {string} keyHex - Room key in hex format
   * @returns {Object|null} Room object or null if not found
   */
  async getRoomByKey(keyHex) {
    try {
      const roomFile = join(this.roomsPath, `${keyHex}.json`)
      if (fs.existsSync(roomFile)) {
        return JSON.parse(fs.readFileSync(roomFile, 'utf8'))
      }
      return null
    } catch (error) {
      console.warn(`Failed to get room by key ${keyHex}:`, error.message)
      return null
    }
  }

  /**
   * Save room data to file
   * @param {Object} room - Room object to save
   */
  async saveRoom(room) {
    await this.init() // Ensure directory exists
    
    // Convert z32 key to hex for filename
    const keyBuffer = z32.decode(room.key)
    const keyHex = keyBuffer.toString('hex')
    
    const roomFile = join(this.roomsPath, `${keyHex}.json`)
    fs.writeFileSync(roomFile, JSON.stringify(room, null, 2))
  }

  /**
   * Delete a room by key
   * @param {string} keyHex - Room key in hex format
   */
  async deleteRoom(keyHex) {
    try {
      const roomFile = join(this.roomsPath, `${keyHex}.json`)
      if (fs.existsSync(roomFile)) {
        fs.unlinkSync(roomFile)
        return true
      }
      return false
    } catch (error) {
      throw new Error(`Failed to delete room: ${error.message}`)
    }
  }

  /**
   * Update room metadata (petName, username, etc.)
   * @param {string} keyHex - Room key in hex format
   * @param {Object} updates - Object with fields to update
   */
  async updateRoom(keyHex, updates) {
    const room = await this.getRoomByKey(keyHex)
    if (!room) {
      throw new Error('Room not found')
    }

    const updatedRoom = { ...room, ...updates }
    await this.saveRoom(updatedRoom)
    return updatedRoom
  }
}

// Export a default instance factory
export function createLobby(storagePath) {
  return new RoomLobby(storagePath)
}
