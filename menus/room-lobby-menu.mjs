import chalk from 'chalk'
import z32 from 'z32'
import Id from 'hypercore-id-encoding'
import { password } from '@inquirer/prompts'
import { BaseMenu } from './base-menu.mjs'
import { signingConfigExists, createSigningConfig, loadSigningConfig } from '../config/signing-utils.mjs'

export class RoomLobbyMenu extends BaseMenu {
  constructor(roomManager, sheetOps, lobby) {
    super(roomManager, sheetOps)
    this.lobby = lobby
  }

  async show() {
    const title = '🏠 Room Lobby'
    console.log(chalk.cyan('Manage your rooms and join schema sheets\n'))

    const rooms = await this.lobby.listRooms()
    const hasSigningConfig = signingConfigExists()
    
    const choices = [
      {
        name: '🆕 Create New Room',
        value: 'create-room',
        description: 'Create a new room and get a shareable link'
      },
      {
        name: '🔗 Join Room by Link',
        value: 'join-room',
        description: 'Join an existing room using a room link'
      }
    ]

    // Add signing setup option if not configured
    if (!hasSigningConfig) {
      choices.push({
        name: '🔐 Setup Signing',
        value: 'setup-signing',
        description: 'Configure your Keet identity for data signing'
      })
    }

    // Add existing rooms to the menu
    if (rooms.length > 0) {
      choices.push({
        name: chalk.cyan('--- Known Rooms ---'),
        value: 'separator',
        disabled: ''
      })
      
      rooms.forEach(room => {
        const createdDate = new Date(room.createdAt).toLocaleDateString()
        const isCreator = room.isCreator ? '👑' : '👤'
        choices.push({
          name: `${isCreator} ${room.petName} (${createdDate})`,
          value: `room-${room.key}`,
          description: `Join as ${room.username}`
        })
      })
    }

    choices.push({
      name: '🚪 Exit',
      value: 'exit',
      description: 'Close the application'
    })

    const choice = await this.showMenu(title, choices, 'What would you like to do?')

    if (choice === 'separator') {
      // User accidentally selected separator, re-render menu
      return this.show()
    }

    return { choice, rooms }
  }

  async showSetupSigning() {
    const title = '🔐 Setup Signing'
    console.log(chalk.cyan('Configure your Keet identity for signing data\n'))

    try {
      const keetUsername = await this.getInput('Enter your Keet username:', {
        validate: (input) => {
          if (!input.trim()) return 'Keet username is required'
          return true
        }
      })

      console.log(chalk.yellow('\n⚠️  Your mnemonic will not be stored, only used to derive keys'))
      const mnemonic = await password({
        message: 'Enter your Keet mnemonic (hidden input):',
        validate: (input) => {
          if (!input.trim()) return 'Mnemonic is required'
          // Basic validation - should be multiple words
          const words = input.trim().split(/\s+/)
          if (words.length < 24) return 'Mnemonic should be at least 24 words'
          return true
        }
      })

      console.log(chalk.blue('\n🔄 Generating keys and proof...'))
      
      const signingConfig = await createSigningConfig(keetUsername, mnemonic)
      
      if (signingConfig) {
        console.log(chalk.green('✅ Signing configuration created successfully!'))
        console.log(chalk.cyan(`Identity: ${Id.normalize(signingConfig.identityPublicKey).substring(0, 16)}...`))
      } else {
        throw new Error('Failed to create signing configuration')
      }

      await this.waitForContinue()
      return true
    } catch (error) {
      console.error(chalk.red('Error setting up signing:'), error.message)
      await this.waitForContinue()
      return false
    }
  }

  async showCreateRoom() {
    const title = '🆕 Create New Room'

    try {
      const petName = await this.getInput('Enter room name:', {
        validate: (input) => {
          if (!input.trim()) return 'Room name is required'
          return true
        }
      })

      // Check if we have a Keet username configured
      const signingConfig = loadSigningConfig()
      let username

      if (signingConfig && signingConfig.keetUsername) {
        username = signingConfig.keetUsername
        console.log(chalk.cyan(`Using Keet username: ${username}`))
      } else {
        username = await this.getInput('Enter your username:', {
          validate: (input) => {
            if (!input.trim()) return 'Username is required'
            return true
          }
        })
      }

      return { petName, username }
    } catch (error) {
      console.error(chalk.red('Error in create room form:'), error.message)
      await this.waitForContinue()
      return null
    }
  }

  async showJoinRoom() {
    const title = '🔗 Join Room by Link'

    try {
      const roomLink = await this.getInput('Enter room link:', {
        validate: (input) => {
          if (!input.trim()) return 'Room link is required'
          try {
            z32.decode(input)
            return true
          } catch {
            return 'Invalid room link format'
          }
        }
      })

      const username = await this.getInput('Enter your username:', {
        validate: (input) => {
          if (!input.trim()) return 'Username is required'
          return true
        }
      })

      const petName = await this.getInput('Enter a local name for this room (optional):', {
        validate: (input) => {
          // Allow empty input for optional field
          return true
        }
      })

      return { roomLink, username, petName: petName.trim() || undefined }
    } catch (error) {
      console.error(chalk.red('Error in join room form:'), error.message)
      await this.waitForContinue()
      return null
    }
  }
}
