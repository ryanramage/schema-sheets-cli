import crypto from 'hypercore-crypto'
import z32 from 'z32'
import chalk from 'chalk'
import { input } from '@inquirer/prompts'

export class RoomManager {
  constructor(lobby, swarm, store, blind, wakeup) {
    this.lobby = lobby
    this.swarm = swarm
    this.store = store
    this.blind = blind
    this.wakeup = wakeup
    this.currentSheet = null
    this.currentRoomLink = null
    this.currentRoomName = null
  }

  async createNewRoom(petName, username) {
    const room = await this.lobby.createRoom(petName, username)
    const roomLink = this.lobby.generateRoomLink(room.keyBuffer, room.encryptionKeyBuffer)
    
    // Store the current room link and name for clipboard functionality and headers
    this.currentRoomLink = roomLink
    this.currentRoomName = petName
    
    console.log(chalk.green(`✅ Room "${petName}" created!`))
    console.log(chalk.blue(`Room Link: ${roomLink}`))
    
    return this.startSheet(room.keyBuffer, room.encryptionKeyBuffer, username)
  }

  async joinExistingRoom(roomLink, username, petName) {
    try {
      const room = await this.lobby.joinRoom(roomLink, username, petName)
      
      // Store the current room link and name for clipboard functionality and headers
      this.currentRoomLink = roomLink
      this.currentRoomName = room.petName
      
      console.log(chalk.green(`✅ Joined room "${room.petName}"`))
      
      return this.startSheet(room.keyBuffer, room.encryptionKeyBuffer, username)
    } catch (error) {
      console.error(chalk.red('Failed to join room:'), error.message)
      throw error
    }
  }

  async joinKnownRoom(room) {
    try {
      const roomLink = this.lobby.generateRoomLink(z32.decode(room.key), z32.decode(room.encryptionKey))
      const { sheet } = await this.joinExistingRoom(roomLink, room.username)
      const member = await sheet.join(room.username)
      
      console.log(chalk.green('✅ Connected to schema sheets'))
      await input({ message: 'Press Enter to continue to room...' })
      
      return { sheet, member }
    } catch (error) {
      console.error(chalk.red('Error joining room:'), error.message)
      await input({ message: 'Press Enter to continue...' })
      throw error
    }
  }

  async startSheet(key, encryptionKey, username) {
    const SchemaSheets = (await import('schema-sheets')).default
    const sheet = new SchemaSheets(this.store.namespace(crypto.randomBytes(32)), key, { 
      encryptionKey, 
      wakeup: this.wakeup 
    })
    await sheet.ready()
    this.swarm.join(sheet.base.discoveryKey)
    this.blind.addAutobaseBackground(sheet.base)
    
    // Track the current sheet for cleanup
    this.currentSheet = sheet
    if (username) {
      await sheet.join(username)
    }
    
    return { key: sheet.base.key, local: sheet.base.local.key, sheet }
  }

  async changeRoomName(newPetName) {
    try {
      // Update the room name in the lobby
      if (this.currentRoomLink) {
        const decoded = z32.decode(this.currentRoomLink)
        const key = decoded.subarray(0, 32)
        const keyHex = key.toString('hex')
        
        await this.lobby.updateRoom(keyHex, { petName: newPetName })
        this.currentRoomName = newPetName
        
        console.log(chalk.green(`✅ Room name changed to "${newPetName}"`))
      } else {
        console.log(chalk.yellow('Warning: Could not update room name (no room link available)'))
      }
    } catch (error) {
      console.error(chalk.red('Error changing room name:'), error.message)
      throw error
    }
  }

  setCurrentRoomName(roomName) {
    this.currentRoomName = roomName
  }

  async closeCurrentSheet() {
    if (this.currentSheet) {
      try {
        await this.currentSheet.close()
        console.log(chalk.gray('Sheet closed'))
      } catch (error) {
        console.warn(chalk.yellow('Warning: Error closing sheet:'), error.message)
      }
      this.currentSheet = null
      this.currentRoomLink = null
      this.currentRoomName = null
    }
  }

  getCurrentRoomLink() {
    return this.currentRoomLink
  }

  getCurrentRoomName() {
    return this.currentRoomName
  }

  getCurrentSheet() {
    return this.currentSheet
  }
}
