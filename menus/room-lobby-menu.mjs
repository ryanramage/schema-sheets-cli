import chalk from 'chalk'
import z32 from 'z32'
import { BaseMenu } from './base-menu.mjs'

export class RoomLobbyMenu extends BaseMenu {
  constructor(roomManager, sheetOps, lobby) {
    super(roomManager, sheetOps)
    this.lobby = lobby
  }

  async show() {
    const title = '🏠 Room Lobby'
    console.log(chalk.gray('Manage your rooms and join schema sheets\n'))

    const rooms = await this.lobby.listRooms()
    
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

    // Add existing rooms to the menu
    if (rooms.length > 0) {
      choices.push({
        name: chalk.gray('--- Known Rooms ---'),
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

  async showCreateRoom() {
    const title = '🆕 Create New Room'

    try {
      const petName = await this.getInput('Enter room name:', {
        validate: (input) => {
          if (!input.trim()) return 'Room name is required'
          return true
        }
      })

      const username = await this.getInput('Enter your username:', {
        validate: (input) => {
          if (!input.trim()) return 'Username is required'
          return true
        }
      })

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
